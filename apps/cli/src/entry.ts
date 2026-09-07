import { runCli } from './cli';
void runCli(process.argv.slice(2)).then((result) => {
  process.exitCode = result.exitCode;
});
