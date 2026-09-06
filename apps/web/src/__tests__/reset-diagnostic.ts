import { createServer, request } from 'node:http';

export type ResetEvent = {
  path: '/forgot-password' | '/__arxic/seed' | '/__arxic/reset';
  submission?: number;
  status?: number;
  error?: boolean;
  accepted?: boolean;
  total?: number;
  clientClosedBeforeForward?: boolean;
};

/** Real-app relay: delay replay one; retain only numeric/enum side-effect facts. */
export async function resetDiagnostic(inbox: string, delayMs = 800) {
  let upstream = 'http://127.0.0.1:1';
  let submissions = 0;
  const events: ResetEvent[] = [];
  const pending: Promise<void>[] = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', upstream);
    const path = url.pathname;
    const relevant =
      req.method === 'POST' &&
      (path === '/forgot-password' || path === '/__arxic/seed' || path === '/__arxic/reset');
    const submission = relevant && path === '/forgot-password' ? ++submissions : undefined;
    const forward = () => {
      const call = request(url, { method: req.method, headers: req.headers }, (response) => {
        if (relevant) {
          const redirect = String(
            response.headers.location ?? response.headers['x-action-redirect'] ?? '',
          );
          const event: ResetEvent = {
            path,
            ...(submission ? { submission } : {}),
            status: response.statusCode,
            error: redirect.includes('error='),
            accepted: redirect.includes('message='),
            total: -1,
          };
          events.push(event);
          pending.push(
            fetch(inbox + '/api/v1/messages')
              .then((r) => {
                if (!r.ok) throw new Error('Diagnostic inbox unavailable');
                return r.json();
              })
              .then((d) => {
                if (!Number.isSafeInteger(d.total) || d.total < 0)
                  throw new Error('Invalid inbox count');
                event.total = d.total;
              }),
          );
        }
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      });
      call.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(call);
    };
    if (submission === 2 && delayMs > 0) {
      pending.push(
        new Promise<void>((done) =>
          setTimeout(() => {
            if (res.destroyed)
              events.push({
                path: '/forgot-password',
                submission,
                clientClosedBeforeForward: true,
              });
            else forward();
            done();
          }, delayMs),
        ),
      );
    } else forward();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No diagnostic port');
  const snapshot = async () => {
    for (let observed = 0; observed < pending.length;) {
      const batch = pending.slice(observed);
      observed = pending.length;
      await Promise.all(batch);
    }
    return events.map((event) => ({ ...event }));
  };
  return {
    setUpstream(value: string) {
      upstream = value;
    },
    origin: `http://127.0.0.1:${address.port}`,
    snapshot,
    async close() {
      try {
        await snapshot();
      } finally {
        server.closeAllConnections();
        await new Promise<void>((done) => server.close(() => done()));
      }
    },
  };
}
