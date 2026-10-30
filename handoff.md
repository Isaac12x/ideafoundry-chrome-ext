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

## 2026-10-14 — 0.3.2 diagnostics-driven ChatGPT correction

The supplied live diagnostics exposed the actual mismatch: ChatGPT used `.bg-user-message` with nested `.text-size-chat.whitespace-pre-wrap`, and none of the previously recognized role, article, turn, or prose markers. The adapter now recognizes that prompt markup and recovers unmarked reply branches anchored to those prompts. Inferred speakers are explicitly labeled Message with a preview warning; prompt-only detection warns about incomplete capture. The wildcard origin and IdeaFoundry 8443 configuration remain supported.

Luna implementation agents updated extraction, controls, diagnostics, and browser coverage. An independent Luna reviewer found excluded source branches could leak into capture. Root then reproduced that issue and identified root-level media omission and mixed composer collapse. Fresh Luna fix agents bounded traversal, rejected excluded source branches, split mixed branches into safe nodes, preserved direct media, and repaired media bounds within shared wrappers. Root reviewed the resulting source and reran the original leak reproduction successfully.

Diagnostics v2 samples non-user paragraphs/media even when prompts match, without transcript text or media URLs. Copy diagnostics is available in recognized conversations as well as empty states. The launcher starts closed. Inferred replies and images participate in section collapse and selection; collapse does not remove them from exports. The existing pending media-bound improvement from the prior turn is included in this release.

Validation: root `npm test` passed 58/58; the final build and complete Playwright browser suite passed. The browser fixture uses the exact supplied prompt ancestry plus neutral reply, table, and image containers without old message selectors; it tests both gutters, repeated capture, collapsed export, selection/media exclusion, single-prompt replies, and retains existing PDF/KB/remote checks. Root inspected `artifacts/reported-layout-sections.png`; expand controls and composer remain visible after both sections collapse. `git diff --check` passed.

Live assistant markup was not provided, so structural recovery is verified against fixtures rather than the user's authenticated live page. Reload the unpacked extension from dist/ and refresh existing ChatGPT tabs to use version 0.3.2. No Git remote is configured, so publishing a PR and monitoring its comments are unavailable.

## 2026-10-14 — 0.3.3 complete collapse and compact side control

The user confirmed detection worked but supplied an Arc screenshot showing collapsed replies leaving reference chips, empty gallery cards, actions, and large gaps. The widget also counted inferred fragments as 31/116 messages, and the large floating section card was intrusive.

Luna agents separated structural collapse targets from sanitized export nodes, grouped adjacent inferred fragments into logical replies, and replaced the large floating card with a compact accessible chevron. The side control hides when its active section is collapsed; inline Expand and panel controls remain available. Inline checkboxes now explicitly retain native appearance under provider styles. Complete reply wrappers and safe presentation-only siblings collapse together while next prompts, page navigation, and composers remain available.

An independent Luna review identified omitted standalone action siblings and overmerging distinct unlabeled provider turns. Root reproduced the sibling issue, and a fresh Luna fix agent added bounded presentation sibling coverage and preserved explicit turn boundaries. Browser testing then exposed aria-hidden sibling cards with text being rejected as meaningful content; the fix agent corrected classification, and the complete browser suite was rebuilt and rerun successfully. Media IDs remain unique across merged fragments, and original canvas nodes are retained for conversion.

Final validation: root `npm test` passed 61/61; `npm run build` and `npm run test:browser` passed on the final implementation. Browser assertions check nested and sibling gallery shells, references, action rows, height reduction, restoration, next-section/composer safety, collapsed export/media, compact controls, and existing PDF/KB/queue workflows. Root performed a separate controller reproduction through collapse, refresh, export, and expansion and inspected the compact-control screenshot at `artifacts/reported-layout-before-collapse.png`. `git diff --check` passed.

The user's authenticated Arc page was not directly inspected; fixtures reproduce the reported structural cases. Reload the extension and refresh existing ChatGPT tabs to use 0.3.3. No Git remote is configured, so PR publication and comment monitoring remain unavailable.

## 2026-10-14 — 0.3.4 visual refinement

