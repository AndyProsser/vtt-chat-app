import { beforeEach, vi } from 'vitest';

// Ensure localStorage is available for tests
if (typeof global.localStorage === 'undefined') {
  const mockStorage: Record<string, string> = {};

  global.localStorage = {
    getItem: (key: string) => mockStorage[key] ?? null,
    setItem: (key: string, value: string) => {
      mockStorage[key] = value;
    },
    removeItem: (key: string) => {
      delete mockStorage[key];
    },
    clear: () => {
      Object.keys(mockStorage).forEach((key) => {
        delete mockStorage[key];
      });
    },
    key: (index: number) => Object.keys(mockStorage)[index] ?? null,
    length: Object.keys(mockStorage).length,
  } as Storage;
}

beforeEach(() => {
  localStorage.clear();
});
