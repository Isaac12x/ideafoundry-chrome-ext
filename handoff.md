# Handoff — 2026-10-14

## Delivered

New Chrome Manifest V3 extension in this repository. Build output is `dist/` (ignored by Git). It previews and exports loaded conversation messages as Markdown or PDF, sends files to the existing IdeaFoundry KB upload endpoint, and processes URL requests from the included authenticated queue service.

Read `VISION.md` and `README.md` before extending the project. The neighboring app's `VISION.md` was read and informed the capture/provenance design. `idea-app` was inspected but not modified.

## Architecture

- `src/extract.js`: provider selectors, cleaned HTML → Markdown, generic fallback.
- `src/background.js`: capture, offscreen rendering, downloads, app-tab upload, remote polling/recovery.
- `src/kb-upload.js`: same-origin app session + CSRF upload to `/knowledge-base/fs/upload`.
- `src/offscreen.js`: local PDF/Markdown generation, bundled fonts, Blob download URLs.
- `src/popup.*`, `src/options.*`: preview/export and connection settings.
- `server/queue.mjs`: authenticated durable single-process job queue; the queue never receives conversation text.
- `scripts/browser-test.mjs`: isolated Chromium extension tests with fixture host permissions.

## Operational notes

User must load `dist/` into Chrome, grant optional origin access in Settings, and configure their app address/source/folder. For remote capture, start the queue with a strong `QUEUE_TOKEN`, configure the same token in the extension, and enable remote requests. Remote jobs always send to the configured KB. No token was generated or installed for the user's actual browser.

Capture is limited to loaded DOM content. Generic fallbacks require manual preview; they cannot be used for automatic remote capture. PDF retains Markdown notation, with Roboto font coverage (Latin/Greek/Cyrillic). See README for limitations and API examples.

Uncertain uploads are not automatically repeated. Results survive worker restarts in local extension storage; claimed jobs time out after five minutes. Queue files require one process per store. Do not reuse one queue across multiple browser profiles.

## Repository

The workspace was initially empty and had no Git repository. Initialized a repository to satisfy the requested commit workflow. No remote is configured, so publishing a PR and monitoring PR comments are unavailable until a remote is supplied.

## Verification completed

- `npm test`: 8 tests passed.
- `npm run build`: passed; unpacked extension is ready in `dist/`.
- `npm run test:browser`: passed in Chrome for Testing 156 with isolated local fixtures. Covered extraction, actual Markdown/PDF generation, same-origin CSRF upload, workspace-lock rejection, remote capture → KB completion, origin rejection, Blob output, and popup rendering.
- `npm audit --omit=dev`: no known vulnerabilities reported.
- Visually reviewed `artifacts/popup.png`; generated PDF fixture is at `artifacts/conversation.pdf` (both ignored).

The browser fixture deliberately has no JSON KB index view, matching Rails: successful uploads acknowledge the manual redirect instead of following it with `Accept: application/json`. Extension message authorization permits extension pages opened in tabs while rejecting website senders.

Live authenticated ChatGPT/Claude/Gemini sessions and the user's running IdeaFoundry instance were not exercised. Confirm those after loading the extension and setting the destination. Provider DOM drift and unsupported PDF font glyphs remain the main compatibility limits.
