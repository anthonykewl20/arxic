export const PACKAGE_NAME = '@arxic/playwright-trace-sanitizer' as const;

export * from './trace-sanitizer';
export * from './trace-carrier-classifier';
export * from './artifact-discovery';
export { BoundedFileLimitError, DEFAULT_TRACE_ARCHIVE_LIMITS, readBoundedFile } from './zip';
