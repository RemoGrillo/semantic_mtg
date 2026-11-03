// Parse-check Mermaid sources in Node (no DOM). Returns a function (src) => Promise<null | errorMessage>.
// If Mermaid cannot be loaded in this environment, checking is skipped (returns null for everything).
import module from 'node:module';

let checker = null;

export async function mermaidChecker(warn = () => {}) {
  if (checker) return checker;
  try {
    const stub = new URL('./purify-stub.mjs', import.meta.url).href;
    if (typeof module.registerHooks === 'function') {
      module.registerHooks({
        resolve(spec, ctx, next) {
          if (spec === 'dompurify') return { url: stub, shortCircuit: true };
          return next(spec, ctx);
        },
      });
    } else {
      throw new Error('node:module.registerHooks unavailable (Node >= 22.15 needed)');
    }
    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({ startOnLoad: false, securityLevel: 'loose' });
    checker = async (src) => {
      try {
        await mermaid.parse(src);
        return null;
      } catch (e) {
        return String(e?.message || e).split('\n').slice(0, 4).join(' ');
      }
    };
  } catch (e) {
    warn(`Mermaid syntax check skipped: ${e.message}`, 'diagram');
    checker = async () => null;
  }
  return checker;
}
