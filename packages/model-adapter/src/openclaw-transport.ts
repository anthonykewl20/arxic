import { postStructuredCompletion, type StructuredCompletionTransport } from './client';

/** OpenClaw routes the body model to an agent and the header to its backend model. */
export function createOpenClawTransport(agentId: string): StructuredCompletionTransport {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/u.test(agentId))
    throw new Error('Invalid OpenClaw agent ID');
  return (input) =>
    postStructuredCompletion(input, {
      model: `openclaw/${agentId}`,
      headers: { 'x-openclaw-model': input.model },
      toolChoice: 'none',
    });
}
