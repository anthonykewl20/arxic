export * from './diagnostics';
export * from './pipeline';
export * from './verifier';

import {
  runM0Vertical,
  type M0PipelineServices,
  type M0VerticalResult,
  type RunM0VerticalInput,
} from './pipeline';

export class M0Pipeline {
  constructor(private readonly services: Partial<M0PipelineServices> = {}) {}

  run(input: RunM0VerticalInput): Promise<M0VerticalResult> {
    return runM0Vertical(input, this.services);
  }
}
