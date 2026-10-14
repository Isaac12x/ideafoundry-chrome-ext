# Changelog

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
