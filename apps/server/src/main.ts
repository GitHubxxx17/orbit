import { InMemoryEventStore } from '@orbit/core';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';

const port = Number(process.env['ORBIT_PORT'] ?? 8787);
const app = createApp(new InMemoryEventStore());

// Bind to loopback only: this is a local-first tool, not a network service.
serve({ fetch: app.fetch, port, hostname: '127.0.0.1' }, (info) => {
  console.log(`orbit server listening on http://127.0.0.1:${info.port}`);
});