Applied the requested frontend-design skill to unify the injected conversation controls, popup, and settings around warm paper surfaces, forest accents, editorial headings, and consistent spacing. The closed launcher is now compact, long section lists scroll within a bounded panel, narrow windows retain all actions, and inline headers align with their content column. Focus indicators and reduced-motion handling remain explicit.

Luna agents implemented the UI and browser layout coverage. An independent Luna review identified inline headers extending beyond their parent content column. Root reviewed the screenshots afterward and also found the side chevron overlapping reply text. A fresh Luna fix pass corrected header border-box sizing and replaced median section edges with the full horizontal content span for rail placement. Resize invalidates cached geometry while preserving pinned-section behavior. Browser assertions cover both findings. A repeated settings image was a full-page screenshot artifact; settled viewport capture and a single-main assertion verified the actual page structure.

Root inspected the corrected desktop controls, short-window panel, popup, and settings screenshots. Layout coverage now includes 360px/390px widths, a 360x480 viewport, long labels and twelve-section scrolling, settings focus, and existing capture/export/KB workflows. The browser uses isolated fixtures rather than the user's authenticated live pages.

Version is 0.3.4. Reload the unpacked extension from dist/ and refresh existing conversation tabs. No Git remote is configured, so a PR cannot be published or monitored.

Final root verification: `npm run check` passed (61/61 tests and production build), `npm run test:browser` passed, and `git diff --check` passed. The build output is ready in dist/; visual artifacts remain ignored in artifacts/.

## 2026-10-14 — 0.3.5 unified capture widget

The on-page widget now owns format selection, Markdown preview, download, knowledge-base delivery, settings access, media authorization, and diagnostics. The toolbar opens this widget; popup sources and build entries have been removed. The expanded panel is wider and remains scrollable in narrow or short windows. Selection is reread on export and reflected in the preview. Empty detection retains settings and diagnostics.

Luna agents implemented source changes and browser coverage, followed by an independent Luna review and a root review. Root identified that flex shrinking could leave the section list unusably short at 360x480; a fresh Luna agent changed the body to normal scrolling flow and reserved usable list height. Root inspected the corrected screenshot showing section controls and save actions reachable in the short window, as well as desktop and narrow export screenshots.

Automatic content-script widgets capture locally, so exporting does not require clicking the toolbar first to grant activeTab. The service worker handles privileged exports and restricts legacy settings/queue/export messages to extension pages. Cross-site media permission is requested explicitly through the widget's Allow media access action. Existing page-owned media limits, selection, collapse, and remote capture behavior remain in place.

Root unit validation passed 61/61 and git diff --check passed. Production build is in dist/. Browser validation uses isolated fixtures, not the user's authenticated live conversations. Reload the unpacked extension and refresh conversation tabs to use 0.3.5. No Git remote is configured, so PR publication and comment monitoring are unavailable.

Final browser validation passed (`npm run test:browser`): selected Markdown KB upload, PDF download action, diagnostics, settings, existing PDF/media/remote workflows, and 360x480 section selection plus reachable send action. A separate profile without explicit ChatGPT host permissions verified automatic widget capture/download. The real media permission API accepted the click gesture but left its native prompt pending in headless Chromium; the test records this and substitutes denial after 2.5 seconds. Native permission acceptance/denial itself was not automated.

## 2026-10-14 — 0.3.6 CSS side chevron

Replaced the side control's text glyph with an empty CSS ::after shape. The button retains its accessible section label, title, keyboard behavior, hit area, and collapse action; a direction attribute mirrors the shape toward the conversation.

A Luna implementation agent made the change and an independent Luna reviewer identified lateral bias from centering a rotated border box rather than the visible strokes. Root confirmed that geometry, and a fresh Luna fix agent replaced it with a centered 7x10px clipped polygon. Root reviewed the final CSS and real Chromium close-up of both directions at artifacts/chevron-directions.png. Updated existing unit and browser assertions to check the text-free control and pseudo-element rendering. Root unit tests passed 61/61 and git diff --check passed.

Reload the unpacked extension from dist/ and refresh existing conversation tabs for version 0.3.6. No Git remote is configured, so publishing a PR and monitoring comments remain unavailable.

Final validation: npm run check passed (61 tests and production build); npm run test:browser passed on rerun. The first browser attempt passed the chevron assertions but timed out in the existing final media-permission/download fixture; the repeat passed the complete suite.

