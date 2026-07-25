// Learn more https://docs.expo.io/guides/customizing-metro
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

/**
 * expo-sqlite on web is wa-sqlite compiled to WebAssembly, loaded in a worker.
 * Metro does not treat .wasm as an asset by default, and the worker needs
 * SharedArrayBuffer, which browsers only hand out to cross-origin-isolated
 * documents. Both facts are web-only build concerns; nothing in src/ changes.
 */
config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  return middleware(req, res, next);
};

module.exports = config;
