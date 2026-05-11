# RatVault Lite

Personal knowledge vault — browse, search, and chat with your local markdown notes. No server, no cloud, no tracking. All data stays on your device.

## Features

- Markdown vault with full-text search
- AI chat with your notes (OpenRouter, OpenAI, Anthropic, or custom endpoint)
- Local keyword search (no API needed)
- URL capture — save links as markdown with auto-tagging
- Offline support via service worker
- File System Access API (Chrome/Edge) — reads and writes real `.md` files on disk
- IndexedDB fallback (Firefox/Safari) — import files and store in browser storage

## Install as PWA

### Android

1. Open the app in **Chrome**
2. Tap the three-dot menu (top right)
3. Tap **"Add to Home Screen"**
4. Confirm the name and tap **"Add"**

Chrome may also show an install banner automatically.

### iOS

> Safari only — Chrome on iOS cannot install PWAs.

1. Open the app in **Safari**
2. Tap the **Share button** (box with arrow pointing up, bottom toolbar)
3. Scroll down and tap **"Add to Home Screen"**
4. Confirm the name and tap **"Add"**

After install, the app opens in standalone mode (no browser chrome). Works offline after the first visit — the service worker caches all app assets. If you reinstall or clear app data, pick the same vault folder and your notes reload automatically.

## Self-Hosting / Running Locally

No build step required.

```bash
# Serve the folder locally
python -m http.server 8080
# then open http://localhost:8080
```

Or open `index.html` directly in Chrome/Edge (file:// — FS API and service worker won't work, but basic vault browsing does).

## API Key Setup

1. Open the **Settings** tab
2. Choose a provider (OpenRouter recommended — access to many models with one key)
3. Paste your API key — stored in IndexedDB on-device only, never sent anywhere except your chosen API endpoint

## Browser Compatibility

| Feature | Chrome / Edge | Firefox | Safari (desktop) | iOS Safari |
|---|---|---|---|---|
| File System Access (read/write disk files) | Yes | No | No | No |
| IndexedDB fallback (import files) | Yes | Yes | Yes | Yes |
| PWA install | Yes | No | No | Yes |
| Offline support | Yes | Yes | Yes | Yes |

## Privacy

See [PRIVACY.md](PRIVACY.md).
