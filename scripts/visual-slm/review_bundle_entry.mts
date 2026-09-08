// Standalone review entry for the production-packaged runtime probe (refs
// #423): imports only the review path (evidence → features → native → report)
// so it can be bundled without the tsx dev harness. argv: ROOT CASE MODEL
// NATIVE — same contract as `cli.ts review`.
import { reviewCase } from '../../apps/web/src/compact-visual/model';

const [root, casePath, modelPath, binary] = process.argv.slice(2);
if (!root || !casePath || !modelPath || !binary)
  throw new Error('usage: review ROOT CASE MODEL NATIVE');
console.log(JSON.stringify(await reviewCase(root, casePath, modelPath, binary)));
