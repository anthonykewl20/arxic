import { canonicalJson } from '@arxic/contracts';
import type { SurfaceMap } from './types';

export function codepointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export { canonicalJson } from '@arxic/contracts';

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
