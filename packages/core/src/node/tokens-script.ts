// The in-page half of the token harvest: plain JavaScript, kept as a string like MEASURE_SCRIPT. It lists every CSS
// custom property the page's stylesheets declare (CSSOM: :root, provider and theme selectors, media, layers, nesting,
// adopted sheets), takes for each the declaration that applies at the story (the nearest element that declares it,
// then specificity and order), and resolves its value there: colors as rgb(), lengths in px. Channels ("212 100% 47%")
// that every use wraps in one color function (hsl(var(--primary))) are that color.

export const TOKENS_SCRIPT = String.raw`(function (arg) {
  arg = arg || {};
  var rootSel = arg.root || '#storybook-root, #root';
  var host = document.querySelector(rootSel) || document.body;
  var at = host.firstElementChild || host;
  var decls = {};
  var order = 0;
  // Every var() use: the color function around it (rgb, hsl...), or a bare use; and the properties that alias it.
  var COLOR_FN = /^(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)$/i;
  var useFn = {}, useBare = {}, aliasUses = {};
  function enclosing(s, pos) {
    for (var i = pos - 1, depth = 0; i >= 0; i--) {
      if (s[i] === ')') depth++;
      else if (s[i] === '(') {
        if (depth) { depth--; continue; }
        var j = i;
        while (j > 0 && /[\w-]/.test(s[j - 1])) j--;
        var fn = s.slice(j, i).toLowerCase();
        // A fallback (var(--a, var(--b))): the function around the outer var.
        if (fn !== 'var') return fn;
      }
    }
    return '';
  }
  function scanDecl(d) {
    var c = d.indexOf(':');
    if (c < 0) return;
    var prop = d.slice(0, c).trim(), val = d.slice(c + 1).replace(/!important\s*$/, '').trim();
    var alias = /^var\(\s*(--[\w-]+)\s*\)$/.exec(val);
    if (alias && prop.indexOf('--') === 0) { (aliasUses[alias[1]] = aliasUses[alias[1]] || []).push(prop); return; }
    var re = /var\(\s*(--[\w-]+)/g, m;
    while ((m = re.exec(val))) {
      var fn = enclosing(val, m.index);
      if (COLOR_FN.test(fn)) (useFn[m[1]] = useFn[m[1]] || {})[fn === 'rgba' || fn === 'hsla' ? fn.slice(0, 3) : fn] = 1;
      else useBare[m[1]] = 1;
    }
  }
  function scanUses(text) {
    for (var i = 0, depth = 0, start = 0; i <= text.length; i++) {
      var ch = text[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (i === text.length || (ch === ';' && depth <= 0)) { scanDecl(text.slice(start, i)); start = i + 1; depth = 0; }
    }
  }
  // The one color function every use of a property wraps it in, through the properties that alias it: '' unused, null
  // when a use is bare or two functions disagree.
  function channelFn(name, seen) {
    if (seen[name]) return '';
    seen[name] = 1;
    if (useBare[name]) return null;
    var fns = {};
    for (var f in useFn[name] || {}) fns[f] = 1;
    var al = aliasUses[name] || [];
    for (var i = 0; i < al.length; i++) {
      var g = channelFn(al[i], seen);
      if (g === null) return null;
      if (g) fns[g] = 1;
    }
    var k = Object.keys(fns);
    return k.length === 1 ? k[0] : k.length ? null : '';
  }
  function add(sel, style) {
    try { scanUses(style.cssText || ''); } catch (e) {}
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
  // Inline styles in the story use variables too.
  var inline = host.querySelectorAll('[style]');
  for (var q = 0; q < inline.length; q++) try { scanUses(inline[q].style.cssText || ''); } catch (e) {}

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
    var fn = r.type === 'string' && resolved ? channelFn(name, {}) : '';
    if (fn) {
      probe.style.color = '';
      probe.style.color = fn + '(' + resolved + ')';
      if (probe.style.color) r = { type: 'color', value: getComputedStyle(probe).color };
    }
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
