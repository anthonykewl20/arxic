import { createServer, type IncomingHttpHeaders, type ServerResponse } from 'node:http';
import type { OpenAICompletion } from '..';

export const BEARER_TOKEN = 'CANARY-SECRET-xyz';
export const EXPECTED_SCHEMA_VERSION = 'arxic-stage4-inference-v1';
export const STRUCTURED_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['schemaVersion', 'candidates'],
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string' },
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'intent'],
        additionalProperties: false,
        properties: {
          id: { type: 'string' },
          intent: { type: 'string' },
        },
      },
    },
  },
};

export type CapturedRequest = {
  headers: IncomingHttpHeaders;
  body: unknown;
};

export function completion(
  content: string,
  overrides: Partial<OpenAICompletion> = {},
): OpenAICompletion {
  return {
    id: 'chatcmpl-stage4-001',
    model: 'test-model-v1',
    choices: [
      {
        message: { role: 'assistant', content },
      },
    ],
    usage: { prompt_tokens: 21, completion_tokens: 13, total_tokens: 34 },
    ...overrides,
  };
}

type StubResponse = {
  status?: number;
  completion?: OpenAICompletion;
  body?: unknown;
  hang?: true;
};

export async function startStub(
  handler: (request: CapturedRequest, attempt: number) => StubResponse | Promise<StubResponse>,
): Promise<{
  baseUrl: string;
  requests: CapturedRequest[];
  close: () => Promise<void>;
}> {
  const requests: CapturedRequest[] = [];
  const activeResponses = new Set<ServerResponse>();
  const server = createServer(async (request, response) => {
    activeResponses.add(response);
    response.once('close', () => activeResponses.delete(response));
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString('utf8');
    const captured = {
      headers: request.headers,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    };
    requests.push(captured);
    const result = await handler(captured, requests.length);
    if (result.hang) return;
    response.statusCode = result.status ?? 200;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(result.completion ?? result.body ?? {}));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not allocate a port');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    requests,
    close: () =>
      new Promise<void>((resolveClose) => {
        for (const response of activeResponses) response.destroy();
        server.closeAllConnections();
        server.close(() => resolveClose());
      }),
  };
}

export function adapterRequest() {
  return {
    model: 'test-model-v1',
    messages: [
      { role: 'system' as const, content: 'Return bounded candidate data.' },
      { role: 'user' as const, content: 'Infer stage four candidates.' },
    ],
    schema: STRUCTURED_OUTPUT_SCHEMA,
    schemaVersion: EXPECTED_SCHEMA_VERSION,
  };
}

export function validOutput(intent = 'Open the login form') {
  return {
    schemaVersion: EXPECTED_SCHEMA_VERSION,
    candidates: [{ id: 'auth.login', intent }],
  };
}
