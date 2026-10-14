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

# Handoff — 0.2.0 conversation sections (2026-10-14)

## Requested behavior and implementation

The user requested grouped, collapsible user-prompt/reply sections and checkboxes controlling exports. They subsequently clarified that collapse must be reachable from the blank left/right conversation margin while reading any part of a long response, and that the floating widget must start closed and open only on click. Broader widget redesign was explicitly deferred.

- `src/controls.js` manages inline restore headers, a side-margin control for the current section, the closed-by-default bulk widget, selection/collapse state, cleanup, and SPA updates.
- The margin control tracks the section being read and stays pinned immediately after collapse for expansion. It adapts to available space and recomputes position when the window changes size.
- Safe outer message containers are collapsed to avoid leaving large empty areas. Native chat nodes are not reparented; source content remains available for export.
- `src/extract.js` separates lightweight section discovery from Markdown conversion. Provider identifiers and DOM identity preserve choices across updates; repeated prompts get distinct section identities.
- Static content scripts recognize ChatGPT, Claude, and Gemini. Other pages activate through the popup.
- The popup rereads the current selection before each export. Collapsed checked sections are included; unchecked sections are excluded from Markdown, PDF, and KB uploads. Empty selection fails explicitly. Remote jobs deliberately capture all loaded sections in their own tab.

## Review and testing process

Implementation and browser tests were delegated to Luna agents as requested. An independent Luna reviewer examined the changes, followed by root review. Further Luna fixes addressed speaker merging in nested wrappers, identity shifts on duplicate prompts and partial rerenders, keyboard focus, DOM ID collisions, teardown, streaming performance, side-margin placement, and pinned-control lifecycle behavior.

The browser harness uses long nested, centered conversation fixtures, a strict style CSP, real extension injection, and the existing KB contract fixture. It checks automatic controls, widget closed/open behavior, mid-response collapse/expand, collapsed height reduction, margin positioning, export selection, PDF renderer input, dynamic updates, navigation, and fresh popup export. Screenshot artifacts are ignored by Git.

## Remaining compatibility limits

Only loaded DOM messages are captured. Live authenticated provider sessions have not been exercised here; provider markup changes may require adapter updates. Where a provider supplies no stable message IDs and replaces several identical prompts simultaneously, identity matching is necessarily best effort. Selections are per page session and reset on navigation/reload. Remote jobs intentionally do not use another tab's selection.

This branch is `feat/collapsible-conversation-sections`. No Git remote is configured, so a PR cannot be published or monitored from this workspace.

## Final verification for 0.2.0

- Root reran `npm test`: all 17 tests passed.
- `npm run build`: passed with the final sources.
- `npm run test:browser`: passed with the final sources, including strict CSP, long-response margin collapse/restore, correct page-height reduction, resize while pinned, external-pointer retargeting, empty-page hiding/recovery, closed widget, selected Markdown/PDF, and fresh popup export.
- `git diff --check`: passed.
- Root visually reviewed the middle-of-conversation expanded/collapsed screenshots and reviewed the code after the independent Luna review. The captured side control is outside the centered conversation column; the closed widget exposes only its launcher/header.

After updating, reload the extension at `chrome://extensions` and refresh existing chat tabs to replace their previously injected controls.
