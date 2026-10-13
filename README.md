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
2. Click the extension, review the conversation, and choose Markdown or PDF.
3. Choose **Download file** or **Send to knowledge base**.

ChatGPT, Claude, and Gemini have dedicated extractors. Other sites with message-role attributes preserve speaker labels; other pages with a main/article region get a generic page preview. Arbitrary site layouts cannot be guaranteed. Generic page captures require manual review and are rejected for remote jobs. Sites that change their markup may require an extractor update.

Only messages currently present in the page DOM are captured. Older virtualized messages, hidden branches, attachments, canvas/artifact contents, images, and audio are not fetched. Markdown preserves code fences, links, lists, and tables. PDFs paginate the transcript and retain Markdown notation inside messages; they are text documents, not screenshots of the chat interface. Bundled Roboto supports Latin, Greek, and Cyrillic; use Markdown for scripts/emoji without font coverage.

## Connect the knowledge base

Open the extension's **Settings**:

- **IdeaFoundry address**: the exact origin you use in Chrome, for example `http://localhost:3000`. Use HTTPS outside localhost.
- **KB source index**: zero-based source number (`src` in the app's KB URL).
- **Folder within source**: an existing relative folder, or blank for the source root.

Save and grant access to the app origin. Open/unlock IdeaFoundry before uploading. The extension uses the app tab's session and CSRF token, then posts multipart `files[]`, `src`, and `dir` to `/knowledge-base/fs/upload`. It reuses an existing app tab, or briefly opens an inactive one. It does not bypass the app's typing/recovery locks. No changes to `idea-app` are required.

The integration matches `KbController#fs_upload` and its JSON error / unfollowed redirect success contract as inspected on 2026-10-14. The app chooses a unique filename when one already exists. A network interruption after an upload can make its outcome uncertain: check the KB before retrying.

## Remote capture

The included queue is the server-side trigger. It can run beside IdeaFoundry or behind an HTTPS reverse proxy on another server. The extension polls it roughly every 30 seconds while Chrome runs; this is asynchronous, not an inbound connection to Chrome. One queue is intended for one paired browser profile. Any process holding its token can request captures from that browser's allowed origins.

Generate and retain a strong secret, then start the queue (the token is never printed by the server):

```sh
export QUEUE_TOKEN="$(openssl rand -hex 32)"
npm run queue
```

Default bind: `127.0.0.1:4318`. Configuration: `HOST`, `PORT`, `QUEUE_STORE` (default `.data/jobs.json`). Run only one queue process per store file. Use a process supervisor for unattended operation. For access from another host, terminate TLS at a reverse proxy; keep the queue behind that proxy. Do not expose bearer tokens over plain HTTP.

In extension settings, enter the queue origin and the same token, list permitted conversation origins (such as `https://chatgpt.com` and `https://claude.ai`), enable remote requests, and save. Sign into those sites in this Chrome profile. Site access is requested only when saving settings; manual capture uses `activeTab`.

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

Unit tests cover provider extraction, Markdown fidelity, validation, authentication, claims, persistence, and timeout behavior. Browser tests load the built extension into an isolated Chrome for Testing profile, load a local conversation fixture, and use a local server matching the IdeaFoundry KB contract. They exercise Markdown/PDF generation and upload, lock failures, remote jobs, origin rejection, and the popup. The test copy grants fixture host permissions to avoid OS prompts; production permissions remain optional. They do not access your personal browser profile or live conversations.

Chrome architecture references: [optional permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions), [offscreen documents](https://developer.chrome.com/docs/extensions/reference/api/offscreen), and [alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms).
