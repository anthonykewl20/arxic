import type { SurfaceMap } from './types';

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => codepointCompare(left, right))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

export function serializeSurfaceMap(map: SurfaceMap): string {
  return canonicalJson({
    ...map,
    routes: [...map.routes].sort((left, right) => codepointCompare(left.url, right.url)),
    navigationEdges: [...map.navigationEdges].sort((left, right) =>
      codepointCompare(
        `${left.from}\0${left.to}\0${left.status}\0${left.reason ?? ''}\0${left.depth}`,
        `${right.from}\0${right.to}\0${right.status}\0${right.reason ?? ''}\0${right.depth}`,
      ),
    ),
    diagnostics: [...map.diagnostics].sort((left, right) =>
      codepointCompare(`${left.code}\0${left.subject}`, `${right.code}\0${right.subject}`),
    ),
  });
}
