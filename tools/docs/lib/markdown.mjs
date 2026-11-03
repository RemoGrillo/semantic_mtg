// Markdown → HTML with marked: stable heading anchors, ID auto-links (RQ-*, AP-*, ADR-*, CQ-*),
// relative link rewriting into hash routes, Mermaid blocks and highlighted code.
import fs from 'node:fs';
import path from 'node:path';
import { Marked } from 'marked';
import { esc, attr, highlight } from './html.mjs';
import { cardRefHtml, cardRowHtml } from './cardrefs.mjs';

export const ID_RE = /(?<![\w-])(RQ-[A-Z][A-Z0-9]*-\d+[a-z]?|AP-\d{1,3}|ADR-\d{3,4}|CQ-[A-Z][A-Z0-9]*-\d+[a-z]?)(?![\w-])/;
const ID_RE_G = new RegExp(ID_RE.source, 'g');

/** GitHub-compatible heading slug (so links written for GitHub keep working). */
export function ghSlug(text) {
  return String(text)
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

export function idsIn(text) {
  return [...new Set(String(text).match(ID_RE_G) || [])];
}

export function splitFrontMatter(src) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { meta: {}, body: src };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (kv) meta[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, '').trim();
  }
  return { meta, body: src.slice(m[0].length) };
}

function plain(tokens) {
  return (tokens || [])
    .map((t) => (t.tokens ? plain(t.tokens) : t.type === 'smtgref' ? t.id : t.type === 'cardref' ? t.inner.replace(/^!/, '').split('|')[0] : t.text ?? t.raw ?? ''))
    .join('');
}

/**
 * @param {string} src markdown
 * @param {object} ctx
 *   route        hash route of the page, e.g. "page/review-questions"
 *   file         repo-relative path of the source (for relative links)
 *   rootDir      absolute repo root used to inline images
 *   resolveFile  (repoRelPath) => href | null   (maps .md/.ttl paths to routes or downloads)
 *   idHref       (id) => { href, missing }
 *   backlinks    (id) => html
 *   diagram      (mermaidSource, opts) => html
 *   symbols      Symbols instance (optional) for {W} codes in text
 *   repoUrl      optional GitHub URL for unknown relative links
 */
