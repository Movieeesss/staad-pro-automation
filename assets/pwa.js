/* PWA layer for the STAAD.Pro Exact Engine. Engine/drawing code stays in index.html. */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const safe = (fn) => { try { return fn(); } catch (_) { return undefined; } };

  /* ---------- 1. Service worker, update prompt, install ---------- */
  let updateRequested = false;

  function banner(html, buttons) {
    const el = document.createElement('div');
    el.className = 'pwa-banner';
    el.setAttribute('role', 'status');
    el.innerHTML = `<span>${html}</span><span class="actions"></span>`;
    buttons.forEach(([label, cls, fn]) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; if (cls) b.className = cls;
      b.onclick = () => { el.remove(); fn && fn(); };
      el.querySelector('.actions').appendChild(b);
    });
    document.body.appendChild(el);
    return el;
  }

  function promptUpdate(worker) {
    banner('A new version is ready.', [
      ['Later', 'ghost'],
      ['Update', '', () => { updateRequested = true; worker.postMessage({ type: 'SKIP_WAITING' }); }]
    ]);
  }

  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(nw);
          });
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
        safe(async () => {
          if ('periodicSync' in reg) {
            const st = await navigator.permissions.query({ name: 'periodic-background-sync' });
            if (st.state === 'granted') await reg.periodicSync.register('staad-refresh-shell', { minInterval: 24 * 60 * 60 * 1000 });
          }
        });
      }).catch((err) => console.warn('[PWA] Service worker registration failed:', err));
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (updateRequested) location.reload(); // only after the user accepted an update
    });
  }

  let deferredPrompt = null;
  const installBtn = $('installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.style.display = '';
  });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice.catch(() => {});
    deferredPrompt = null;
    installBtn.style.display = 'none';
  });
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.style.display = 'none';
    if (typeof showToast === 'function') showToast('App installed', '📲');
  });

  // iOS has no install prompt: show a one-time Add to Home Screen hint in Safari
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !standalone && !safe(() => localStorage.getItem('staad-ios-hint'))) {
    setTimeout(() => banner('To install: tap <b>Share</b>, then <b>Add to Home Screen</b>.', [
      ['Got it', '', () => safe(() => localStorage.setItem('staad-ios-hint', '1'))]
    ]), 2500);
  }

  const netBadge = $('netBadge');
  const syncNet = () => { if (netBadge) netBadge.classList.toggle('hidden', navigator.onLine); };
  window.addEventListener('online', () => { syncNet(); typeof showToast === 'function' && showToast('Back online', '🟢'); });
  window.addEventListener('offline', () => { syncNet(); typeof showToast === 'function' && showToast('Offline: everything still works', '📴'); });
  syncNet();

  /* ---------- 2. Canvas: probe, pinch-zoom, pan, fullscreen ---------- */
  const vp = $('canvasViewport'), stage = $('canvasStage'), cv = $('beamCanvas'), badge = $('zoomBadge');
  if (vp && stage && cv) {
    const MIN = 1, MAX = 6;
    let z = 1, tx = 0, ty = 0, panMode = false;
    const ptrs = new Map();
    let g = null, lastTap = 0, lastTapX = 0, lastTapY = 0;
    const isFs = () => vp.classList.contains('canvas-fs');

    function clampPan() {
      const sw = stage.offsetWidth, sh = stage.offsetHeight, ox = stage.offsetLeft, oy = stage.offsetTop;
      const vw = vp.clientWidth, vh = vp.clientHeight;
      const loX = vw - ox - sw * z, loY = vh - oy - sh * z;
      tx = loX >= 0 ? 0 : clamp(tx, loX, 0);
      ty = loY >= 0 ? (isFs() ? loY / 2 : 0) : clamp(ty, loY, 0);
    }
    function apply() {
      clampPan();
      stage.style.transform = `translate3d(${tx}px,${ty}px,0) scale(${z})`;
      if (badge) badge.textContent = Math.round(z * 100) + '%';
      cv.style.cursor = panMode ? (z > 1 ? 'grab' : 'default') : 'crosshair';
    }
    function zoomAt(nz, mx, my) {
      nz = clamp(nz, MIN, MAX);
      const ox = stage.offsetLeft, oy = stage.offsetTop;
      const lx = (mx - ox - tx) / z, ly = (my - oy - ty) / z;
      z = nz; tx = mx - ox - lx * z; ty = my - oy - ly * z;
      apply();
    }
    const rel = (e) => { const r = vp.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const two = () => { const [a, b] = [...ptrs.values()]; return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };

    vp.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.canvas-tools')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      vp.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 1) {
        g = { mode: (panMode || e.shiftKey) ? 'pan' : 'probe', moved: false, t0: performance.now(), sx: e.clientX, sy: e.clientY, tx0: tx, ty0: ty };
        if (g.mode === 'probe') handleCanvasPoint(e);
      } else if (ptrs.size === 2) {
        const t = two(), r = vp.getBoundingClientRect();
        const mx = t.x - r.left, my = t.y - r.top;
        g = { mode: 'pinch', d0: t.d, z0: z, lx: (mx - stage.offsetLeft - tx) / z, ly: (my - stage.offsetTop - ty) / z };
      }
    });
    vp.addEventListener('pointermove', (e) => {
      if (!ptrs.has(e.pointerId) || !g) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (g.mode === 'pinch' && ptrs.size >= 2) {
        const t = two(), r = vp.getBoundingClientRect();
        z = clamp(g.z0 * t.d / g.d0, MIN, MAX);
        tx = t.x - r.left - stage.offsetLeft - g.lx * z;
        ty = t.y - r.top - stage.offsetTop - g.ly * z;
        apply();
      } else if (g.mode === 'pan') {
        tx = g.tx0 + (e.clientX - g.sx); ty = g.ty0 + (e.clientY - g.sy);
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) g.moved = true;
        apply();
      } else if (g.mode === 'probe') {
        if (Math.hypot(e.clientX - g.sx, e.clientY - g.sy) > 8) g.moved = true;
        handleCanvasPoint(e);
      }
    });
    function endPointer(e) {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      const wasTap = g && (g.mode === 'probe' || g.mode === 'pan') && !g.moved && performance.now() - g.t0 < 260;
      if (wasTap && e.type === 'pointerup') {
        const now = performance.now(), [mx, my] = rel(e);
        if (now - lastTap < 320 && Math.hypot(mx - lastTapX, my - lastTapY) < 30) {
          z > 1.05 ? (z = 1, tx = ty = 0, apply()) : zoomAt(2.5, mx, my);
          lastTap = 0;
        } else { lastTap = now; lastTapX = mx; lastTapY = my; }
      }
      g = ptrs.size === 0 ? null : { mode: 'idle' }; // no probe jumps after a pinch
    }
    vp.addEventListener('pointerup', endPointer);
    vp.addEventListener('pointercancel', endPointer);
    vp.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return; // plain wheel keeps scrolling the page
      e.preventDefault();
      const [mx, my] = rel(e);
      zoomAt(z * Math.exp(-e.deltaY * 0.01), mx, my);
    }, { passive: false });

    const center = () => [vp.clientWidth / 2, vp.clientHeight / 2];
    $('zoomInBtn')?.addEventListener('click', () => zoomAt(z * 1.5, ...center()));
    $('zoomOutBtn')?.addEventListener('click', () => zoomAt(z / 1.5, ...center()));
    $('zoomFitBtn')?.addEventListener('click', () => { z = 1; tx = ty = 0; apply(); });
    $('panModeBtn')?.addEventListener('click', (e) => {
      panMode = !panMode;
      e.currentTarget.setAttribute('aria-pressed', String(panMode));
      apply();
    });

    const fsBtn = $('fsBtn');
    function setFs(on) {
      if (isFs() === on) return;
      vp.classList.toggle('canvas-fs', on);
      document.body.classList.toggle('no-scroll', on);
      if (fsBtn) { fsBtn.textContent = on ? '✕' : '⛶'; fsBtn.setAttribute('aria-label', on ? 'Close full screen' : 'Full screen diagram'); }
      z = 1; tx = ty = 0; apply();
      if (on) history.pushState({ fs: 1 }, '');
      else if (history.state && history.state.fs) history.back();
    }
    fsBtn?.addEventListener('click', () => setFs(!isFs()));
    window.addEventListener('popstate', () => setFs(false)); // Android back closes full screen
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape') setFs(false); });
    if ('ResizeObserver' in window) new ResizeObserver(apply).observe(vp); else window.addEventListener('resize', apply);
    apply();
  }

  /* ---------- 3. Autosave / restore project (localStorage) ---------- */
  const KEY = 'staad-multibeam-project-v1';
  let saveTimer = 0;
  function snapshot() {
    return {
      v: 1, active: activeBeamIndex, next: nextBeamCounter,
      beams: projectBeams.map((b) => ({
        id: b.id, name: b.name, gridNamingScheme: b.gridNamingScheme, bmdConvention: b.bmdConvention,
        activeViewMode: b.activeViewMode, probeX: b.probeX, sectionProps: b.sectionProps,
        spanList: b.spanList, nodeSupports: b.nodeSupports
      }))
    };
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => safe(() => localStorage.setItem(KEY, JSON.stringify(snapshot()))), 400);
  }
  function restore() {
    const raw = safe(() => localStorage.getItem(KEY));
    if (!raw) return false;
    try {
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || !Array.isArray(s.beams) || !s.beams.length) return false;
      const beams = s.beams.map((d) => {
        if (!Array.isArray(d.spanList) || !d.spanList.length || !Array.isArray(d.nodeSupports) || d.nodeSupports.length !== d.spanList.length + 1) throw new Error('bad beam');
        const b = createBeamObject(d.id, d.name);
        Object.assign(b, { gridNamingScheme: d.gridNamingScheme, bmdConvention: d.bmdConvention, activeViewMode: d.activeViewMode,
          probeX: d.probeX, sectionProps: d.sectionProps, spanList: d.spanList, nodeSupports: d.nodeSupports });
        return b;
      });
      projectBeams = beams;
      activeBeamIndex = clamp(s.active | 0, 0, beams.length - 1);
      nextBeamCounter = Math.max(s.next | 0, ...beams.map((b) => b.id));
      beams.forEach(solveBeamDSM);
      syncActiveBeamUI();
      solveSystem();
      showToast('Project restored', '💾');
      return true;
    } catch (err) {
      console.warn('[PWA] Saved project ignored:', err);
      safe(() => localStorage.removeItem(KEY));
      return false;
    }
  }
  function installAutosave() {
    ['solveSystem', 'syncActiveBeamUI', 'renderBeamTabs', 'switchActiveBeam', 'deleteActiveBeam'].forEach((name) => {
      const f = window[name];
      if (typeof f === 'function') window[name] = function (...a) { const r = f.apply(this, a); scheduleSave(); return r; };
    });
    window.addEventListener('pagehide', () => safe(() => localStorage.setItem(KEY, JSON.stringify(snapshot()))));
  }

  /* ---------- 4. Start-up: restore, shortcuts ---------- */
  window.addEventListener('load', () => {
    safe(restore);
    installAutosave();
    const action = new URLSearchParams(location.search).get('action');
    if (action) {
      safe(() => {
        if (action === 'add-beam') addNewBeam();
        else if (action === 'gallery' && !isGalleryOpen) toggleAllBeamsGallery();
        else if (action === 'benchmark') loadSTAADExact380Benchmark();
        history.replaceState(null, '', location.pathname);
      });
    }
  });
})();
