// Minimal DOMPurify stand-in so Mermaid's *parser* can run in Node for build-time syntax checks.
// Never used in the browser (the page inlines the real mermaid.min.js, which bundles DOMPurify).
const DOMPurify = {
  isSupported: true,
  sanitize: (s) => String(s),
  addHook() {},
  removeHook() {},
  removeHooks() {},
  removeAllHooks() {},
  setConfig() {},
  clearConfig() {},
};
export default DOMPurify;
