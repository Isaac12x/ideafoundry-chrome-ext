// Runs in the app tab's isolated world. Cookies and CSRF stay with the app origin.
export async function uploadInApp(file, settings) {
  try {
  if (location.origin !== settings.appUrl) throw new Error('The app tab changed origin.');
  const timeout = () => AbortSignal.timeout(20_000);
  const page = await fetch('/knowledge-base', { credentials: 'same-origin', signal: timeout() });
  if (!page.ok || new URL(page.url).pathname !== '/knowledge-base') throw new Error('Open IdeaFoundry and unlock the workspace before sending to KB.');
  const doc = new DOMParser().parseFromString(await page.text(), 'text/html');
  const csrf = doc.querySelector('meta[name="csrf-token"]')?.content;
  if (!csrf) throw new Error('The app did not provide a CSRF token. Unlock the workspace and retry.');
  const body = new FormData();
  body.append('src', String(settings.source));
  body.append('dir', settings.directory);
  const files = file.files?.length ? file.files : [{ name: file.name, mime: file.mime, base64: file.base64 }];
  if (!files.length) throw new Error('The export has no files.');
  for (const entry of files) {
    const binary = atob(entry.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    body.append('files[]', new Blob([bytes], { type: entry.mime }), entry.name);
  }
  // JSON requests get explicit 4xx errors from fs_error and lock checks.
  // Do not follow the success redirect: KB has an HTML view, not a JSON view.
  const response = await fetch('/knowledge-base/fs/upload', {
    method: 'POST', credentials: 'same-origin', signal: timeout(), redirect: 'manual',
    headers: { Accept: 'application/json', 'X-CSRF-Token': csrf }, body,
  });
  if (response.type === 'opaqueredirect') return { ok: true, name: file.name, appUrl: `${settings.appUrl}/knowledge-base?src=${settings.source}` };
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(details.error || `KB upload failed (${response.status}).`);
  }
  throw new Error('Unexpected upload response. Check the KB before retrying to avoid duplicates.');
  } catch (error) {
    return { ok: false, error: error.message };
  }
}
