import '@testing-library/jest-dom';

// Mock Tauri API for browser environment
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    value: undefined,
    writable: true,
  });
}
