export * from './diagnostics';
export * from './pipeline';
export * from './verifier';

import { runM0Vertical, type M0VerticalResult, type RunM0VerticalInput } from './pipeline';

export class M0Pipeline {
  run(input: RunM0VerticalInput): Promise<M0VerticalResult> {
    return runM0Vertical(input);
  }
}
