import readline from 'node:readline';

const required = {
  planner_setup_page: ['project', 'seedFile'],
  planner_submit_plan: ['overview', 'suites'],
  planner_save_plan: ['overview', 'suites', 'name', 'fileName'],
  generator_setup_page: ['plan', 'project', 'seedFile'],
  generator_read_log: [],
  generator_write_test: ['fileName', 'code'],
  test_list: [],
  test_run: ['locations', 'projects'],
  test_debug: ['test'],
};
const config = process.argv[process.argv.indexOf('--config') + 1] ?? '';
if (config.includes('missing')) delete required.test_run;
if (config.includes('drift')) required.test_run = ['changed'];
const tools = Object.entries(required).map(([name, keys]) => ({
  name,
  inputSchema: { type: 'object', properties: Object.fromEntries(keys.map((key) => [key, {}])) },
}));
const lines = readline.createInterface({ input: process.stdin });
lines.on('line', (line) => {
  const request = JSON.parse(line);
  if (!('id' in request)) return;
  let result = {};
  if (request.method === 'initialize') {
    result = {
      protocolVersion: '2025-03-26',
      capabilities: { tools: {} },
      serverInfo: { name: 'Playwright Test Runner', version: '1.62.1' },
    };
  }
  if (request.method === 'tools/list') result = { tools };
  if (request.method === 'tools/call')
    result = { content: [{ type: 'text', text: 'stub output' }] };
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
});
