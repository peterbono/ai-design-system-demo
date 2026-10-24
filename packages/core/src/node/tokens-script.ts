// The in-page half of the token harvest: plain JavaScript, kept as a string like MEASURE_SCRIPT. It lists every CSS
// custom property the page's stylesheets declare (CSSOM: :root, provider and theme selectors, media, layers, nesting,
// adopted sheets), takes for each the declaration that applies at the story (the nearest element that declares it,
// then specificity and order), and resolves its value there: colors as rgb(), lengths in px.

export const TOKENS_SCRIPT = String.raw`(function (arg) {
  arg = arg || {};
  var rootSel = arg.root || '#storybook-root, #root';
  var host = document.querySelector(rootSel) || document.body;
  var at = host.firstElementChild || host;
  var decls = {};
  var order = 0;
  function add(sel, style) {
    for (var k = 0; k < style.length; k++) {
      var n = style[k];
      if (n.indexOf('--') !== 0 || n.indexOf('--_') === 0 || n.indexOf('--sb-') === 0) continue;
      (decls[n] = decls[n] || []).push({ sel: sel, raw: style.getPropertyValue(n).trim(), order: order++ });
    }
  }
  function walk(list) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      try {
        if (r.selectorText !== undefined && r.style) {
          add(r.selectorText, r.style);
          if (r.cssRules && r.cssRules.length) walk(r.cssRules);
        } else if (r.media !== undefined && r.cssRules) {
          if (window.matchMedia(r.media.mediaText || 'all').matches) walk(r.cssRules);
        } else if (r.cssRules) walk(r.cssRules);
      } catch (e) {}
    }
  }
  var blocked = 0;
  for (var s = 0; s < document.styleSheets.length; s++) {
    try { walk(document.styleSheets[s].cssRules); } catch (e) { blocked++; }
  }
  try { for (var a = 0; a < (document.adoptedStyleSheets || []).length; a++) walk(document.adoptedStyleSheets[a].cssRules); } catch (e) {}
  // Inline styles on the story's ancestors (a provider that sets variables in style="").
  for (var up = at; up && up.nodeType === 1; up = up.parentElement) if (up.style && up.style.length) add('[style]', up.style);

  function specificity(sel) {
    var x = sel.replace(/:where\([^)]*\)/g, '');
    var ids = (x.match(/#[\w-]+/g) || []).length;
    var cls = (x.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\b|is\b|has\b|root\b)[\w-]+(\([^)]*\))?/g) || []).length + (x.match(/:root/g) || []).length;
    var types = (x.replace(/\[[^\]]*\]|\([^)]*\)/g, '').match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
    return ids * 10000 + cls * 100 + types;
  }
  function matchSpec(el, selText) {
    var best = -1, parts = selText.split(/,(?![^(]*\))/);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim();
      if (!p || /::/.test(p)) continue;
      try { if (el.matches(p)) best = Math.max(best, specificity(p)); } catch (e) {}
    }
    return best;
  }
  // The declaration that applies at the story: the nearest element up from it with a matching rule, then specificity
  // and order; inline style wins at its element.
  function winning(name) {
    var list = decls[name];
    for (var el = at; el && el.nodeType === 1; el = el.parentElement) {
      var best = null, bestRank = null;
      if (el.style && el.style.getPropertyValue(name)) return { sel: '[style]', raw: el.style.getPropertyValue(name).trim() };
      for (var i = 0; i < list.length; i++) {
        if (list[i].sel === '[style]') continue;
        var sp = matchSpec(el, list[i].sel);
        if (sp < 0) continue;
        if (!best || sp > bestRank[0] || (sp === bestRank[0] && list[i].order > bestRank[1])) { best = list[i]; bestRank = [sp, list[i].order]; }
      }
      if (best) return best;
    }
    return null;
  }

  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
  (at.parentElement || document.body).appendChild(probe);
  function norm(v) {
    if (!v) return { type: 'string', value: '' };
    probe.style.color = '';
    probe.style.color = v;
    if (probe.style.color) return { type: 'color', value: getComputedStyle(probe).color };
    if (/^-?[\d.]+$/.test(v)) return { type: 'number', value: Number(v) };
    probe.style.width = '';
    probe.style.width = v;
    if (probe.style.width && !/auto|%/.test(v)) {
      var w = getComputedStyle(probe).width;
      if (/px$/.test(w)) return { type: 'length', value: Math.round(parseFloat(w) * 100) / 100 };
    }
    return { type: 'string', value: v };
  }
  var cs = getComputedStyle(at), rootCs = getComputedStyle(document.documentElement);
  var out = [];
  var ROOTISH = /^(:root|html|:host|body|\*)(\s*,\s*(:root|html|:host|body|\*))*$/;
  for (var name in decls) {
    var w = winning(name);
    var resolved = cs.getPropertyValue(name).trim() || rootCs.getPropertyValue(name).trim();
    var r = norm(resolved);
    var scopes = [];
    for (var j = 0; j < decls[name].length && scopes.length < 6; j++) {
      var sel = decls[name][j].sel;
      if (!ROOTISH.test(sel.trim()) && scopes.indexOf(sel) < 0) scopes.push(sel.length > 120 ? sel.slice(0, 120) : sel);
    }
    out.push({ name: name, raw: w ? w.raw : decls[name][0].raw, applies: !!w, type: r.type, value: r.value, scopes: scopes });
  }
  probe.remove();
  return { properties: out, blocked: blocked };
})`;

/** The Storybook globals that switch a theme, a brand or a density, with their toolbar values and defaults. */
export const GLOBALS_SCRIPT = String.raw`(function () {
  var p = window.__STORYBOOK_PREVIEW__;
  if (!p) return null;
  var store = p.storyStoreValue || {};
  var ann = store.projectAnnotations || p.projectAnnotations || {};
  var types = ann.globalTypes || (store.globals && store.globals.globalTypes) || {};
  var current = (store.userGlobals && store.userGlobals.get && store.userGlobals.get()) || (store.globals && store.globals.get && store.globals.get()) || ann.initialGlobals || ann.globals || {};
  var out = [];
  for (var k in types) {
    var t = types[k] || {};
    var items = (t.toolbar && t.toolbar.items) || t.options || [];
    var values = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var v = typeof it === 'string' ? it : it && (it.value !== undefined ? it.value : it.title);
      if (typeof v === 'string' && v && values.indexOf(v) < 0) values.push(v);
    }
    if (values.length < 2 || values.length > 12) continue;
    var def = current[k] !== undefined ? String(current[k]) : (t.defaultValue !== undefined ? String(t.defaultValue) : values[0]);
    out.push({ global: k, values: values, default: def });
  }
  return out;
})()`;
