import { resolve } from 'node:path';
import { createQueue } from './queue.mjs';
const server = createQueue({ token: process.env.QUEUE_TOKEN, storePath: resolve(process.env.QUEUE_STORE || '.data/jobs.json') });
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || '127.0.0.1';
server.requestTimeout = 15_000;
server.listen(port, host, () => console.log(`Capture queue listening on ${host}:${port}`));