## 2026-10-15 — 0.3.7 ordered sections and formatted exports

The user reported collapsed cards collecting at the top, incomplete exports with unrelated images, literal Markdown in PDFs, and repeated media authorization prompts. Luna implementation agents handled collapse, extraction/PDF, and permissions. An independent Luna review found that the first PDF table workaround dropped embedded images; root reviewed afterward and requested fresh Luna fixes for the renderer and hidden-root/canvas extraction cases.

Section headers now use the earliest collapse target in DOM order and inherit its CSS order, keeping later collapsed cards below earlier expanded replies in flex layouts. Split assistant prose blocks and sibling tables are captured together. Hidden provider branches are excluded while extension-collapsed selected content stays available. Canvas clones retain their original source mapping after hidden content is pruned.

PDF generation now parses Markdown into pdfmake content rather than printing Markdown syntax. The renderer covers tables, emphasis, headings, lists, links, code, and referenced media. HTTP(S) host access is declared at installation; the per-page Allow media access widget action and optional settings permission request are removed. Chrome’s extension site-access settings remain authoritative, and the settings page explains that control. Remote capture remains restricted by the configured allowlist.

Version is 0.3.7. Reload dist/ in Chrome/Arc and refresh existing conversation tabs. Provider layouts were tested with fixtures; the user's authenticated live conversation was not available for direct comparison. Only loaded DOM content can be exported. No Git remote is configured, so PR publication and comment monitoring remain unavailable.

Final root verification: `npm run check` passed with 72/72 tests and production build. Root inspected the formatted PDF raster at `artifacts/formatted-export.png` and the mixed expanded/collapsed browser screenshot at `artifacts/ordered-collapse.png`, then reviewed the final renderer and extraction fixes. PDF tests exercise actual generation with table-cell images, nested lists, code, and companion references. Browser download assertions use Chrome's download records because extension-initiated downloads do not emit the page download event and Playwright assigns temporary filenames. Artifacts are ignored by Git.

Final `npm run test:browser` passed against the final build, including geometric ordering of collapsed cards, automatic cross-site media ZIP export with zero permission requests, actual PDF/media generation, selection, KB uploads, remote jobs, and responsive widget behavior. `git diff --check` passed.

## 2026-10-15 — URL scope and settings access regression fixes

Luna agents implemented URL/content lifecycle fixes, settings access, and browser regressions; root orchestrated, reviewed the changes, and isolated the commit from unrelated existing and concurrent KB/media work.

