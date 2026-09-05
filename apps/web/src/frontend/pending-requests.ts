import { useSyncExternalStore } from 'react';

const requests = new Map<string, symbol>();
export const campaignRequestKey = (projectId: string, discoveryId: string) =>
  `campaign:${projectId}:${discoveryId}`;
const listeners = new Set<() => void>();
const publish = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Track a submission across presentation unmounts, with an atomic duplicate guard. */
export function beginPendingRequest(key: string): (() => void) | undefined {
  if (requests.has(key)) return undefined;
  const token = Symbol(key);
  requests.set(key, token);
  publish();
  return () => {
    // A late response from an old session must not release a new session's request.
    if (requests.get(key) !== token) return;
    requests.delete(key);
    publish();
  };
}
export function usePendingRequest(key: string) {
  return useSyncExternalStore(subscribe, () => requests.has(key));
}
export function clearPendingRequests() {
  requests.clear();
  publish();
}
