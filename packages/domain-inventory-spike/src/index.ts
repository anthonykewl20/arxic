export const PACKAGE_NAME = '@arxic/domain-inventory' as const;

export * from './types';
export * from './diagnostics';
export {
  INTERCHANGE_SCHEMA_VERSION,
  validateInterchange,
  type InterchangeGap,
  type InterchangeGapKind,
  type InterchangeRoute,
  type HttpMethod,
  type InterchangeValidation,
  type RouteInventoryInterchange,
} from './interchange';
export { enumeratePhpRoutes, type PhpEnumerateOptions } from './standin-php';
export {
  buildInventory,
  buildSourceInventory,
  fuseRuntimeInventory,
  codepointCompare,
} from './fuse';
export { clusterInventory, domainOf, verbsOf } from './cluster';
export { validateInventory, type InventoryValidation } from './validate';
export { serializeInventory, stabilize } from './serialize';
export { normalizePath, matchRuntimePath } from './normalize-path';
export {
  resolveProviderIncludes,
  type ProviderIncludeContext,
  type ProviderIncludeResolution,
  type UnresolvedProviderInclude,
} from './provider-includes';
export {
  buildConsumerEvidenceIndex,
  consumerRowId,
  sourceEvidenceId,
  toProposalConsumerInventory,
  type ProposalConsumerInventory,
  type ProposalConsumerRow,
} from './consumer-adapter';
