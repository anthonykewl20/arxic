export const PACKAGE_NAME = '@arxic/playwright-compiler' as const;

// NOTE: `./test-support/redirect-login-app` is deliberately NOT re-exported
// here. It is a test-support real app (node:sqlite) consumed only by tests via
// deep imports; re-exporting it would drag node:sqlite into every production
// dependency graph of this package (the CLI tsup bundle broke on exactly that
// in CI — run 31963186731).
export * from './compile-policy';
export * from './compiler';
export * from './diagnostics';
export * from './fixture-generator';
export * from './form-flow';
export * from './observation-assertions';
export * from './observation-capture';
export * from './origin-policy';
export * from './plan-generator';
export * from './sensitivity-probe';
export * from './spec-generator';
export * from './transition-receipt-runtime';
