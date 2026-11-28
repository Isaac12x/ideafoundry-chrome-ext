// Service-worker KB calls: key-auth endpoints under the capture base (queueUrl), Bearer = queueToken. Work while the web app is locked.
export const NO_KEY = 'Add an API key in extension options to send to KB.';
export const requireKey = config => { if (!config.queueToken) throw new Error(NO_KEY); };

async function kbFetch(config, path, init) {
  requireKey(config);
  let response;
  try {
    response = await fetch(`${config.queueUrl}/kb/${path}`, {
      ...init, headers: { ...init?.headers, Authorization: `Bearer ${config.queueToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(20_000), redirect: 'error', credentials: 'omit',
    });
  } catch (error) {
    throw new Error(error instanceof TypeError ? 'Idea app not reachable' : error.message);
  }
  if (response.status === 401) throw new Error('API key invalid — update it in extension options');
  if (!response.ok) {
    const details = await response.json().catch(() => ({}));
    throw new Error(response.status === 422 && details.error ? details.error : `KB request failed (${response.status}).`);
  }
  return response.json();
}

export async function uploadToKb(file, config, dest) {
  const body = new FormData();
  body.append('src', String(dest.source));
  body.append('dir', dest.directory);
  const files = file.files?.length ? file.files : [{ name: file.name, mime: file.mime, base64: file.base64 }];
  for (const entry of files) {
    const binary = atob(entry.base64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
    body.append('files[]', new Blob([bytes], { type: entry.mime }), entry.name);
  }
  // No retry: the upload may already have reached the server.
  await kbFetch(config, 'upload', { method: 'POST', body });
  return { name: file.name, appUrl: `${config.appUrl}/knowledge-base?src=${dest.source}` };
}

export async function listKbProjects(config) {
  return (await kbFetch(config, 'projects')).projects;
}
