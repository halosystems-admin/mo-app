import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function safeRequire(moduleName) {
  try {
    return require(moduleName);
  } catch {
    return null;
  }
}

export function tryReplaceCachedModuleExport(moduleName, wrappedExport) {
  try {
    const modulePath = require.resolve(moduleName);
    if (!require.cache[modulePath]) {
      return;
    }
    require.cache[modulePath].exports = wrappedExport;
  } catch {
    // Module not in cache yet; skip.
  }
}

export function safeResolve(moduleName) {
  try {
    return require.resolve(moduleName);
  } catch {
    return null;
  }
}
