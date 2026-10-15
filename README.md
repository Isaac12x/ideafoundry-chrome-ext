# IdeaFoundry Conversation Capture

A Chrome Manifest V3 extension that saves LLM conversations as Markdown or PDF and sends either format directly to the knowledge base in `../idea-app`. Includes an authenticated queue service so a server can request capture by URL using your signed-in Chrome session.

## Install

Requires Node.js 22+ and Chrome 120+.

```sh
npm ci
npm run build
```

Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select this project's `dist/` directory. Pin **IdeaFoundry · Conversation capture**. Rebuild and click Reload on that page after code changes.

## Capture from Chrome

1. Open a conversation and load the messages you want to keep.
2. Use the injected section controls to expand or collapse turns and check the sections you want to export. Each section contains one user prompt and its following replies, up to the next user prompt.
3. Open the extension's on-page capture widget from the toolbar. Choose sections and Markdown or PDF there.
4. Choose **Download file** or **Send to knowledge base** in the widget. Settings and diagnostics are available in the same panel.

ChatGPT, Claude, and Gemini have dedicated extractors. Other sites with message-role attributes preserve speaker labels; other pages with a main/article region get a generic page preview. Arbitrary site layouts cannot be guaranteed. Generic page captures require manual review and are rejected for remote jobs. Sites that change their markup may require an extractor update.

Only messages currently present in the page DOM are captured. Load older messages before exporting. The extension preserves cited webpage links and captures visible image/media references and linked downloadable documents. Images keep their position in the transcript, including in PDF. Audio, video, and documents are represented by links and companion files; PDF does not play media. Unavailable resources receive an in-place note. Hidden branches and inaccessible artifacts cannot be recovered. Markdown preserves code fences, links, lists, and tables; PDFs render Markdown headings, emphasis, links, lists, code blocks, and tables as formatted content. Bundled Roboto supports Latin, Greek, and Cyrillic; use Markdown for scripts/emoji without font coverage.

Exports with companion files download as a ZIP containing the requested `.md` or `.pdf` plus a `media/` folder. Extract the ZIP before opening the Markdown so relative image links resolve. KB exports upload the document and companion files together, using IdeaFoundry file-serving links so images display in its Markdown preview. Local exports keep portable relative paths. HTTP(S) media access is included in the extension’s installation permissions; no per-page media prompt is needed. Chrome’s extension site-access settings can restrict this access; exports report inaccessible resources in the document. Remote jobs use the extension’s site access and report unavailable resources in the document. Media retrieval is limited to 50 resources, 8 MB per resource, and 20 MB total. Select fewer sections if the resource count is exceeded; resources exceeding byte limits are marked unavailable.

## Collapse and select conversation sections

All paths on ChatGPT, Claude, and Gemini are eligible for automatic controls, including ChatGPT project conversations (`/g/.../c/...`). The closed launcher stays visible even when no messages have been recognized; open it to retry detection. Use **Copy diagnostics** in the opened widget to share structural selector counts and ancestry without conversation text or media URLs. This is available both when detection succeeds and when it fails. Layouts with `bg-user-message` prompts and unmarked replies use user-anchored structural recovery; inferred content is labeled “Message” and carries a review warning rather than an assumed speaker label. Refresh already-open chat tabs after installing or reloading the extension. On other sites with identifiable message roles, open the extension once to activate the controls. Generic page captures without speaker boundaries remain whole-page previews.

Each turn has a checkbox and expand/collapse control. A compact chevron in the conversation’s side margin follows the expanded section you are reading, so you can collapse a long response without returning to its prompt. Clicking the blank left or right gutter alongside a section also toggles that section; sidebar navigation, links, and the composer retain their normal behavior. Collapsed sections hide their reply layouts, including gallery cards and reference controls, and keep a visible placeholder for expanding them again. The side chevron hides for a collapsed section. The floating widget starts closed; click it to open the bulk selection and collapse controls. All sections start selected and expanded. Collapse affects only the page display: **checked sections are exported even when collapsed**. Unchecked sections are omitted from both Markdown and PDF, including KB uploads. Selecting nothing prevents an export rather than silently exporting everything.

The widget reads the current selection again when you export. Selection and collapse state survive streaming updates and ordinary DOM refreshes within the conversation; newly added sections start selected. State resets when you navigate to another conversation or reload the page. Only messages loaded in the DOM can be grouped or exported.

Remote queue jobs use the full loaded conversation in their own tab. They do not borrow selections made in another tab.

## Connect the knowledge base

Open the extension's **Settings**:

