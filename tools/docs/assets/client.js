/* SMTG documentation client: hash routing, lazy Mermaid rendering, index filter, copy buttons,
 * diagram overlay, chart tooltips and the review-mode "Suggest a change" workflow.
 * Plain ES2019, no dependencies (Mermaid is inlined separately as window.mermaid). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- pure helpers (testable)
  /** "#/class/OracleCard/x" -> "class/OracleCard/x"; non-route hashes -> null; "" -> "" */
  function parseHash(hash) {
    var h = String(hash || '');
    if (h.charAt(0) === '#') h = h.slice(1);
    if (h === '' || h === '/') return '';
    if (h.charAt(0) !== '/') return null;
    try {
      h = decodeURIComponent(h);
    } catch (e) {
      /* keep raw */
    }
    return h.slice(1).replace(/\/+$/, '');
  }
  /** Longest existing route prefix wins; the remainder is an in-page anchor. */
  function resolveRoute(path, has) {
    if (!path) return { route: 'overview', anchor: null };
    var parts = path.split('/');
    for (var i = parts.length; i >= 1; i--) {
      var r = parts.slice(0, i).join('/');
      if (has(r)) return { route: r, anchor: parts.slice(i).join('/') || null };
    }
    return { route: '404', anchor: null, missing: path };
  }
  function normAnchor(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function suggestionMarkdown(s) {
    var lines = [
      '## Suggestion (' + s.kind + ') — ' + s.termLabel,
      '',
      '- **Term:** ' + s.termLabel + ' — <' + s.termIri + '>',
      '- **Kind:** ' + s.kind,
      '- **Author:** ' + (s.author || 'anonymous'),
      '- **Date:** ' + (s.date || new Date().toISOString().slice(0, 10)),
      '',
      s.text || '',
      '',
    ];
    return lines.join('\n');
  }
  function issueUrl(repo, s, fields) {
    if (!repo) return null;
    var title = '[' + s.kind + '] ' + s.termLabel + (s.text ? ': ' + s.text.replace(/\s+/g, ' ').slice(0, 60) : '');
    var body = suggestionMarkdown(s);
    if (body.length > 5000) body = body.slice(0, 5000) + '\n…(truncated)';
    var q = 'template=concept-change.yml&title=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
    var f = fields || [];
    var extra = { term: s.termIri, term_iri: s.termIri, iri: s.termIri, label: s.termLabel, term_label: s.termLabel, kind: s.kind, change_kind: s.kind, author: s.author, proposal: s.text, description: s.text, details: s.text };
    for (var i = 0; i < f.length; i++) {
      if (Object.prototype.hasOwnProperty.call(extra, f[i]) && extra[f[i]]) q += '&' + encodeURIComponent(f[i]) + '=' + encodeURIComponent(String(extra[f[i]]).slice(0, 1500));
    }
    return String(repo).replace(/\/+$/, '') + '/issues/new?' + q;
  }

  var api = { parseHash: parseHash, resolveRoute: resolveRoute, normAnchor: normAnchor, suggestionMarkdown: suggestionMarkdown, issueUrl: issueUrl };
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    if (typeof module !== 'undefined') module.exports = api;
    return;
  }
  window.__smtg = api;

  // ---------------------------------------------------------------- setup
  var DATA = {};
  try {
    DATA = JSON.parse(document.getElementById('smtg-data').textContent);
  } catch (e) {
    DATA = {};
  }
  function $(s, el) {
    return (el || document).querySelector(s);
  }
  function $$(s, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(s));
  }
  var main = document.getElementById('main');
  var sections = {};
  $$('main > section.route').forEach(function (s) {
    sections[s.getAttribute('data-route')] = s;
  });
  var has = function (r) {
    return Object.prototype.hasOwnProperty.call(sections, r);
  };
  var baseTitle = document.title;
  var current = null;
  var review = false;

  // ---------------------------------------------------------------- mermaid
  var M = window.mermaid;
  var P = DATA.palette || {};
  var mermaidOk = false;
  if (M && typeof M.initialize === 'function') {
    try {
      M.initialize({
        startOnLoad: false,
        securityLevel: 'loose',
        theme: 'base',
        htmlLabels: true,
        fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
        maxTextSize: 500000,
        maxEdges: 2000,
        themeVariables: {
          background: P.surface || '#faf6ee',
          mainBkg: P.surface || '#faf6ee',
          primaryColor: P.surface || '#faf6ee',
          primaryTextColor: P.ink || '#27221c',
          primaryBorderColor: P.muted || '#6e6559',
          nodeBorder: P.muted || '#6e6559',
          lineColor: P.muted || '#6e6559',
          secondaryColor: P.concept || '#efe6d3',
          tertiaryColor: P.bg || '#f3ecdd',
          clusterBkg: '#f6f0e4',
          clusterBorder: '#cfc5b3',
          edgeLabelBackground: P.surface || '#faf6ee',
          textColor: P.ink || '#27221c',
          titleColor: P.ink || '#27221c',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          fontSize: '13px',
        },
        flowchart: { htmlLabels: true, curve: 'basis', padding: 10, nodeSpacing: 36, rankSpacing: 56, useMaxWidth: false, diagramPadding: 12, wrappingWidth: 320 },
      });
      mermaidOk = true;
    } catch (e) {
      mermaidOk = false;
    }
  }
  var fontsReady = null;
  var renderSeq = 0;
  var queue = Promise.resolve();
  function waitFonts() {
    if (!fontsReady) {
      var fonts = document.fonts;
      fontsReady = fonts && fonts.load
        ? Promise.race([
            Promise.all([fonts.load('700 14px "SMTG Display"'), fonts.ready]).catch(function () {}),
            new Promise(function (r) {
              setTimeout(r, 2500);
            }),
          ])
        : Promise.resolve();
    }
    return fontsReady;
  }
  function failDiagram(fig, msg) {
    fig.setAttribute('data-done', 'error');
    var canvas = $('.diagram-canvas', fig);
    canvas.classList.add('failed');
    var loading = $('.diagram-loading', canvas);
    if (loading) loading.textContent = 'Diagram could not be rendered here (' + msg + '). Its Mermaid source:';
  }
  function renderOne(fig) {
    if (fig.getAttribute('data-done')) return Promise.resolve();
    fig.setAttribute('data-done', 'pending');
    var canvas = $('.diagram-canvas', fig);
    var srcEl = $('.mmd-src', canvas);
    var src = srcEl ? srcEl.textContent : '';
    if (!mermaidOk) {
      failDiagram(fig, 'Mermaid unavailable');
      return Promise.resolve();
    }
    var id = 'mmd-' + ++renderSeq;
    return M.render(id, src)
      .then(function (res) {
        fig.setAttribute('data-src', src);
        canvas.innerHTML = res.svg;
        if (res.bindFunctions) res.bindFunctions(canvas);
        var svg = $('svg', canvas);
        if (svg) {
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', (($('.diagram-title', fig) || {}).textContent || 'diagram'));
        }
        fig.setAttribute('data-done', '1');
        fitDiagram(fig);
      })
      .catch(function (e) {
        var stray = document.getElementById('d' + id);
        if (stray) stray.remove();
        failDiagram(fig, (e && e.message ? e.message : String(e)).split('\n')[0].slice(0, 160));
      });
  }
  // Fit a rendered diagram to the column width. Never enlarge; never shrink below FIT_MIN
  // (labels would become illegible) — wider diagrams scroll sideways and say so.
  var FIT_MIN = 0.65;
  function fitDiagram(fig) {
    var canvas = $('.diagram-canvas', fig);
    var svg = canvas && $('svg', canvas);
    if (!svg || fig.getAttribute('data-done') !== '1' || !canvas.clientWidth) return;
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var w = (vb && vb.width) || parseFloat(svg.getAttribute('width')) || 0;
    if (!w) return;
    var cs = getComputedStyle(canvas);
    var avail = canvas.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    if (avail <= 0) return;
    var scale = Math.min(1, avail / w);
    var forced = fig.getAttribute('data-fit-all') === '1';
    var fits = scale >= FIT_MIN || forced;
    svg.style.maxWidth = 'none';
    svg.style.width = Math.round(w * (fits ? scale : FIT_MIN)) + 'px';
    svg.style.height = 'auto';
    fig.classList.toggle('is-overflowing', !fits);
    var bar = $('.diagram-actions', fig);
    if (!bar) return;
    var note = $('.fit-note', bar);
    if (!note) {
      note = document.createElement('span');
      note.className = 'fit-note';
      bar.insertBefore(note, bar.firstChild);
    }
    var toggle = $('[data-fit-toggle]', bar);
    if (scale < FIT_MIN) {
      if (!toggle) {
        toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn-sm';
        toggle.setAttribute('data-fit-toggle', '');
        bar.insertBefore(toggle, note.nextSibling);
      }
      toggle.hidden = false;
      toggle.textContent = forced ? 'Readable size' : 'Fit all';
      note.textContent = forced ? 'whole diagram · ' + Math.round(scale * 100) + '%' : 'wider than the page — scroll sideways, Fit all or Enlarge';
    } else {
      if (toggle) toggle.hidden = true;
      note.textContent = scale < 0.999 ? 'fitted to width · ' + Math.round(scale * 100) + '%' : '';
    }
  }
  function fitSection(section) {
    $$('figure.diagram[data-done="1"]', section).forEach(fitDiagram);
  }
  var fitTimer = null;
  window.addEventListener('resize', function () {
    clearTimeout(fitTimer);
    fitTimer = setTimeout(function () {
      $$('main > section.route:not([hidden])').forEach(fitSection);
    }, 120);
  });
  function renderDiagrams(section) {
    fitSection(section); // diagrams rendered earlier, possibly at another window width
    var figs = $$('figure.diagram:not([data-done])', section);
    if (!figs.length) return Promise.resolve();
    queue = queue.then(waitFonts).then(function () {
      return figs.reduce(function (p, fig) {
        return p.then(function () {
          return renderOne(fig);
        });
      }, Promise.resolve());
    });
    return queue;
  }

  // ---------------------------------------------------------------- routing
  function findAnchor(section, anchor) {
    if (!anchor) return null;
    var esc = window.CSS && CSS.escape ? CSS.escape : function (s) {
      return String(s).replace(/["\\]/g, '\\$&');
    };
    var el = section.querySelector('[data-anchor="' + esc(anchor) + '"]') || section.querySelector('[data-anchor-id~="' + esc(anchor) + '"]');
    if (el) return el;
    var want = normAnchor(anchor);
    var all = $$('[data-anchor], [data-anchor-id]', section);
    for (var i = 0; i < all.length; i++) {
      var a = all[i].getAttribute('data-anchor');
      var ids = (all[i].getAttribute('data-anchor-id') || '').split(/\s+/);
      if (normAnchor(a) === want) return all[i];
      for (var j = 0; j < ids.length; j++) if (ids[j] && normAnchor(ids[j]) === want) return all[i];
    }
    for (var k = 0; k < all.length; k++) {
      var a2 = normAnchor(all[k].getAttribute('data-anchor'));
      if (a2 && want && a2.indexOf(want) === 0) return all[k];
    }
    return null;
  }
  function flash(el) {
    var cls = el.tagName === 'TR' ? 'hl' : 'flash';
    el.classList.add(cls);
    setTimeout(function () {
      el.classList.remove(cls);
    }, 2200);
  }
  function scrollToAnchor(section, anchor, smooth) {
    var el = findAnchor(section, anchor);
    if (el) {
      el.scrollIntoView({ block: el.tagName === 'TR' ? 'center' : 'start', behavior: smooth ? 'smooth' : 'auto' });
      flash(el);
      return true;
    }
    return false;
  }
  function setActiveNav(route) {
    $$('#sidebar a.active').forEach(function (a) {
      a.classList.remove('active');
      a.removeAttribute('aria-current');
    });
    var top = route.split('/').slice(0, 2).join('/');
    var link = $('#sidebar a[data-nav="' + route.replace(/"/g, '\\"') + '"]') || $('#sidebar a[data-nav="' + top.replace(/"/g, '\\"') + '"]');
    if (!link) return;
    link.classList.add('active');
    link.setAttribute('aria-current', 'page');
    var det = link.closest('details');
    if (det && !det.open) det.open = true;
    var scroller = $('#sidebar .nav-scroll');
    if (scroller) {
      var lr = link.getBoundingClientRect();
      var sr = scroller.getBoundingClientRect();
      if (lr.top < sr.top || lr.bottom > sr.bottom) link.scrollIntoView({ block: 'center' });
    }
  }
  function show(path, opts) {
    opts = opts || {};
    var r = resolveRoute(path, has);
    var section = sections[r.route];
    if (!section) return;
    var changed = current !== r.route;
    if (changed) {
      closeOverlay();
      if (current && sections[current]) sections[current].hidden = true;
      section.hidden = false;
      current = r.route;
      var t = section.getAttribute('data-title');
      document.title = t && r.route !== 'overview' ? t + ' · ' + baseTitle : baseTitle;
      setActiveNav(r.route);
      document.body.classList.remove('nav-open');
      var mb = $('.menu-btn');
      if (mb) mb.setAttribute('aria-expanded', 'false');
      if (r.route === '404') {
        var miss = $('[data-missing-route]', section);
        if (miss) miss.textContent = '#/' + (r.missing || path);
      }
      onSectionShown(section, r.route);
    }
    if (!(r.anchor && scrollToAnchor(section, r.anchor, !changed))) {
      if (changed && !opts.keepScroll) {
        window.scrollTo(0, 0);
        try {
          main.focus({ preventScroll: true });
        } catch (e) {
          /* old browsers */
        }
      }
    }
    var anchor = r.anchor;
    renderDiagrams(section).then(function () {
      // diagrams change heights: settle the anchor again
      if (anchor && current === r.route) {
        var el = findAnchor(section, anchor);
        if (el) el.scrollIntoView({ block: el.tagName === 'TR' ? 'center' : 'start' });
      }
    });
  }
  function onHash() {
    var path = parseHash(location.hash);
    if (path === null) {
      // plain in-page anchor such as "#main": only scroll if it exists in the current page
      var id = location.hash.slice(1);
      var el = id && document.getElementById(id);
      if (el && el !== main) el.scrollIntoView();
      return;
    }
    show(path);
  }
  window.addEventListener('hashchange', onHash);

  // ---------------------------------------------------------------- sidebar filter & drawer
  var filter = document.getElementById('nav-filter');
  var groups = $$('#sidebar details.nav-group');
  groups.forEach(function (g) {
    g.setAttribute('data-open0', g.open ? '1' : '');
  });
  function applyFilter() {
    var q = (filter.value || '').toLowerCase().trim();
    var terms = q ? q.split(/\s+/) : [];
    var lis = $$('#sidebar .nav-scroll li');
    lis.forEach(function (li) {
      var a = $('a[data-k]', li);
      if (!a) return;
      var k = a.getAttribute('data-k') + ' ' + a.textContent.toLowerCase();
      var ok = terms.every(function (t) {
        return k.indexOf(t) >= 0;
      });
      li.hidden = !ok;
    });
    // sub-headings: hide when none of the following links (until the next heading) are visible
    $$('#sidebar li.nav-sub').forEach(function (h) {
      var vis = false;
      var n = h.nextElementSibling;
      while (n && !n.classList.contains('nav-sub')) {
        if (!n.hidden) vis = true;
        n = n.nextElementSibling;
      }
      h.hidden = terms.length > 0 && !vis;
    });
    groups.forEach(function (g) {
      if (!terms.length) {
        g.hidden = false;
        g.open = !!g.getAttribute('data-open0') || !!$('a.active', g);
        return;
      }
      var any = $$('li', g).some(function (li) {
        return !li.hidden && !li.classList.contains('nav-sub');
      });
      g.hidden = !any;
      if (any) g.open = true;
    });
    $$('#sidebar ul.nav-top').forEach(function (ul) {
      ul.hidden = terms.length > 0 && !$$('li', ul).some(function (li) {
        return !li.hidden;
      });
    });
    // sections (Introduction, Ontology, …): hide when none of their lists or groups shows anything
    $$('#sidebar section.nav-sec').forEach(function (sec) {
      sec.hidden = terms.length > 0 && !$$('ul.nav-top, details.nav-group', sec).some(function (el) {
        return !el.hidden;
      });
    });
  }
  if (filter) {
    filter.addEventListener('input', applyFilter);
    filter.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        filter.value = '';
        applyFilter();
      } else if (e.key === 'Enter') {
        var first = $$('#sidebar .nav-scroll li:not([hidden]) a[data-nav]').filter(function (a) {
          return !a.closest('[hidden]');
        })[0];
        if (first) {
          e.preventDefault();
          location.hash = first.getAttribute('href');
        }
      }
    });
  }
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      var tag = (document.activeElement && document.activeElement.tagName) || '';
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (document.activeElement && document.activeElement.isContentEditable)) return;
      if (filter) {
        e.preventDefault();
        if (window.matchMedia('(max-width: 800px)').matches) openDrawer(true);
        filter.focus();
        filter.select();
      }
    } else if (e.key === 'Escape') {
      if (!$('#overlay').hidden) closeOverlay();
      else if (document.body.classList.contains('nav-open')) openDrawer(false);
    }
  });
  var menuBtn = $('.menu-btn');
  function openDrawer(on) {
    document.body.classList.toggle('nav-open', on);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', on ? 'true' : 'false');
  }
  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      openDrawer(!document.body.classList.contains('nav-open'));
    });
  }
  var skip = $('[data-skip]');
  if (skip) {
    skip.addEventListener('click', function (e) {
      e.preventDefault();
      main.focus();
    });
  }

  // ---------------------------------------------------------------- copy helpers
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () {
        return legacyCopy(text);
      });
    }
    return legacyCopy(text);
  }
  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (e) {
        ok = false;
      }
      ta.remove();
      if (ok) resolve();
      else reject(new Error('copy failed'));
    });
  }
  function feedback(btn, ok, label) {
    var old = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', old);
    btn.textContent = ok ? label || 'Copied' : 'Copy failed';
    if (ok) btn.classList.add('copied');
    setTimeout(function () {
      btn.textContent = old;
      btn.classList.remove('copied');
    }, 1400);
  }

  // ---------------------------------------------------------------- overlay (enlarge)
  var overlay = $('#overlay');
  var ovState = null;
  function openOverlay(fig) {
    var svg = $('.diagram-canvas svg', fig);
    if (!svg) return;
    var body = $('.overlay-body', overlay);
    var ph = document.createComment('svg-placeholder');
    svg.parentNode.insertBefore(ph, svg);
    body.appendChild(svg);
    var vb = svg.viewBox && svg.viewBox.baseVal;
    var w = (vb && vb.width) || svg.getBoundingClientRect().width || 800;
    ovState = { svg: svg, ph: ph, w: w, scale: 1, opener: document.activeElement, styleW: svg.style.width, styleMax: svg.style.maxWidth };
    $('#overlay-title').textContent = (($('.diagram-title', fig) || {}).textContent || 'Diagram');
    overlay.hidden = false;
    document.body.classList.add('overlay-open');
    zoom(0);
    var close = $('[data-close]', overlay);
    if (close) close.focus();
  }
  function zoom(dir) {
    if (!ovState) return;
    var body = $('.overlay-body', overlay);
    if (dir === 0) {
      var avail = Math.max(200, body.clientWidth - 48);
      ovState.scale = Math.min(2.5, Math.max(0.2, avail / ovState.w));
    } else ovState.scale = Math.min(4, Math.max(0.15, ovState.scale * (dir > 0 ? 1.25 : 0.8)));
    ovState.svg.style.maxWidth = 'none';
    ovState.svg.style.width = Math.round(ovState.w * ovState.scale) + 'px';
  }
  function closeOverlay() {
    if (!ovState) return;
    var s = ovState;
    ovState = null;
    s.svg.style.width = s.styleW;
    s.svg.style.maxWidth = s.styleMax;
    s.ph.parentNode.insertBefore(s.svg, s.ph);
    s.ph.remove();
    overlay.hidden = true;
    document.body.classList.remove('overlay-open');
    if (s.opener && s.opener.focus) s.opener.focus();
  }

  // ---------------------------------------------------------------- delegated clicks
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!(t instanceof Element)) return;
    var b;
    if ((b = t.closest('[data-copy]'))) {
      copyText(b.getAttribute('data-copy')).then(
        function () {
          feedback(b, true, b.classList.contains('btn-icon') ? '✓' : 'Copied');
        },
        function () {
          feedback(b, false);
        },
      );
    } else if ((b = t.closest('[data-copy-iri]'))) {
      var code = b.closest('td') && $('code[title]', b.closest('td'));
      if (code) copyText(code.getAttribute('title')).then(function () { feedback(b, true, '✓'); }, function () { feedback(b, false); });
    } else if ((b = t.closest('[data-copy-code]'))) {
      var pre = b.closest('.code') && $('pre', b.closest('.code'));
      if (pre) copyText(pre.textContent).then(function () { feedback(b, true); }, function () { feedback(b, false); });
    } else if ((b = t.closest('[data-copy-src]'))) {
      var fig = b.closest('figure.diagram');
      var src = fig.getAttribute('data-src') || (($('.mmd-src', fig) || {}).textContent || '');
      copyText(src).then(function () { feedback(b, true); }, function () { feedback(b, false); });
    } else if ((b = t.closest('[data-fit-toggle]'))) {
      var f3 = b.closest('figure.diagram');
      f3.setAttribute('data-fit-all', f3.getAttribute('data-fit-all') === '1' ? '' : '1');
      fitDiagram(f3);
    } else if ((b = t.closest('[data-enlarge]'))) {
      var f2 = b.closest('figure.diagram');
      if (f2.getAttribute('data-done') === '1') openOverlay(f2);
      else renderOne(f2).then(function () { openOverlay(f2); });
    } else if ((b = t.closest('[data-close]'))) {
      closeOverlay();
    } else if ((b = t.closest('[data-zoom]'))) {
      zoom(Number(b.getAttribute('data-zoom')));
    } else if ((b = t.closest('[data-copy-md]'))) {
      var panel = b.closest('[data-suggest]');
      var s = readSuggestion(panel);
      copyText(suggestionMarkdown(s)).then(function () { feedback(b, true, 'Copied as Markdown'); }, function () { feedback(b, false); });
    } else if ((b = t.closest('[data-issue-link]'))) {
      var p2 = b.closest('[data-suggest]');
      var url = issueUrl(DATA.repoUrl, readSuggestion(p2), DATA.issueFields);
      if (url) b.setAttribute('href', url);
    } else if ((b = t.closest('#sidebar a[data-nav]'))) {
      // same-route click: re-show to scroll to top
      if (b.getAttribute('href') === location.hash) show(parseHash(location.hash));
    }
  });

  // ---------------------------------------------------------------- tooltips (charts)
  var tip = $('#tip');
  function showTip(el, x, y) {
    tip.textContent = el.getAttribute('data-tip');
    tip.hidden = false;
    var r = tip.getBoundingClientRect();
    var left = Math.min(window.innerWidth - r.width - 8, Math.max(8, x + 12));
    var top = y - r.height - 10 < 8 ? y + 16 : y - r.height - 10;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }
  document.addEventListener('pointermove', function (e) {
    var el = e.target instanceof Element && e.target.closest('[data-tip]');
    if (el) showTip(el, e.clientX, e.clientY);
    else if (!tip.hidden) tip.hidden = true;
  });
  document.addEventListener('focusin', function (e) {
    var el = e.target instanceof Element && e.target.closest('[data-tip]');
    if (el) {
      var r = el.getBoundingClientRect();
      showTip(el, r.left + Math.min(r.width, 200) / 2, r.top);
    }
  });
  document.addEventListener('focusout', function () {
    tip.hidden = true;
  });

  // ---------------------------------------------------------------- table filters
  document.addEventListener('input', function (e) {
    var inp = e.target;
    if (!(inp instanceof Element) || !inp.hasAttribute('data-filter-table')) return;
    var id = inp.getAttribute('data-filter-table');
    var table = document.getElementById(id);
    if (!table) return;
    var terms = inp.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
    var rows = $$('tbody > tr', table);
    var shown = 0;
    rows.forEach(function (tr) {
      var txt = tr.textContent.toLowerCase();
      var ok = terms.every(function (t) {
        return txt.indexOf(t) >= 0;
      });
      tr.hidden = !ok;
      if (ok) shown++;
    });
    var c = document.querySelector('[data-filter-count="' + id + '"]');
    if (c) c.textContent = terms.length ? shown + ' of ' + rows.length : '';
  });

  // ---------------------------------------------------------------- suggestions
  function readSuggestion(panel) {
    var form = $('form', panel);
    return {
      termIri: panel.getAttribute('data-term-iri'),
      termLabel: panel.getAttribute('data-term-label'),
      kind: form.elements.kind.value,
      author: form.elements.author.value.trim(),
      text: form.elements.text.value.trim(),
      date: new Date().toISOString().slice(0, 10),
    };
  }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function renderSuggestionList(container, items, withTerm) {
    container.textContent = '';
    if (!items.length) {
      container.appendChild(el('p', 'muted small', withTerm ? 'No suggestions yet.' : 'No suggestions for this term yet.'));
      return;
    }
    container.appendChild(el('h3', 'lbl-h', items.length + ' suggestion' + (items.length === 1 ? '' : 's')));
    items.forEach(function (s) {
      var card = el('div', 'suggestion');
      var head = el('div', 'suggestion-head');
      head.appendChild(el('span', 'chip', s.kind || 'note'));
      if (withTerm) {
        var route = termRoutes[s.termIri];
        if (route) {
          var a = el('a', null, s.termLabel || s.termIri);
          a.href = '#/' + route;
          head.appendChild(a);
        } else head.appendChild(el('span', null, s.termLabel || s.termIri));
      }
      head.appendChild(el('span', null, (s.author || 'anonymous') + ' · ' + String(s.createdAt || '').replace('T', ' ').slice(0, 16)));
      card.appendChild(head);
      card.appendChild(el('div', 'suggestion-body', s.text || ''));
      container.appendChild(card);
    });
  }
  var termRoutes = {};
  $$('[data-suggest]').forEach(function (p) {
    var sec = p.closest('section.route');
    if (sec) termRoutes[p.getAttribute('data-term-iri')] = sec.getAttribute('data-route');
  });
  function loadSuggestions(panel) {
    var list = $('[data-suggest-list]', panel);
    if (!review || !list) return;
    fetch('/api/suggestions?term=' + encodeURIComponent(panel.getAttribute('data-term-iri')), { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : { items: [] };
      })
      .then(function (j) {
        list.hidden = false;
        renderSuggestionList(list, j.items || [], false);
        var count = $('[data-suggest-count]', panel);
        var n = (j.items || []).length;
        if (count) {
          count.hidden = !n;
          count.textContent = n ? n + ' existing' : '';
        }
      })
      .catch(function () {});
  }
  document.addEventListener('submit', function (e) {
    var form = e.target;
    var panel = form.closest && form.closest('[data-suggest]');
    if (!panel) return;
    e.preventDefault();
    var status = $('.form-status', panel);
    var s = readSuggestion(panel);
    if (!s.text) {
      status.textContent = 'Please write your suggestion first.';
      status.className = 'form-status err';
      form.elements.text.focus();
      return;
    }
    if (!review) {
      copyText(suggestionMarkdown(s)).then(function () {
        status.textContent = 'Copied as Markdown (static mode: nothing was sent).';
        status.className = 'form-status ok';
      });
      return;
    }
    status.textContent = 'Saving…';
    status.className = 'form-status';
    fetch('/api/suggestions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s) })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) throw new Error(j && j.error ? j.error : 'HTTP ' + r.status);
          return j;
        });
      })
      .then(function (j) {
        status.textContent = 'Saved as ' + j.file + '. Thank you!';
        status.className = 'form-status ok';
        form.elements.text.value = '';
        loadSuggestions(panel);
      })
      .catch(function (err) {
        status.textContent = 'Could not save: ' + err.message;
        status.className = 'form-status err';
      });
  });
  function enableReview() {
    review = true;
    document.body.classList.add('review');
    $$('[data-review-only]').forEach(function (n) {
      n.hidden = false;
    });
    $$('[data-static-only]').forEach(function (n) {
      n.hidden = true;
    });
    $$('[data-suggest-mode]').forEach(function (n) {
      n.textContent = 'Review mode: your suggestion is saved as a Markdown file in review/suggestions/ on the presenter’s machine.';
    });
    if (current && sections[current]) onSectionShown(sections[current], current);
  }
  function onSectionShown(section, route) {
    var panel = $('[data-suggest]', section);
    if (panel) {
      if (DATA.repoUrl) $$('[data-issue-link]', panel).forEach(function (a) { a.hidden = false; });
      loadSuggestions(panel);
    }
    if (route === 'suggestions' && review) {
      var box = $('[data-all-suggestions]', section);
      fetch('/api/suggestions', { cache: 'no-store' })
        .then(function (r) {
          return r.json();
        })
        .then(function (j) {
          renderSuggestionList(box, j.items || [], true);
        })
        .catch(function () {});
    }
  }
  function detectReview() {
    if (location.protocol !== 'http:' && location.protocol !== 'https:') return;
    fetch('/api/ping', { cache: 'no-store' })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        if (j && j.ok === true && j.app === 'smtg-review') enableReview();
      })
      .catch(function () {});
  }

  // ---------------------------------------------------------------- card previews ([[Card Name]] links)
  // Images come from Scryfall's image servers at view time; offline, the preview simply stays hidden.
  var cardTip = null;
  function cardPreview() {
    if (cardTip) return cardTip;
    cardTip = document.createElement('div');
    cardTip.className = 'card-preview';
    cardTip.setAttribute('aria-hidden', 'true');
    cardTip.hidden = true;
    document.body.appendChild(cardTip);
    return cardTip;
  }
  function showCard(a) {
    var srcs = [a.getAttribute('data-card-img'), a.getAttribute('data-card-img2')].filter(Boolean);
    if (!srcs.length) return;
    var tip = cardPreview();
    tip.innerHTML = '';
    var pending = srcs.length;
    srcs.forEach(function (src) {
      var img = new Image();
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () {
        img.remove();
        if (!tip.querySelector('img')) tip.hidden = true;
      };
      img.onload = function () {
        if (--pending <= 0) placeCard(a);
      };
      img.src = src;
      tip.appendChild(img);
    });
    tip.hidden = false;
    placeCard(a);
  }
  function placeCard(a) {
    if (!cardTip || cardTip.hidden) return;
    var r = a.getBoundingClientRect();
    var w = cardTip.offsetWidth || 260;
    var h = cardTip.offsetHeight || 350;
    var left = Math.min(window.innerWidth - w - 12, Math.max(12, r.left));
    var top = r.bottom + 8 + h > window.innerHeight ? Math.max(12, r.top - h - 8) : r.bottom + 8;
    cardTip.style.left = left + 'px';
    cardTip.style.top = top + 'px';
  }
  function hideCard() {
    if (cardTip) cardTip.hidden = true;
  }
  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest && e.target.closest('a.cardref[data-card-img]');
    if (a) showCard(a);
  });
  document.addEventListener('mouseout', function (e) {
    var a = e.target.closest && e.target.closest('a.cardref[data-card-img]');
    if (a && !(e.relatedTarget && a.contains(e.relatedTarget))) hideCard();
  });
  document.addEventListener('focusin', function (e) {
    var a = e.target.closest && e.target.closest('a.cardref[data-card-img]');
    if (a) showCard(a);
  });
  document.addEventListener('focusout', hideCard);
  window.addEventListener('scroll', hideCard, { passive: true });

  // ---------------------------------------------------------------- self-test hook (used by tooling)
  api.show = function (route) {
    show(route);
    return current;
  };
  api.renderAll = function () {
    var ids = Object.keys(sections);
    var out = { routes: ids.length, diagrams: 0, failed: [], errors: [] };
    return ids
      .reduce(function (p, r) {
        return p.then(function () {
          show(r, { keepScroll: true });
          return renderDiagrams(sections[r]).then(function () {
            $$('figure.diagram', sections[r]).forEach(function (f) {
              out.diagrams++;
              if (f.getAttribute('data-done') !== '1') out.failed.push(r + ': ' + ((($('.diagram-loading', f) || {}).textContent) || 'not rendered'));
            });
          });
        });
      }, Promise.resolve())
      .then(function () {
        return out;
      });
  };
  window.addEventListener('error', function (e) {
    (api.errors = api.errors || []).push(String(e.message || e));
  });

  // ---------------------------------------------------------------- start
  var initial = parseHash(location.hash);
  show(initial === null ? '' : initial);
  detectReview();
})();
