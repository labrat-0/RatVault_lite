# RatVault Lite — Privacy Policy

_Last updated: 2026-05-16_

RatVault Lite is a **local-first Progressive Web App** for browsing, searching, and chatting with your own markdown notes. It is designed for privacy by construction: there is no backend, no account, and no developer-side infrastructure.

## What we collect

**Nothing.** RatVault Lite has no analytics, no telemetry, no crash reporting, and no developer-side servers. The author cannot see what you do with the app, what notes you keep, or that you use it at all.

## Where your data lives

| Data | Location |
|---|---|
| Your markdown notes | Real `.md` files on your own disk (Chrome/Edge, via the File System Access API) **or** in your browser's IndexedDB (Firefox/Safari fallback) |
| Your API key | Your browser's IndexedDB, on this device only |
| Settings (provider, theme, preferences) | Your browser's IndexedDB / localStorage, on this device only |
| App assets (HTML, JS, CSS, icons) | Cached by the service worker for offline use |

None of this data is transmitted to the author or to any third party by the app itself.

## Where data is sent

RatVault Lite makes network requests in only two situations:

1. **Loading the app** — your browser downloads the static app files from the host serving it (e.g. `vault.ratlabs.tech`). After the first visit the service worker serves these from cache; the app then works fully offline.
2. **AI chat** — when *you* send a chat message, the relevant notes and your prompt are sent **directly from your browser to the AI provider you chose and configured** (OpenRouter, OpenAI, Anthropic, or a custom endpoint). Your API key authenticates that request.

If you never enter an API key and never use AI chat, RatVault Lite makes **no outbound requests at all** beyond loading the app.

## Third-party AI providers

When you use AI chat, your prompt and note content are processed by the provider you selected. Their handling of that data is governed by **their** privacy policy and terms — review them before sending sensitive notes:

- OpenRouter — https://openrouter.ai/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Anthropic — https://www.anthropic.com/legal/privacy

RatVault Lite does not proxy, log, or retain any of this traffic — it goes straight from your browser to the provider.

## Your control

- Delete your API key any time in **Settings** — it is removed from IndexedDB.
- Clear all local app data via your browser's site-data controls.
- Your `.md` files are plain text on your own disk; the app never deletes them without your action.

## Remote code

The app loads no remote code. All scripts are bundled and served as static files, and a strict Content Security Policy blocks loading any script from another origin.

## Contact

Issues or questions: open an issue on the GitHub repository.