- **IdeaFoundry address**: the exact origin you use in Chrome, for example `https://ideas.local:8443`. Use HTTPS outside localhost.
- **KB source index**: zero-based source number (`src` in the app's KB URL).
- **Folder within source**: an existing relative folder, or blank for the source root.

The default address is `https://ideas.local:8443`. The previous bundled `http://localhost:3000` value is upgraded to this address; custom addresses are preserved. Save the connection settings. Open/unlock IdeaFoundry before uploading. The extension uses the app tab's session and CSRF token, then posts multipart `files[]`, `src`, and `dir` to `/knowledge-base/fs/upload`. It reuses an existing app tab, or briefly opens an inactive one. It does not bypass the app's typing/recovery locks. No changes to `idea-app` are required.

The integration matches `KbController#fs_upload` and its JSON error / unfollowed redirect success contract as inspected on 2026-10-14. The app chooses a unique filename when one already exists. A network interruption after an upload can make its outcome uncertain: check the KB before retrying.

## Remote capture

The included queue is the server-side trigger. It can run beside IdeaFoundry or behind an HTTPS reverse proxy on another server. The extension polls it roughly every 30 seconds while Chrome runs; this is asynchronous, not an inbound connection to Chrome. One queue is intended for one paired browser profile. Any process holding its token can request captures from that browser's allowed origins.

Generate and retain a strong secret, then start the queue (the token is never printed by the server):

```sh
export QUEUE_TOKEN="$(openssl rand -hex 32)"
npm run queue
```

Default bind: `127.0.0.1:4318`. Configuration: `HOST`, `PORT`, `QUEUE_STORE` (default `.data/jobs.json`). Run only one queue process per store file. Use a process supervisor for unattended operation. For access from another host, terminate TLS at a reverse proxy; keep the queue behind that proxy. Do not expose bearer tokens over plain HTTP.

In extension settings, enter the queue origin and the same token, list permitted conversation origins (such as `https://chatgpt.com` and `https://claude.ai`), enable remote requests, and save. Sign into those sites in this Chrome profile. Automatic on-page controls are scoped to the supported chat sites. Access to the app, queue, and additional remote conversation sites is requested when saving settings; manual activation on other sites uses `activeTab`.

Submit a request from a server or terminal:

```sh
curl --fail-with-body http://127.0.0.1:4318/jobs \
  -H "Authorization: Bearer $QUEUE_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://chatgpt.com/c/YOUR-CONVERSATION-ID","format":"md"}'
```

Use `"format":"pdf"` for PDF. The response contains a job `id`. Check its result:

```sh
curl --fail-with-body "http://127.0.0.1:4318/jobs/JOB-ID" \
  -H "Authorization: Bearer $QUEUE_TOKEN"
```

States: `queued`, `running`, `completed`, `failed`. The extension opens an inactive conversation tab, waits for stable messages, exports locally, uploads to the configured KB, then closes the tab. Cross-origin redirects and unapproved origins fail. Sign-in pages do not become KB documents. Chrome must remain open, the conversation accessible, and the IdeaFoundry workspace unlocked.

Queue API (all routes require the bearer token):

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | Authenticated health check |
| POST | `/jobs` | Enqueue `{url, format}` |
| GET | `/jobs/:id` | Read job status |
| POST | `/jobs/claim` | Extension claims one job; 204 if empty |
| POST | `/jobs/:id/complete` | Extension reports `{state, filename?, error?}` |

Jobs persist across queue restarts. Result delivery is idempotent and retried by the extension. A worker interrupted during capture/upload is reported as failed, never automatically re-uploaded. Claimed jobs time out after five minutes (evaluated on the next request). The queue retains at most approximately 1,000 job records and admits at most 100 active jobs. It stores URLs, filenames, and status, **not conversation content**. Protect the store and token; URLs and filenames can still reveal private information. Browser storage contains the token locally, not in sync storage. Disable remote requests to stop future queue claims; in-progress uploads may finish.

## Verification

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Unit tests cover provider extraction, Markdown fidelity, validation, authentication, claims, persistence, and timeout behavior. Browser tests load the built extension into an isolated Chrome for Testing profile, load a local conversation fixture, and use a local server matching the IdeaFoundry KB contract. They exercise Markdown/PDF generation and upload, lock failures, remote jobs, origin rejection, and the on-page widget. The test copy grants fixture host permissions to avoid OS prompts; production declares HTTP(S) host access at installation. They do not access your personal browser profile or live conversations.

Chrome architecture references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [optional permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen), and [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms).