A bare origin (for example https://chatgpt.com) stays root-only after settings save/load. An origin ending in /* matches non-root paths only. The previous settings migration silently changed bare origins to wildcards. Content scripts also attempted to read storage restricted to trusted extension contexts, preventing automatic activation. Content now requests only parsed capture URL rules from the background worker, which broadcasts changes without exposing queue credentials. A singleton route monitor handles SPA transitions even when no widget exists; revision and execution guards prevent delayed reads or older injections from overwriting current state.

Toolbar clicks wait for content initialization, and open Settings on excluded/browser-internal pages or injection failure. The action context menu opens Settings; the manifest uses options_ui. Reload the unpacked dist/ extension and refresh existing tabs to replace old scripts. If earlier saves converted a bare origin to /*, enter and save the intended pattern again.

Verification: root exported the staged commit to an isolated temporary checkout (excluding unrelated KB/media edits). Its 85 unit tests and production build passed. Browser fixtures cover real options save/reload, existing-tab visibility updates, root-to-path and path-to-root pushState navigation, capture/export, and settings access. These are isolated browser fixtures, not the user's signed-in ChatGPT session. The working-tree dist/ build was also refreshed.

No Git remote is configured, so PR publication and PR-comment monitoring are unavailable. Unrelated working-tree edits remain uncommitted.

Final isolated-checkout verification passed: `npm run check` (85 tests and build), `npm run test:browser`, and `git diff --cached --check`. An initial isolated browser run found that a pre-existing download-status assertion depended on an unrelated uncommitted wording change; that assertion change was excluded from this commit and the complete browser suite then passed.

## 2026-10-21 — 0.3.8 layout-faithful exports

The extension now builds an export-only snapshot from selected message DOM and its shared `main`/thread ancestors. It prunes unrelated and unchecked sections, inlines computed visual styles (including flex/grid placement), and temporarily removes the extension's collapsed class while measuring so checked collapsed turns remain visible in the export. The snapshot is created only for HTML/PDF export, not preview refreshes. Standalone HTML embeds successfully retrieved media and retains source URL, capture time, and provider metadata.

PDF now opens a dedicated extension print view, which uses Chromium's HTML/CSS print renderer. The browser's native print dialog must be completed with **Save as PDF**; browser print settings determine page size, scale, and margins. PDF cannot be sent directly to the KB or by unattended remote jobs because those paths cannot complete the interactive dialog; the widget disables PDF-to-KB with guidance. Markdown and HTML can be sent to the KB, and remote Markdown remains supported. `README.md` records these constraints.

The print handoff uses a one-use random token and extension-origin IndexedDB, avoiding a broadcast payload to unrelated extension tabs. The print view parses and sanitizes the snapshot before displaying it, removes executable/resource-loading elements and event attributes, and allows embedded data images. External page stylesheets and fonts are not bundled, so some pages may fall back to locally available fonts/colors. External CSS background images are omitted to keep HTML portable and avoid third-party requests on open. The captured page includes messages currently loaded in the DOM only.

Regression coverage verifies computed colors, code/content retention, common flex/grid ancestors, unselected content pruning, collapse-state restoration, data-image embedding, HTML KB upload, disabled PDF-to-KB, and Chromium-generated PDF bytes. Browser fixtures are isolated and do not compare an authenticated live provider conversation. Review artifacts are written under ignored `artifacts/`.

## 2026-10-21 — export fidelity and safety pass

The follow-up pass preserves SVG sizing and local gradient references, table edge borders, and shared layout after unselected content is pruned. Standalone HTML and print snapshots remove active elements, event handlers, unsafe URLs, and remote resource loads while retaining normal links and inert downloadable attachments. Missing styled snapshots now fail explicitly. Export controls restore their format-specific disabled state after an export completes.

Verification: `npm run check` passed (92 tests and production build), `npm run test:browser` passed, and `git diff --check` passed. The browser fixture compares source and standalone export geometry for a loaded chart image and SVG, and creates an eight-page PDF whose table, code, and final-page sentinel text were checked with `pdftotext`. Review artifacts: `artifacts/layout-source-viewport.png`, `artifacts/layout-export-viewport.png`, `artifacts/captured-layout.html`, and `artifacts/captured-layout.pdf`. The Chromium print-tab screenshot can show an extra provenance header after the print dialog is invoked; this is a headless print-media screenshot artifact. The standalone HTML screenshot verifies a single static provenance header, and the rendered PDF was reviewed separately. Fixtures use isolated pages rather than authenticated provider sessions; external stylesheets/fonts are not bundled.

Publication: committed as `55eed20` on `feat/layout-faithful-exports`, pushed to `origin`, and opened [PR #1](https://github.com/Isaac12x/ideafoundry-chrome-ext/pull/1) against `main`. The change is ready for review and was not merged. Root reported 92/92 unit tests and the quality/browser suites passing; visual PDF/source comparison was reviewed by root and Luna. Monitor PR feedback and CI before merge.


## 2026-10-30 — ChatGPT streamed reply coverage and scroll clearance

Root reviewed the Luna implementation. ChatGPT discovery now collects uncovered element branches from reply shells that also contain a reported prose candidate, so detached code and prose remain in export and collapse with their prompt. A mutation-refresh regression checks that streamed content appended after collapse is hidden while remaining exportable. The extraction helper recurses through elements; direct text nodes that are siblings of a reported candidate are not separately inferred.

The associated docking/scroll-clearance change keeps the final reply reachable above the fixed composer; its docking code is included because clearance calculations depend on it. Unrelated background changes remain uncommitted.

Verification: `npm run check` passed (95 tests and production build), `npm run test:browser` passed, and `git diff --check` passed. The browser test confirms the final marker is covered with clearance disabled, then visible with clearance enabled and after composer growth without a window resize. Root reviewed `artifacts/provider-layout-composer-bottom.png`. These are constructed fixtures, not the user's authenticated live ChatGPT DOM. Reload the unpacked extension from `dist/` and refresh ChatGPT tabs to apply the fixes.
