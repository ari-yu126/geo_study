import { AsyncLocalStorage } from 'node:async_hooks';

export type GeminiTraceStore = {
  normalizedUrl: string;
};

const geminiTraceStorage = new AsyncLocalStorage<GeminiTraceStore>();

export function runWithGeminiTrace<T>(store: GeminiTraceStore, fn: () => T): T {
  return geminiTraceStorage.run(store, fn);
}

export function getGeminiTraceContext(): GeminiTraceStore | undefined {
  return geminiTraceStorage.getStore();
}
