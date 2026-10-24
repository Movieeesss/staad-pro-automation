# STAAD.Pro Exact Engine: PWA build

Everything in this folder is static. No build step is needed to host it.

## 1. Test locally
    npx serve .          # or: python3 -m http.server 8080
Open http://localhost:3000 (or :8080), then Chrome DevTools > Application: confirm the manifest, a running service worker, then tick "Offline" and reload.

## 2. Host it (HTTPS is required)
**Netlify (recommended for the APK):** app.netlify.com/drop, drag this whole folder in. `_headers` is applied automatically (no-cache for sw.js and index.html).
**GitHub Pages:** push this folder's contents to a repo, Settings > Pages > deploy from branch. Works for installing from the browser. For a store APK, use a repo named `<user>.github.io` or a custom domain, because Android needs `/.well-known/assetlinks.json` at the domain root.

## 3. Android APK / AAB with PWABuilder
1. Open pwabuilder.com, paste your hosted URL, Start. Review the report (manifest, service worker, offline).
2. Package for stores > Android. Set a package ID (e.g. `com.yourname.beamengine`), app name "Beam Engine", version 1.0.0, and let it create a new signing key.
3. Generate and download. The zip contains the signed `.apk` (sideload/test), the `.aab` (Google Play), `signing.keystore` plus its passwords (back these up; you cannot update the app without them) and `assetlinks.json`.
4. Upload `assetlinks.json` to `/.well-known/assetlinks.json` on your host and redeploy (put it in a `.well-known` folder here). Without it the app opens with a browser URL bar.
5. Google Play needs a developer account (one-time US$25).

## 4. iOS
PWABuilder > Package for stores > iOS gives an Xcode project. It needs a Mac and an Apple Developer account (US$99/yr), and Apple may reject thin web wrappers. Alternative: open the site in Safari > Share > Add to Home Screen (the app shows a one-time hint).

## 5. Releasing updates
Edit anything, then bump `VERSION` in `sw.js`. Users get an "Update" banner; accepting it reloads into the new version.

## Files
- `index.html`: your app, with the engine code unchanged
- `assets/tailwind.css`: Tailwind compiled from index.html (re-run: `npx tailwindcss@3 -i in.css -o assets/tailwind.css --minify` with content `./index.html`)
- `assets/app.css`, `assets/pwa.js`: mobile layer, gestures, install/update UI, autosave
- `sw.js`, `offline.html`, `manifest.json`, `_headers`
- `icons/`, `screenshots/`, `tools/icon-generator.html` (canvas), `tools/build-icons.mjs` (SVG to PNG via sharp)