export function renderMarkdown(src, ctx) {
  const { meta, body } = splitFrontMatter(String(src ?? ''));
  const headings = [];
  const usedAnchors = new Set();
  let inHeading = false;
  const baseDir = path.posix.dirname(ctx.file || 'x.md');

  const md = new Marked({ gfm: true, breaks: false });
  md.use({
    extensions: [
      {
        // [[Card Name]], [[Card Name|SET|CN|lang]], [[!…]] — see tools/docs/lib/cardrefs.mjs
        name: 'cardref',
        level: 'inline',
        start(s) {
          const i = s.indexOf('[[');
          return i < 0 ? undefined : i;
        },
        tokenizer(s) {
          // consecutive image references form one row of cards
          const run = /^\[\[![^[\]\n]+?\]\](?:\s*\[\[![^[\]\n]+?\]\])*/.exec(s);
          if (run) return { type: 'cardref', raw: run[0], inners: [...run[0].matchAll(/\[\[(![^[\]\n]+?)\]\]/g)].map((m) => m[1]) };
          const m = /^\[\[(!?[^[\]\n]+?)\]\]/.exec(s);
          if (m) return { type: 'cardref', raw: m[0], inner: m[1] };
          return undefined;
        },
        renderer(tok) {
          if (tok.inners) return inHeading ? tok.inners.map((i) => esc(i.slice(1).split('|')[0])).join(', ') : cardRowHtml(tok.inners);
          return inHeading ? esc(tok.inner.replace(/^!/, '').split('|')[0]) : cardRefHtml(tok.inner);
        },
      },
      {
        name: 'smtgref',
        level: 'inline',
        start(s) {
          const m = ID_RE.exec(s);
          return m ? m.index : undefined;
        },
        tokenizer(s) {
          if (this.lexer.state.inLink) return undefined;
          const m = new RegExp('^' + ID_RE.source.replace('(?<![\\w-])', '')).exec(s);
          if (m) return { type: 'smtgref', raw: m[0], id: m[1] };
          return undefined;
        },
        renderer(tok) {
          if (inHeading) return `<span class="ref-id">${esc(tok.id)}</span>`;
          const r = ctx.idHref ? ctx.idHref(tok.id) : null;
          if (!r) return esc(tok.id);
          return `<a class="ref-id${r.missing ? ' missing' : ''}" href="${attr(r.href)}"${
            r.missing ? ` title="${attr(r.missing)}"` : ''
          }>${esc(tok.id)}</a>`;
        },
      },
    ],
    renderer: {
      heading(tok) {
        const text = plain(tok.tokens);
        let anchor = ghSlug(text) || 'section';
        let n = 1;
        while (usedAnchors.has(anchor)) anchor = `${ghSlug(text)}-${n++}`;
        usedAnchors.add(anchor);
        const ids = idsIn(text);
        headings.push({ depth: tok.depth, text, anchor, ids });
        inHeading = true;
        const inner = this.parser.parseInline(tok.tokens);
        inHeading = false;
        const idAttr = ids.length ? ` data-anchor-id="${attr(ids.join(' '))}"` : '';
        const bl = ids.length && ctx.backlinks ? ids.map((id) => ctx.backlinks(id)).join('') : '';
        const self = `<a class="h-anchor" href="#/${attr(ctx.route)}/${attr(ids[0] || anchor)}" aria-label="Link to this section">#</a>`;
        return `<h${tok.depth} id="${attr(ctx.route.replace(/\//g, '--'))}--${attr(anchor)}" data-anchor="${attr(anchor)}"${idAttr}>${inner}${self}</h${tok.depth}>\n${bl}`;
      },
      code(tok) {
        const lang = (tok.lang || '').trim().split(/\s+/)[0].toLowerCase();
        if (lang === 'mermaid' && ctx.diagram) return ctx.diagram(tok.text, { caption: '', source: ctx.file });
        return `<div class="code"><div class="code-bar"><span class="code-lang">${esc(lang)}</span><span class="code-actions"><button type="button" class="btn-sm" data-copy-code>Copy</button></span></div><pre><code class="lang-${esc(
          lang,
        )}">${highlight(lang, tok.text)}</code></pre></div>\n`;
      },
      link(tok) {
        const inner = this.parser.parseInline(tok.tokens);
        const href = rewriteHref(tok.href, ctx, baseDir);
        const ext = /^https?:/i.test(href);
        const title = tok.title ? ` title="${attr(tok.title)}"` : '';
        return `<a href="${attr(href)}"${title}${ext ? ' rel="noopener" target="_blank" class="ext"' : ''}>${inner}</a>`;
      },
      image(tok) {
        let src = tok.href;
        if (!/^(https?:|data:)/i.test(src) && ctx.rootDir) {
          const rel = path.posix.normalize(path.posix.join(baseDir, src.split('#')[0]));
          const abs = path.join(ctx.rootDir, rel);
          try {
            const st = fs.statSync(abs);
            const ext = path.extname(abs).slice(1).toLowerCase();
            const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', webp: 'image/webp' }[ext];
            if (mime && st.size < 2_000_000) src = `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`;
          } catch {
            /* keep original */
          }
        }
        return `<img src="${attr(src)}" alt="${attr(tok.text || '')}"${tok.title ? ` title="${attr(tok.title)}"` : ''} loading="lazy">`;
      },
      text(tok) {
        if (tok.tokens) return this.parser.parseInline(tok.tokens);
        return ctx.symbols && !tok.escaped ? ctx.symbols.inline(decode(tok.text)) : tok.escaped ? tok.text : esc(tok.text);
      },
    },
  });

  let html = md.parse(body);
  html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
  const h1 = headings.find((h) => h.depth === 1);
  return { html, headings, meta, title: meta.title || h1?.text || null };
}

function decode(s) {
  return String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[e]);
}

function rewriteHref(href, ctx, baseDir) {
  if (!href) return '#';
  if (/^(https?:|mailto:|data:)/i.test(href)) return href;
  if (href.startsWith('#/')) return href;
  if (href.startsWith('#')) return `#/${ctx.route}/${href.slice(1)}`;
  const [p, frag] = href.split('#');
  const rel = path.posix.normalize(path.posix.join(baseDir, decodeURIComponent(p))).replace(/^(\.\/)+/, '');
  const mapped = ctx.resolveFile ? ctx.resolveFile(rel) : null;
  if (mapped) return frag && mapped.startsWith('#/') ? `${mapped}/${frag}` : mapped;
  if (ctx.repoUrl) return `${ctx.repoUrl.replace(/\/$/, '')}/blob/main/${rel}${frag ? '#' + frag : ''}`;
  return href;
}
