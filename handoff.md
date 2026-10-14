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

## 2026-10-14 — 0.3.0 provider detection and media capture

The user supplied a screenshot of a loaded ChatGPT project conversation whose popup reported no conversation. They also corrected the app port to 8443, requested that the closed launcher remain visible, and requested referenced documents and inline/nontext media in exports.

The manifest already matched every path on the supported origins. This change expands ChatGPT DOM discovery beyond author-role attributes to turn articles and accessible speaker labels, preserving ordering and excluding navigation. The closed launcher remains available with Retry when discovery is empty. The bundled app address is now `https://ideas.local:8443`, verified against the neighboring app README and a read-only HTTP response. The exact previous default migrates; other addresses remain unchanged.

Media metadata is retained at its original message position and filtered by selected sections. Same-origin authenticated media and page-owned blobs are read through the page; external resources require host access. Markdown with assets and PDFs with companion documents/media download as ZIP bundles. PDFs embed decodable images and identify unavailable resources in place. KB uploads use the existing multipart files[] endpoint. The actual app Markdown renderer was inspected: it does not rewrite relative media URLs, so KB documents use the existing `/knowledge-base/serve` endpoint while local bundles keep relative paths. Ordinary cited webpages stay links; linked downloadable documents are captured. No idea-app source changes were made.

Luna agents implemented detection, media export, and browser regressions. An independent Luna review ran next; root reproduced findings and reviewed the implementation, then delegated a fresh Luna fix pass for missed media-only/plain-article turns, filename handling, retrieval bounds, and KB asset addressing. Browser fixtures include a routed `https://chatgpt.com/g/.../c/...` page with alternate turn markup, a persistent collapsed launcher, side controls, and PNG/WebP/document exports. Root inspected the resulting launcher screenshot.

Live authenticated ChatGPT/Claude sessions were not available for inspection (browser-use CLI is absent). The fixture checks are not proof of compatibility with every live provider layout. Only loaded and accessible content can be captured; unsupported/denied media retains a note and source. Refresh existing tabs after reloading the rebuilt extension. Re-save Settings to grant the corrected IdeaFoundry origin if it was not previously permitted.

### Final verification and delivery

- Root final `npm test`: 39/39 passed.
- Final `npm run build`: passed; `dist/` contains version 0.3.0.
- Luna final `npm run test:browser`: passed against the final build, including ChatGPT project paths, persistent launcher, collapse/selection, real PDF image resources, KB serve URLs matching uploaded companion names, local ZIP paths, remote queue, lock errors, and popup recapture.
- Root reviewed source after the independent Luna review, reproduced its detection findings, checked the actual IdeaFoundry Markdown serving contract, and inspected the ChatGPT launcher screenshot. A fresh Luna agent fixed the resulting issues and added targeted tests.
- `git diff --check`: passed.
- No Git remote is configured; PR publication and comment monitoring are unavailable. Work remains on `feat/collapsible-conversation-sections`.

## 2026-10-14 — 0.3.1 follow-up on live detection and gutter clicks

The user supplied another screenshot showing the empty-state widget on a visibly loaded ChatGPT project conversation. They clarified that the whole blank left/right margin alongside a section must be clickable, and that a prompt-side toggle must appear.

Luna agents expanded class-based ChatGPT extraction and selected-root detection, added two-sided margin hit testing, and added routed browser fixtures with nested scrolling, unrelated main/sidebar regions, and full-width wrappers. The widget empty state now offers Copy diagnostics with a readonly fallback when clipboard access fails. Diagnostics report bounded structural samples and selector counts, omit transcript text/media attributes, and redact route identifiers.

An independent Luna reviewer examined the changes. Root then reproduced a full-width role-wrapper padding click that was still ignored. A fresh Luna fix agent addressed that case, gallery click protection, scroll clipping, sidebar exclusions, and repeated root-scoring work on scroll. Browser coverage retains the existing media, KB, queue, and popup workflows.

Live-page limitation remains: no matching ChatGPT tab was found through the available Chrome scripting interface; Arc/Safari scripting did not yield the target page. An optional browser-identification question was sent. The reported layout improvements are verified with browser fixtures, not the user's authenticated DOM. If the updated adapter still misses the user's page, Copy diagnostics provides structural evidence for the next correction without asking for the transcript.

### 0.3.1 final verification

- Root final `npm test`: 51/51 passed.
- Root final `npm run build` and `npm run test:browser`: passed against the final sources, including the controller reinjection/orphan-UI change.
- Browser coverage checks class-based project conversations, prompt toggles, both gutters, nested scrolling, full-width wrapper padding, gallery click protection, and the existing export/KB/remote workflows.
- Root reviewed the nested-scroll screenshot (`artifacts/provider-layout-sections.png`) and final source after the independent Luna review and fresh fix pass.
- Reinjection now replaces outdated controllers and rebuilds orphaned injected UI; same-version reinjection preserves selection state. Refreshing chat tabs after an extension update remains the simplest installation path.
- `git diff --check` passed. No remote is configured, so a PR cannot be published or monitored.
