import "@testing-library/jest-dom/vitest"

// Radix dialogs (and recharts) read ResizeObserver; jsdom has none.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof (globalThis as any).ResizeObserver === "undefined") {
  ;(globalThis as any).ResizeObserver = ResizeObserverStub
}
