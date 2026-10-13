import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createQueue } from '../server/queue.mjs';
const token = 'test-token-that-is-at-least-32-characters';
async function setup(t, clock) {
  const dir = await mkdtemp(join(tmpdir(), 'capture-queue-'));
  const server = createQueue({ token, storePath: join(dir, 'jobs.json'), now: clock });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { await new Promise(r => server.close(r)); await rm(dir, { recursive: true }); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const request = (path, body, extra = {}) => fetch(url + path, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { request, url, dir };
}
test('authentication, exclusive claims, completion and persisted history', async t => {
  const { request, url, dir } = await setup(t);
  assert.equal((await fetch(url + '/health')).status, 401);
  assert.equal((await request('/jobs', { url: 'https://claude.ai/chat/1', format: 'exe' })).status, 400);
  assert.equal((await request('/jobs', {}, { Origin: 'https://evil.com' })).status, 403);
  const job = await (await request('/jobs', { url: 'https://claude.ai/chat/1', format: 'pdf' })).json();
  assert.equal((await request(`/jobs/${job.id}/complete`, { state: 'completed' })).status, 409);
  const responses = await Promise.all([request('/jobs/claim', {}), request('/jobs/claim', {})]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 204]);
  assert.equal((await request(`/jobs/${job.id}/complete`, { state: 'completed', filename: 'x.pdf' })).status, 200);
  await request(`/jobs/${job.id}/complete`, { state: 'failed' });
  assert.equal((await (await request(`/jobs/${job.id}`)).json()).state, 'completed');
  const restarted = createQueue({ token, storePath: join(dir, 'jobs.json') });
  await new Promise(r => restarted.listen(0, '127.0.0.1', r));
  const restored = await fetch(`http://127.0.0.1:${restarted.address().port}/jobs/${job.id}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await restored.json()).filename, 'x.pdf');
  await new Promise(r => restarted.close(r));
});
test('expired jobs fail without automatic duplicate uploads', async t => {
  let clock = 1000;
  const { request } = await setup(t, () => clock);
  const job = await (await request('/jobs', { url: 'https://chatgpt.com/c/1' })).json();
  await request('/jobs/claim', {}); clock += 301_000;
  assert.equal((await request('/jobs/claim', {})).status, 204);
  assert.equal((await (await request(`/jobs/${job.id}`)).json()).state, 'failed');
});
