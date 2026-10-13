import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { httpUrl } from '../src/shared.js';

export function createQueue({ token, storePath, now = Date.now }) {
  if (!token || token.length < 32) throw new Error('QUEUE_TOKEN must contain at least 32 characters.');
  let jobs = existsSync(storePath) ? JSON.parse(readFileSync(storePath, 'utf8')) : [];
  const save = () => {
    mkdirSync(dirname(storePath), { recursive: true, mode: 0o700 });
    writeFileSync(`${storePath}.tmp`, JSON.stringify(jobs, null, 2), { mode: 0o600 });
    renameSync(`${storePath}.tmp`, storePath);
  };
  const expire = () => {
    let changed = false;
    for (const job of jobs) if (job.state === 'running' && now() - job.claimedAt > 5 * 60_000) {
      job.state = 'failed'; job.error = 'Worker timed out. Check the KB before submitting again.'; changed = true;
    }
    if (changed) save();
  };
  return createServer(async (req, res) => {
    const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(body === undefined ? undefined : JSON.stringify(body)); };
    try {
      const supplied = Buffer.from(req.headers.authorization || '');
      const expected = Buffer.from(`Bearer ${token}`);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return reply(401, { error: 'Unauthorized' });
      if (req.headers.origin && !req.headers.origin.startsWith('chrome-extension://')) return reply(403, { error: 'Browser page requests are not accepted.' });
      expire();
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') return reply(200, { ok: true });
      if (req.method === 'GET' && /^\/jobs\/[a-zA-Z0-9-]+$/.test(path)) {
        const job = jobs.find(j => j.id === path.split('/')[2]);
        return reply(job ? 200 : 404, job || { error: 'Job not found' });
      }
      if (req.method !== 'POST') return reply(404, { error: 'Not found' });
      req.setEncoding('utf8');
      let raw = '';
      for await (const chunk of req) {
        raw += chunk.toString();
        if (Buffer.byteLength(raw) > 16_384) { reply(413, { error: 'Request too large' }); return; }
      }
      let body;
      try { body = JSON.parse(raw || '{}'); } catch { return reply(400, { error: 'Invalid JSON' }); }
      if (!body || Array.isArray(body) || typeof body !== 'object') return reply(400, { error: 'Expected a JSON object' });
      if (path === '/jobs') {
        let url;
        try { url = httpUrl(body.url); } catch { return reply(400, { error: 'A valid HTTP(S) conversation URL is required.' }); }
        const format = body.format || 'md';
        if (!['md', 'pdf'].includes(format)) return reply(400, { error: 'Format must be md or pdf' });
        if (jobs.filter(j => ['queued', 'running'].includes(j.state)).length >= 100) return reply(429, { error: 'Queue is full' });
        // Keep a bounded result history. Active jobs are never evicted.
        if (jobs.length >= 1000) jobs = jobs.filter(j => ['queued', 'running'].includes(j.state)).concat(jobs.filter(j => !['queued', 'running'].includes(j.state)).slice(-800));
        const job = { id: randomUUID(), url: url.href, format, state: 'queued', createdAt: now() };
        jobs.push(job); save(); return reply(201, job);
      }
      if (path === '/jobs/claim') {
        const job = jobs.find(j => j.state === 'queued');
        if (!job) return reply(204);
        job.state = 'running'; job.claimedAt = now(); save(); return reply(200, job);
      }
      const match = path.match(/^\/jobs\/([a-zA-Z0-9-]+)\/complete$/);
      if (match) {
        const job = jobs.find(j => j.id === match[1]);
        if (!job) return reply(404, { error: 'Job not found' });
        if (!['completed', 'failed'].includes(body.state)) return reply(400, { error: 'Invalid result state' });
        if (job.state === 'queued') return reply(409, { error: 'Job has not been claimed' });
        if (job.finishedAt) return reply(200, job); // Result delivery is idempotent.
        Object.assign(job, { state: body.state, finishedAt: now(), filename: typeof body.filename === 'string' ? body.filename.slice(0, 250) : undefined, error: typeof body.error === 'string' ? body.error.slice(0, 1000) : undefined });
        save(); return reply(200, job);
      }
      reply(404, { error: 'Not found' });
    } catch (error) { console.error('Queue request failed:', error.message); reply(500, { error: 'Queue storage or request failed' }); }
  });
}
