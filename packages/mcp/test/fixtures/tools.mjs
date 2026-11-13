import { z } from 'zod';

/** The tools every fixture server offers, so stdio and HTTP are tested against the same set. */
export function registerFixtureTools(server) {
  server.registerTool(
    'echo',
    { description: 'Return the text.', inputSchema: { text: z.string() } },
    async ({ text }) => ({ content: [{ type: 'text', text }] }),
  );

  server.registerTool('fail', { description: 'Always reports an error.' }, async () => ({
    isError: true,
    content: [{ type: 'text', text: 'something went wrong' }],
  }));

  server.registerTool('big', { description: 'Returns a very long text.' }, async () => ({
    content: [{ type: 'text', text: 'x'.repeat(50_000) }],
  }));

  server.registerTool('picture', { description: 'Returns an image.' }, async () => ({
    content: [
      { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      { type: 'text', text: 'caption' },
    ],
  }));

  server.registerTool('slow', { description: 'Takes a long time.' }, async () => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    return { content: [{ type: 'text', text: 'late' }] };
  });

  server.registerTool(
    'env',
    { description: 'Report which variables the process can see.' },
    async () => ({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            secret: process.env.ORBIT_TEST_SECRET ?? null,
            configured: process.env.FIXTURE_FLAG ?? null,
          }),
        },
      ],
    }),
  );
}
