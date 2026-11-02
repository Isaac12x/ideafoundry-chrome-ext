# Changelog

## Unreleased

- Keep the ChatGPT capture tab attached to the top border of the visible typing input with a one-pixel overlap; preserve native scrolling and keep the floating panel inside the available viewport.
- Preserve native scroll geometry when the ChatGPT composer is sticky inside the conversation scroll root, preventing bottom padding from pulling the composer and capture tab upward.
- Capture and collapse ChatGPT reply fragments that stream beside reported prose, including code panels appended after a section is collapsed.
- Collapse read-only code textboxes and detached code frames with their section while keeping editable composers, neighboring prompts, and unrelated readonly fields available.
- Add export-only shared DOM/layout snapshots for standalone HTML and Chromium print-based PDF; inline computed layout styles, preserve selected collapsed content, and embed resolved media.
- Make PDF open the browser print dialog so the PDF uses Chromium's HTML/CSS renderer. Choose “Save as PDF” to download; PDF-to-KB and remote PDF jobs report that interactive limitation.
- Allow standalone styled HTML downloads and direct HTML knowledge-base uploads. Markdown output remains unchanged.
- Preserve SVG dimensions and local gradients, individual table borders, and layout context after unchecked content is pruned.
- Sanitize standalone and print snapshots, retaining safe links and inert media attachments while removing active content and remote resource loads.
- Reject incomplete styled export snapshots instead of silently producing blank HTML or PDF files.

- Preserve root-only capture URLs when saving and loading settings; `/*` matches non-root paths only.
- Update widget visibility when settings change or a site navigates without reloading.
- Read capture URL rules through the background worker while keeping private connection settings restricted.
- Keep settings reachable from the toolbar on excluded or unsupported pages, and wait for widget initialization before opening it.

## 0.3.7 — 2026-10-15

- Keep collapsed section cards in conversation order on layouts with CSS-ordered turns.
- Exclude hidden conversation branches and unrelated hidden media from capture while preserving selected collapsed content.
- Render Markdown as formatted PDF content, including tables, emphasis, headings, lists, links, and code.
- Include HTTP(S) media access in installation permissions and remove repeated media authorization from the widget.

## 0.3.6 — 2026-10-14

- Draw the side control chevron with a centered CSS pseudo-element instead of a font glyph, preserving inward direction and accessible button labels.

## 0.3.5 — 2026-10-14

- Consolidate Markdown/PDF selection, download, knowledge-base delivery, preview, settings, and diagnostics in the on-page capture widget.
- Replace the toolbar popup with direct access to the widget.
- Give the widget more room while keeping controls usable on narrow and short windows.

## 0.3.4 — 2026-10-14

- Unify conversation controls, popup, and settings with warm paper colors, forest accents, and refined typography.
- Make the closed section launcher more compact and keep long section lists scrollable in narrow or short windows.
- Align inline section controls with the conversation column and refine button spacing and keyboard focus.
- Add browser layout coverage for long labels, narrow viewports, popup/settings overflow, and control positioning.

## 0.3.3 — 2026-10-14

- Collapse complete reply layouts, including gallery cards, reference controls, and action rows.
- Group inferred reply fragments as logical messages while preserving media and section selection.
- Replace the floating section card with a compact side chevron that hides for collapsed sections.
- Keep inline selection checkboxes visible under provider styling.

## 0.3.2 — 2026-10-14

- Added ChatGPT `bg-user-message` support based on supplied live-page diagnostics.
- Added user-anchored recovery of unmarked reply content, with an explicit inference warning.
- Expanded structural diagnostics to include non-user content even when prompt selectors match.
- Kept media within collapse groups and outside side-control placement.

## 0.3.1 — 2026-10-14

- Broadened ChatGPT detection to class-based message layouts and improved conversation-root selection.
- Added left and right gutter click targets for collapsing the adjacent prompt/reply section.
- Added structural diagnostics to the empty-state widget for investigating unrecognized live layouts.
- Added nested-scroll and class-based provider browser regression coverage.

## 0.3.0 — 2026-10-14

- Recognize alternate ChatGPT turn markup, including project conversations, without capturing sidebar content.
- Keep the section launcher visible and initially closed when message detection is empty, with a retry action.
- Default IdeaFoundry to `https://ideas.local:8443` and migrate the previous bundled address.
- Preserve media positions, embed images in PDFs, and include downloadable references and media companions in local exports and KB uploads.
- Add bounded media retrieval, session-aware page reads, optional external-site access, and explicit unavailable-media notes.
- Add ChatGPT project-path browser fixtures and media export regression coverage.

## 0.2.0 — 2026-10-14

- Added automatic conversation controls on ChatGPT, Claude, and Gemini.
- Grouped each user prompt and following replies into a collapsible section with an export checkbox.
- Added margin controls reachable while scrolling a long section, and a widget that starts closed until clicked.
- Added bulk selection/collapse controls and selection-aware previews, Markdown/PDF exports, and KB uploads.
- Kept collapse independent from selection and preserved section state through streaming updates.
- Added coverage for grouping, selection, dynamic conversations, and browser export flows.

## 0.1.0 — 2026-10-14

- Added a Manifest V3 Chrome extension with conversation previews and local Markdown/PDF export.
- Added ChatGPT, Claude, and Gemini extraction plus a reviewed generic-page fallback.
- Integrated direct file upload with IdeaFoundry's existing KB session/CSRF flow.
- Added optional remote capture through an authenticated, persistent Node.js job queue.
- Added per-origin permissions, remote allowlists, bounded payloads, job status, and interruption handling.
- Added unit/integration tests, an isolated browser test, and installation/remote API documentation.
