import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { createOpenClawTransport } from '../openclaw-transport';

it('routes the selected backend model separately from the dedicated gateway agent', async () => {
  let seen: { url?: string; model?: string; backend?: string; tools?: string; token?: string } = {};
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen = {
      url: request.url,
      model: body.model,
      backend: request.headers['x-openclaw-model'] as string,
      tools: body.tool_choice,
      token: request.headers.authorization,
    };
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        id: 'probe',
        model: body.model,
        choices: [{ message: { role: 'assistant', content: '{"result":"ok"}' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
  }).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  try {
    const address = server.address() as { port: number };
    const result = await createOpenClawTransport('visual-auditor')({
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      bearerToken: 'gateway-key',
      model: 'provider/discovered-model',
      messages: [{ role: 'user', content: 'Inspect supplied pixels' }],
      schema: { type: 'object' },
      schemaName: 'review',
    });
    expect(result.ok).toBe(true);
    expect(seen).toEqual({
      url: '/v1/chat/completions',
      model: 'openclaw/visual-auditor',
      backend: 'provider/discovered-model',
      tools: 'none',
      token: 'Bearer gateway-key',
    });
    expect(() => createOpenClawTransport('bad\r\nagent')).toThrow('Invalid OpenClaw agent ID');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
