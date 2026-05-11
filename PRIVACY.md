# RatVault Lite — Privacy Policy

_Last updated: 2026-05-05_

RatVault Lite is a thin-client browser extension that connects to a **RatVault server you run on your own computer**. It is designed for privacy by construction.

## What we collect

**Nothing.** RatVault Lite has no analytics, no telemetry, no crash reporting, and no developer-side servers. The author cannot see what you do with the extension.

## What is stored locally

The extension stores the following in `chrome.storage.local` on your device only:

- `serverUrl` — the URL of your local RatVault server (default: `http://localhost:8055`).
- `theme` — your selected accent color.
- `defaultSurface` — popup vs side panel preference.

This data never leaves your machine.

## Where data is sent

When you use the extension, it sends data **only** to the server URL you configure. The default and only host permissions in the manifest are:

- `http://localhost:8055/*`
- `http://127.0.0.1:8055/*`

If you change the server URL to something else, you would also need to grant additional host permissions; the extension cannot silently expand its network reach.

The following user actions trigger HTTP requests to your local server:

| Action | Endpoint |
|---|---|
| Health check | `GET /health` |
| Open the Vault tab | `GET /api/entries` |
| Send a chat message | `POST /api/chat` |
| Click "Reindex" | `POST /api/reindex` |
| Right-click → Save selection / image / page | `POST /api/inbox/upload` |

No request is made to any third party.

## Permissions justification

| Permission | Reason |
|---|---|
| `storage` | Save server URL and theme on your device. |
| `contextMenus` | Provide right-click "Save to RatVault" entries. |
| `sidePanel` | Optional side-panel UI for the same features as the popup. |
| `notifications` | Confirm save success or surface failures from the local server. |
| `activeTab` + `scripting` | Read the current page's selection / text only when you click a context-menu item. The extension never auto-injects content scripts. |
| Host permission `localhost:8055` / `127.0.0.1:8055` | The user's own RatVault server is the sole network destination. |

## Remote code

The extension contains no remote code. All scripts are bundled inside the extension package, and the manifest's Content Security Policy blocks loading any script that isn't part of the extension.

## Contact

Issues or questions: open an issue on the GitHub repository.
