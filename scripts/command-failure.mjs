/** Bounded process observations, not a guess at product failure or timeout causality. */
export function commandFailureFacts(error) {
  const value = error && typeof error === 'object' ? error : {};
  return {
    code:
      Number.isSafeInteger(value.code) ||
      ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ETIMEDOUT', 'ABORT_ERR', 'ENOENT', 'EACCES'].includes(
        value.code,
      )
        ? value.code
        : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGINT', 'SIGSEGV'].includes(value.signal)
      ? value.signal
      : null,
    killed: value.killed === true,
  };
}
