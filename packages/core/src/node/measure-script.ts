// The in-page half of the Storybook measure: plain JavaScript, kept as a string so no bundler or test transform
// rewrites it before it reaches the browser. It runs in a story's iframe once the story has rendered and returns a
// MeasuredNode tree (see measure.ts) of what the browser actually drew: boxes, layout, paint, text, and the CSS custom
// properties each value was declared with.
//
// How a token is found for a value: every style rule of the page (CSS modules, Sass output, CSS-in-JS rules inserted
// with insertRule, Tailwind layers) is read once; for an element and a property the winning declaration (inline style,
// then !important, specificity and order) is taken, and the custom properties it uses are followed through their own
// declarations (`--button-bg: var(--color-action-primary-bg)`) to the end of the chain. A value no declaration ties to a
// variable is matched by value against the variables defined on the root (`matched`), which is weaker evidence.

export const MEASURE_SCRIPT = String.raw`(function (arg) {
  arg = arg || {};
  var MAX_NODES = arg.maxNodes || 400;
  var MAX_DEPTH = arg.maxDepth || 14;
  var rootSel = arg.root || '#storybook-root, #root';
  var PROPS = ['display', 'position', 'visibility', 'opacity', 'overflow', 'box-sizing',
    'flex-direction', 'flex-wrap', 'justify-content', 'align-items', 'align-self', 'flex-grow', 'row-gap', 'column-gap',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'width', 'height', 'min-width', 'min-height',
    'background-color', 'background-image',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'outline-style', 'outline-width', 'outline-color',
    'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-decoration-line', 'text-transform', 'text-align', 'white-space',
    'fill', 'stroke', 'stroke-width', 'transform', 'grid-auto-flow', 'grid-template-columns', 'grid-template-rows', 'left', 'top', 'right', 'bottom'];
  // Properties a token is looked for (paint, spacing, shape, type).
  var TOKENED = ['row-gap', 'column-gap', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'width', 'height', 'min-width', 'min-height',
    'background-color', 'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'box-shadow', 'opacity', 'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'fill', 'stroke', 'stroke-width'];
  // Longhand -> shorthands that may set it, with the position of the longhand in a 1 to 4 value box shorthand.
  var SIDES = { top: 0, right: 1, bottom: 2, left: 3 };
  var CORNERS = { 'top-left': 0, 'top-right': 1, 'bottom-right': 2, 'bottom-left': 3 };
  var LOGICAL = { top: 'block-start', bottom: 'block-end', left: 'inline-start', right: 'inline-end' };
  var LOGICAL_CORNER = { 'top-left': 'start-start', 'top-right': 'start-end', 'bottom-right': 'end-end', 'bottom-left': 'end-start' };
  function shorthandsOf(p) {
    var m;
    // Logical longhands too (padding-block-start: a horizontal writing mode, left to right).
    if ((m = /^padding-(top|right|bottom|left)$/.exec(p))) return [['padding-' + LOGICAL[m[1]], -1], ['padding', SIDES[m[1]]], ['padding-block', m[1] === 'top' ? 0 : m[1] === 'bottom' ? 1 : -1], ['padding-inline', m[1] === 'left' ? 0 : m[1] === 'right' ? 1 : -1]].filter(function (x) { return !/block$|inline$/.test(x[0]) || x[1] >= 0; });
    if ((m = /^margin-(top|right|bottom|left)$/.exec(p))) return [['margin-' + LOGICAL[m[1]], -1], ['margin', SIDES[m[1]]]];
    if ((m = /^border-(top-left|top-right|bottom-right|bottom-left)-radius$/.exec(p))) return [['border-' + LOGICAL_CORNER[m[1]] + '-radius', -1], ['border-radius', CORNERS[m[1]]]];
    if ((m = /^border-(top|right|bottom|left)-(width|color|style)$/.exec(p))) return [['border-' + LOGICAL[m[1]] + '-' + m[2], -1], ['border-' + LOGICAL[m[1]], -1], ['border-' + m[2], SIDES[m[1]]], ['border-' + m[1], -1], ['border', -1], ['border-' + (m[1] === 'top' || m[1] === 'bottom' ? 'block' : 'inline'), -1]];
    if (p === 'row-gap') return [['gap', 0]];
    if (p === 'column-gap') return [['gap', 1]];
    if (p === 'background-color') return [['background', -1]];
    if (/^font-/.test(p) || p === 'line-height') return [['font', -1]];
    return [];
  }

  // ---- style rules, read once ----
  var rules = [];
  var order = 0;
  function walk(list, layered) {
    for (var i = 0; i < list.length; i++) {
      var r = list[i];
      try {
        if (r.selectorText !== undefined && r.style) {
          rules.push({ sel: r.selectorText, style: r.style, order: order++, layered: layered });
          if (r.cssRules && r.cssRules.length) walk(r.cssRules, layered); // CSS nesting
        } else if (r.media !== undefined && r.cssRules) {
          if (window.matchMedia(r.media.mediaText || 'all').matches) walk(r.cssRules, layered);
        } else if (r.conditionText !== undefined && r.cssRules) {
          walk(r.cssRules, layered);
        } else if (r.cssRules && r.name !== undefined) {
          walk(r.cssRules, true); // @layer block: unlayered rules win over it
        } else if (r.cssRules) {
          walk(r.cssRules, layered);
        }
      } catch (e) {}
    }
  }
  var sheetsRead = 0, sheetsBlocked = 0;
  for (var s = 0; s < document.styleSheets.length; s++) {
    try { walk(document.styleSheets[s].cssRules, false); sheetsRead++; } catch (e) { sheetsBlocked++; }
  }
  try { for (var a = 0; a < (document.adoptedStyleSheets || []).length; a++) walk(document.adoptedStyleSheets[a].cssRules, false); } catch (e) {}

  function splitTop(text, sepRe) {
    var out = [], depth = 0, cur = '', q = null;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { cur += c; if (c === q) q = null; continue; }
      if (c === '"' || c === "'") { q = c; cur += c; continue; }
      if (c === '(' || c === '[') depth++;
      if (c === ')' || c === ']') depth--;
      if (depth === 0 && sepRe.test(c)) { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
      cur += c;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function specificity(sel) {
    var s = sel.replace(/:where\([^)]*\)/g, '').replace(/::?(before|after|placeholder|selection|marker|backdrop)\b/g, '');
    var ids = (s.match(/#[\w-]+/g) || []).length;
    var cls = (s.match(/\.[\w-]+|\[[^\]]*\]|:(?!not\b|is\b|has\b)[\w-]+(\([^)]*\))?/g) || []).length;
    var types = (s.replace(/\[[^\]]*\]|\([^)]*\)/g, '').match(/(^|[\s>+~(])[a-zA-Z][\w-]*/g) || []).length;
    return ids * 10000 + cls * 100 + types;
  }
  var PSEUDO_END = /::?(before|after)\s*$/;
  // pseudo: the rules for el::before / el::after (the selector minus its pseudo-element); none: the element's own.
  function matchSpec(el, selText, pseudo) {
    var best = -1;
    var parts = splitTop(selText, /,/);
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i];
      var pm = PSEUDO_END.exec(part);
      if (pseudo) {
        if (!pm || pm[1] !== pseudo) continue;
        part = part.slice(0, pm.index).trim() || '*';
      } else if (pm || /::/.test(part)) continue;
      try { if (el.matches(part)) best = Math.max(best, specificity(part) + (pseudo ? 1 : 0)); } catch (e) {}
    }
    return best;
  }
  var matchCache = { '': new Map(), before: new Map(), after: new Map() };
  function matching(el, pseudo) {
    var cache = matchCache[pseudo || ''];
    var m = cache.get(el);
    if (m) return m;
    m = [];
    for (var i = 0; i < rules.length; i++) {
      var sp = matchSpec(el, rules[i].sel, pseudo);
      if (sp >= 0) m.push({ r: rules[i], sp: sp });
    }
    cache.set(el, m);
    return m;
  }
  // The winning declared value of a property (longhand or the shorthand that sets it) on an element or its pseudo.
  function declared(el, prop, pseudo) {
    var best = null;
    function consider(value, important, layered, sp, ord, shorthand, pos) {
      if (!value) return;
      var rank = [important ? (layered ? 3 : 2) : (layered ? 0 : 1), sp, ord];
      if (!best || cmp(rank, best.rank) > 0) best = { value: value, rank: rank, shorthand: shorthand, pos: pos };
    }
    function cmp(x, y) { for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; }
    var short = prop.indexOf('--') === 0 ? [] : shorthandsOf(prop);
    var m = matching(el, pseudo);
    for (var i = 0; i < m.length; i++) {
      var st = m[i].r.style;
      var v = st.getPropertyValue(prop);
      if (v) consider(v, st.getPropertyPriority(prop) === 'important', m[i].r.layered, m[i].sp, m[i].r.order, null, -1);
      else for (var k = 0; k < short.length; k++) {
        var sv = st.getPropertyValue(short[k][0]);
        if (sv) consider(sv, st.getPropertyPriority(short[k][0]) === 'important', m[i].r.layered, m[i].sp, m[i].r.order, short[k][0], short[k][1]);
      }
    }
    var inl = !pseudo && el.style && el.style.getPropertyValue(prop);
    if (inl) consider(inl, el.style.getPropertyPriority(prop) === 'important', false, 1e9, 1e9, null, -1);
    else if (el.style && !pseudo) for (var j = 0; j < short.length; j++) {
      var iv = el.style.getPropertyValue(short[j][0]);
      if (iv) consider(iv, false, false, 1e9, 1e9, short[j][0], short[j][1]);
    }
    return best;
  }
  function varsIn(value) {
    var out = [], re = /var\(\s*(--[\w-]+)/g, m;
    while ((m = re.exec(value))) out.push(m[1]);
    return out;
  }
  // The piece of a box shorthand that sets one side ("padding: var(--a) var(--b)" -> right is var(--b)).
  function boxPiece(value, pos) {
    if (pos < 0) return value;
    var parts = splitTop(value.replace(/\s*\/.*$/, ''), /\s/);
    if (parts.length === 1) return parts[0];
    if (parts.length === 2) return parts[pos % 2];
    if (parts.length === 3) return parts[pos === 3 ? 1 : pos];
    return parts[pos] || value;
  }
  // Custom property chain: --button-bg -> --color-action-primary-bg -> --color-orange-500.
  function chainOf(el, name) {
    var chain = [name], seen = {};
    seen[name] = 1;
    var cur = name;
    for (var d = 0; d < 8; d++) {
      var found = null;
      for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
        var dv = declared(e, cur);
        if (dv) { found = dv.value; break; }
      }
      if (!found) break;
      var next = varsIn(found);
      if (next.length !== 1 || seen[next[0]] || found.trim().indexOf('var(') !== 0) break;
      seen[next[0]] = 1;
      chain.push(next[0]);
      cur = next[0];
    }
    return chain;
  }

  // ---- value normalisation through a probe element ----
  var probe = document.createElement('div');
  probe.style.cssText = 'position:absolute;visibility:hidden;pointer-events:none;width:0;height:0';
  document.body.appendChild(probe);
  var colorCache = {};
  function normColor(v) {
    if (v in colorCache) return colorCache[v];
    probe.style.color = '';
    probe.style.color = v;
    var out = probe.style.color ? getComputedStyle(probe).color : null;
    colorCache[v] = out;
    return out;
  }
  function normLength(v) {
    probe.style.width = '';
    probe.style.width = v;
    if (!probe.style.width) return null;
    var w = getComputedStyle(probe).width;
    probe.style.width = '0';
    return w;
  }
  var isColorProp = function (p) { return /color$/.test(p) || p === 'fill' || p === 'stroke'; };

  // Variables in scope at the component (for value matching): defined on :root, or on a provider element around the
  // story (Fluent's FluentProvider, a theme wrapper). Custom properties inherit, so the component root's computed style
  // holds both.
  var rootVars = null;
  var scopeEl = null;
  function rootTokens() {
    if (rootVars) return rootVars;
    rootVars = { colors: {}, lengths: {}, count: 0, scoped: 0 };
    var cs = getComputedStyle(scopeEl || document.documentElement);
    var top = scopeEl ? getComputedStyle(document.documentElement) : cs;
    var names = {};
    for (var i = 0; i < rules.length; i++) {
      var st = rules[i].style;
      for (var k = 0; k < st.length; k++) if (st[k].indexOf('--') === 0) names[st[k]] = 1;
    }
    for (var i2 = 0; i2 < cs.length; i2++) if (cs[i2].indexOf('--') === 0) names[cs[i2]] = 1;
    for (var i3 = 0; scopeEl && i3 < top.length; i3++) if (top[i3].indexOf('--') === 0) names[top[i3]] = 1;
    for (var n in names) {
      var v = cs.getPropertyValue(n).trim();
      if (!v) continue;
      rootVars.count++;
      if (scopeEl && !top.getPropertyValue(n).trim()) rootVars.scoped++;
      if (/^(#|rgb|hsl|oklch|oklab|lab|lch|color\()/i.test(v)) {
        var c = normColor(v);
        if (c) (rootVars.colors[c] = rootVars.colors[c] || []).push(n);
      } else if (/^-?[\d.]+(px|rem|em)$/.test(v)) {
        var l = normLength(v);
        if (l) (rootVars.lengths[l] = rootVars.lengths[l] || []).push(n);
      }
    }
    return rootVars;
  }

  function tokenFor(el, prop, computed, pseudo) {
    var d = declared(el, prop, pseudo);
    // A pseudo-element inherits from its element, an element from its parent.
    var parentOf = pseudo ? el : el.parentElement;
    if (d) {
      var piece = d.shorthand && /^(padding|margin|border-radius|border-width|border-color|border-style|gap)$/.test(d.shorthand) ? boxPiece(d.value, d.pos) : d.value;
      var vars = varsIn(piece);
      if (vars.length) {
        var pick = vars[0];
        if (vars.length > 1) {
          var cs = getComputedStyle(el, pseudo ? '::' + pseudo : null);
          for (var i = 0; i < vars.length; i++) {
            var rv = cs.getPropertyValue(vars[i]).trim();
            var same = isColorProp(prop) ? normColor(rv) === computed : normLength(rv) === computed;
            if (same) { pick = vars[i]; break; }
          }
        }
        var chain = chainOf(el, pick);
        var direct = piece.trim().indexOf('var(') === 0 && vars.length === 1;
        // A declaration that does not give the computed value lost the cascade somewhere this script does not model:
        // the value is not tied to it (it may still match a variable by value below).
        if (direct && !/^(line-height|font-weight|opacity|font-family)$/.test(prop)) {
          var own = getComputedStyle(el, pseudo ? '::' + pseudo : null).getPropertyValue(pick).trim();
          var got = isColorProp(prop) ? normColor(own) : /px$/.test(computed) ? normLength(own) : null;
          if (own && got && got !== computed) d = null;
        }
        if (d) return { via: 'declared', chain: chain, exact: direct, declared: piece.trim() };
      }
      if (d && /^(inherit|currentcolor)$/i.test(d.value.trim()) && parentOf && prop !== 'background-color') {
        var cp = prop === 'fill' || prop === 'stroke' || /border-.*-color/.test(prop) ? 'color' : prop;
        // currentcolor on another property reads this element's (or pseudo's) own color; inherit, and color:
        // currentcolor, read the parent's (a pseudo-element's parent is its element).
        var up = /currentcolor/i.test(d.value) && cp !== prop
          ? tokenFor(el, cp, getComputedStyle(el, pseudo ? '::' + pseudo : null).getPropertyValue(cp), pseudo)
          : parentOf ? tokenFor(parentOf, cp, getComputedStyle(parentOf).getPropertyValue(cp)) : null;
        if (up) return up;
      }
    } else if (/^(color|font-family|font-size|font-weight|line-height|letter-spacing)$/.test(prop) && parentOf) {
      // Inherited: the token comes from the nearest ancestor that declares it.
      return tokenFor(parentOf, prop, computed);
    }
    var rt = rootTokens();
    var hit = isColorProp(prop) ? rt.colors[computed] : rt.lengths[computed];
    if (hit && hit.length) return { via: 'matched', chain: hit.slice(0, 3), exact: false };
    return null;
  }

  // ---- the rendered tree ----
  var count = 0;
  function own(el, cs) {
    var bg = cs.backgroundColor;
    var hasBg = bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
    var hasBorder = ['Top', 'Right', 'Bottom', 'Left'].some(function (s) { return parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none'; });
    var pad = ['Top', 'Right', 'Bottom', 'Left'].some(function (s) { return parseFloat(cs['padding' + s]) > 0; });
    var paints = function (v) { return !!v && v !== 'none'; };
    return hasBg || hasBorder || pad || paints(cs.boxShadow) || paints(cs.backgroundImage);
  }
  function directText(el) {
    var t = '';
    for (var c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 3) t += c.nodeValue;
    return t.replace(/\s+/g, ' ').trim();
  }
  function visible(el, cs) {
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return false;
    // Closed or hidden content is not a layer: transparent, hidden, inert, clipped away, or a hidden popover.
    if (parseFloat(cs.opacity) === 0 || el.hidden || el.hasAttribute('inert')) return false;
    if (/inset\((50|100)%/.test(cs.clipPath || '')) return false;
    if (el.getAttribute('aria-hidden') === 'true' && (/^(tooltip|dialog|menu|listbox)$/.test(el.getAttribute('role') || '') || /popover|tooltip/i.test(String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className)))) return false;
    var r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && !el.children.length) return false;
    // Visually hidden text for screen readers (1 px, clipped): not drawn, not a layer.
    if ((cs.position === 'absolute' || cs.position === 'fixed') && r.width <= 1 && r.height <= 1 && (/hidden|clip/.test(cs.overflow) || cs.clip !== 'auto' && cs.clip !== '' || cs.clipPath !== 'none')) return false;
    return true;
  }
  function round(n) { return Math.round(n * 100) / 100; }
  // An inline SVG as markup Figma can draw: every shape's computed fill and stroke written on it, currentColor
  // resolved, the rendered size set.
  function svgMarkup(el, r) {
    if (el.outerHTML.length > 12000) return null;
    var strokes = [];
    var clone = el.cloneNode(true);
    var src = [el].concat(Array.prototype.slice.call(el.querySelectorAll('*')));
    var dst = [clone].concat(Array.prototype.slice.call(clone.querySelectorAll('*')));
    var color = getComputedStyle(el).color;
    for (var i = 0; i < src.length && i < dst.length; i++) {
      var cs = getComputedStyle(src[i]);
      if (/^(path|circle|rect|ellipse|line|polyline|polygon|use|text)$/.test(src[i].tagName.toLowerCase()) || i === 0) {
        var f = cs.fill, k = cs.stroke;
        if (f) dst[i].setAttribute('fill', /url\(/.test(f) ? (src[i].getAttribute('fill') || 'none') : f);
        if (k && k !== 'none') {
          dst[i].setAttribute('stroke', k);
          if (cs.strokeWidth) dst[i].setAttribute('stroke-width', parseFloat(cs.strokeWidth));
          if (i > 0) strokes.push(k);
        }
        else if (i > 0 && k === 'none' && src[i].getAttribute('stroke')) dst[i].setAttribute('stroke', 'none');
      }
      dst[i].removeAttribute('class');
      dst[i].removeAttribute('style');
    }
    clone.setAttribute('width', round(r.width));
    clone.setAttribute('height', round(r.height));
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    return { svg: clone.outerHTML.replace(/currentColor/gi, color), strokes: strokes };
  }
  // ::before / ::after drawn as a box (a switch knob, a checkbox's box, a radio's circle): a frame part with its box,
  // paint, border, radius and position. Text-only or empty pseudo-elements are not parts.
  function pseudoNode(el, which, hostRect) {
    var cs = getComputedStyle(el, '::' + which);
    var content = cs.content;
    if (!content || content === 'none' || content === 'normal' || cs.display === 'none' || cs.visibility === 'hidden') return null;
    var w = parseFloat(cs.width), h = parseFloat(cs.height);
    if (!(w > 0) || !(h > 0) || !/px$/.test(cs.width) || !/px$/.test(cs.height)) return null;
    var bg = cs.backgroundColor;
    var paints = (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') || (cs.backgroundImage && cs.backgroundImage !== 'none') || (cs.boxShadow && cs.boxShadow !== 'none');
    var bordered = ['Top', 'Right', 'Bottom', 'Left'].some(function (s) { return parseFloat(cs['border' + s + 'Width']) > 0 && cs['border' + s + 'Style'] !== 'none'; });
    if (!paints && !bordered) return null;
    // Border box: CSS width/height are content-box unless box-sizing says otherwise.
    if (cs.boxSizing !== 'border-box') {
      w += (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) + (parseFloat(cs.borderLeftWidth) || 0) + (parseFloat(cs.borderRightWidth) || 0);
      h += (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0) + (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    }
    var hcs = getComputedStyle(el);
    var padX = hostRect.left + (parseFloat(hcs.borderLeftWidth) || 0), padY = hostRect.top + (parseFloat(hcs.borderTopWidth) || 0);
    var padW = hostRect.width - (parseFloat(hcs.borderLeftWidth) || 0) - (parseFloat(hcs.borderRightWidth) || 0);
    var padH = hostRect.height - (parseFloat(hcs.borderTopWidth) || 0) - (parseFloat(hcs.borderBottomWidth) || 0);
    var x, y;
    if (cs.position === 'absolute' || cs.position === 'fixed') {
      x = /px$/.test(cs.left) ? padX + parseFloat(cs.left) : /px$/.test(cs.right) ? padX + padW - parseFloat(cs.right) - w : padX;
      y = /px$/.test(cs.top) ? padY + parseFloat(cs.top) : /px$/.test(cs.bottom) ? padY + padH - parseFloat(cs.bottom) - h : padY;
    } else {
      // In flow: before at the start of the content box, after at its end.
      var cx = padX + (parseFloat(hcs.paddingLeft) || 0), cy = padY + (parseFloat(hcs.paddingTop) || 0);
      x = which === 'before' ? cx : padX + padW - (parseFloat(hcs.paddingRight) || 0) - w;
      y = cy;
    }
    var m = /matrix\(([^)]+)\)/.exec(cs.transform || '');
    if (m) { var mv = m[1].split(',').map(parseFloat); x += mv[4] || 0; y += mv[5] || 0; }
    var style = {};
    for (var i = 0; i < PROPS.length; i++) style[PROPS[i]] = cs.getPropertyValue(PROPS[i]);
    style.width = round(w) + 'px';
    style.height = round(h) + 'px';
    var tokens = {};
    for (var j = 0; j < TOKENED.length; j++) {
      var p = TOKENED[j], v = style[p];
      if (!v || v === 'none' || v === 'normal' || v === 'auto' || v === 'rgba(0, 0, 0, 0)') continue;
      if (/width$/.test(p) && /^border-/.test(p) && v === '0px') continue;
      if (/^border-.*-color$/.test(p) && parseFloat(style[p.replace('color', 'width')]) === 0) continue;
      var t = tokenFor(el, p, v, which);
      if (t) tokens[p] = t;
    }
    count++;
    return { tag: '::' + which, kind: 'frame', pseudo: which, sized: { width: true, height: true }, classes: [], box: { x: round(x - originX), y: round(y - originY), width: round(w), height: round(h) }, style: style, tokens: tokens, children: [] };
  }
  var originX = 0, originY = 0;
  function node(el, depth) {
    count++;
    var cs = getComputedStyle(el);
    var r = el.getBoundingClientRect();
    var tag = el.tagName.toLowerCase();
    var style = {};
    for (var i = 0; i < PROPS.length; i++) style[PROPS[i]] = cs.getPropertyValue(PROPS[i]);
    var tokens = {};
    for (var j = 0; j < TOKENED.length; j++) {
      var p = TOKENED[j], v = style[p];
      if (!v || v === 'none' || v === 'normal' || v === 'auto' || v === 'rgba(0, 0, 0, 0)') continue;
      if (/width$/.test(p) && /^border-/.test(p) && v === '0px') continue;
      if (/^border-.*-color$/.test(p) && parseFloat(style[p.replace('color', 'width')]) === 0) continue;
      var t = tokenFor(el, p, v);
      if (t) tokens[p] = t;
    }
    // A width or height the CSS sets (not auto, a percentage or content-sized): the pull keeps it fixed.
    var sized = {};
    ['width', 'height'].forEach(function (k) {
      var dv = declared(el, k);
      var v = dv ? dv.value.trim() : (el.style && el.style.getPropertyValue(k)) || '';
      if (v && !/^(auto|inherit|initial|unset|revert|fit-content|max-content|min-content|stretch|-webkit-fill-available)/.test(v) && !/%/.test(v)) sized[k] = true;
    });
    var n = { tag: tag, classes: Array.prototype.slice.call(el.classList || []).slice(0, 8), box: { x: round(r.left - originX), y: round(r.top - originY), width: round(r.width), height: round(r.height) }, style: style, tokens: tokens, children: [] };
    var role = el.getAttribute('role');
    if (role) n.role = role;
    if (sized.width || sized.height) n.sized = sized;
    var dataState = {};
    for (var ai = 0; ai < el.attributes.length; ai++) {
      var an = el.attributes[ai].name;
      if (/^(data-(state|variant|size|disabled|checked|selected|tone|appearance)|aria-(checked|pressed|disabled|selected|invalid))$/.test(an)) dataState[an] = el.attributes[ai].value;
    }
    if (Object.keys(dataState).length) n.attrs = dataState;
    if (tag === 'svg') {
      n.kind = r.width <= 48 && r.height <= 48 ? 'icon' : 'vector';
      var mk = svgMarkup(el, r);
      if (mk) { n.svg = mk.svg; n.svgStrokes = mk.strokes; }
      return n;
    }
    if (tag === 'img') { n.kind = 'frame'; n.media = true; return n; }
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      n.kind = 'frame';
      n.input = { type: el.type || tag, value: el.value || '', placeholder: el.getAttribute('placeholder') || '', checked: !!el.checked };
    }
    var hasEl = false;
    var before = pseudoNode(el, 'before', r), after = pseudoNode(el, 'after', r);
    if (before) { n.children.push(before); hasEl = true; }
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (count >= MAX_NODES) { n.truncated = true; break; }
      if (c.nodeType === 3) {
        var tx = c.nodeValue.replace(/\s+/g, ' ').trim();
        if (!tx) continue;
        var range = document.createRange();
        range.selectNodeContents(c);
        var tr = range.getBoundingClientRect();
        n.children.push({ tag: '#text', kind: 'text', text: tx, box: { x: round(tr.left - originX), y: round(tr.top - originY), width: round(tr.width), height: round(tr.height) }, style: {}, tokens: {}, children: [] });
      } else if (c.nodeType === 1) {
        var ccs = getComputedStyle(c);
        if (!visible(c, ccs)) continue;
        if (depth + 1 > MAX_DEPTH) { hasEl = true; n.truncated = true; continue; }
        var cn = node(c, depth + 1);
        // A box with no area and nothing drawn inside (a closed popover's shell) is not a layer.
        if (cn.kind === 'frame' && !cn.children.length && !(cn.box.width * cn.box.height) && !cn.input && !cn.media) continue;
        hasEl = true;
        n.children.push(cn);
      }
    }
    if (after) { n.children.push(after); hasEl = true; }
    // An element holding only text is the text layer itself.
    if (!hasEl && n.children.length === 1 && n.children[0].kind === 'text' && !own(el, cs)) {
      n.kind = 'text';
      n.text = n.children[0].text;
      n.children = [];
    } else if (!n.kind) n.kind = 'frame';
    return n;
  }

  var host = document.querySelector(rootSel);
  if (!host) return { error: 'no element matches ' + rootSel + ' in the page' };
  // Popups portaled to the body (a menu, a dialog, a toast region): visible elements outside the story root.
  var portals = [];
  for (var b = document.body.firstElementChild; b; b = b.nextElementSibling) {
    if (b === probe || b.contains(host) || /^(SCRIPT|STYLE|LINK|TEMPLATE)$/.test(b.tagName)) continue;
    if (/sb-(wrapper|errordisplay|nopreview|preparing)|sb-show-main/.test(b.className || '')) continue;
    var bcs = getComputedStyle(b);
    if (!visible(b, bcs)) continue;
    // A portal container can be zero-size around its positioned popup: it counts when anything in it has a box.
    var br = b.getBoundingClientRect();
    if (br.width > 0 && br.height > 0) { portals.push(b); continue; }
    var inner = b.querySelectorAll('*');
    for (var q = 0; q < inner.length && q < 200; q++) { var ir = inner[q].getBoundingClientRect(); if (ir.width > 0 && ir.height > 0) { portals.push(b); break; } }
  }
  var storyRoot = host;
  // target 'portal': the component is the open popup (the newest portal), not the trigger in the story root.
  if (arg.target === 'portal') {
    if (!portals.length) { probe.remove(); return { error: 'no popup is open outside the story root' }; }
    host = portals[portals.length - 1];
    portals = portals.slice(0, -1);
    // A modal portal holds a backdrop beside the popup: the popup is the element with a popup role, when there is one.
    var roled = host.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="tooltip"], [role="tree"], [role="grid"]');
    if (roled && visible(roled, getComputedStyle(roled))) host = roled;
  }
  // Decorators and plain wrappers: go down while an element has one child and draws nothing itself.
  var el = host, wrappers = 0;
  // A decorator canvas the size of the viewport (a theme frame with a background and padding) is a wrapper too.
  // So is a full-width band around one narrower child (a theme provider painting the page background).
  function canvas(e) {
    var r = e.getBoundingClientRect();
    if (r.width >= window.innerWidth * 0.9 && r.height >= window.innerHeight * 0.9) return true;
    if (r.width < window.innerWidth * 0.9) return false;
    var c = e.children[0].getBoundingClientRect();
    if (c.width < r.width * 0.9) return true;
    // A full-width background with no border, radius or shadow: a theme surface, not a component.
    var cs = getComputedStyle(e);
    var noBorder = ['Top', 'Right', 'Bottom', 'Left'].every(function (x) { return !(parseFloat(cs['border' + x + 'Width']) > 0) || cs['border' + x + 'Style'] === 'none'; });
    return noBorder && !(parseFloat(cs.borderTopLeftRadius) > 0) && (!cs.boxShadow || cs.boxShadow === 'none');
  }
  while (arg.unwrap !== false && el.children.length === 1 && !directText(el) && (!own(el, getComputedStyle(el)) || canvas(el)) && el.children[0].tagName.toLowerCase() !== 'svg') {
    var only = el.children[0];
    var ocs = getComputedStyle(only);
    if (!visible(only, ocs)) break;
    el = only;
    wrappers++;
  }
  // within: a part that only renders inside its parent or a popup (a menu item, an accordion item, a toast) is measured
  // alone: the first visible match in the component, then in the popups.
  if (arg.within) {
    var pool = [el].concat(portals), hit = null;
    for (var wi = 0; wi < pool.length && !hit; wi++) {
      var cands = [];
      try { if (pool[wi].matches(arg.within)) cands.push(pool[wi]); cands = cands.concat(Array.prototype.slice.call(pool[wi].querySelectorAll(arg.within))); } catch (e) { probe.remove(); return { error: 'not a CSS selector: ' + arg.within }; }
      for (var ci = 0; ci < cands.length && !hit; ci++) if (visible(cands[ci], getComputedStyle(cands[ci])) && cands[ci].getBoundingClientRect().width > 0) hit = cands[ci];
    }
    if (!hit) { probe.remove(); return { error: 'no element matches ' + arg.within + ' in the story or its popups' }; }
    portals = portals.filter(function (p) { return !p.contains(hit); });
    el = hit;
  }
  // mark: tag the component element (for a forced :hover / :focus-visible from the browser driver) and stop.
  if (arg.mark) {
    var prev = document.querySelectorAll('[data-bridge-measure-root]');
    for (var mi = 0; mi < prev.length; mi++) prev[mi].removeAttribute('data-bridge-measure-root');
    el.setAttribute('data-bridge-measure-root', '');
    probe.remove();
    return { marked: true };
  }
  scopeEl = el;
  var hr = el.getBoundingClientRect();
  // Fill or hug: a block-level root that spans its container's content box (or is declared width: 100%) fills it.
  var rootFill = false;
  (function () {
    var pe = el.parentElement;
    var ecs = getComputedStyle(el);
    var inner = window.innerWidth;
    if (pe) {
      var pcs = getComputedStyle(pe);
      inner = pe.getBoundingClientRect().width - (parseFloat(pcs.paddingLeft) || 0) - (parseFloat(pcs.paddingRight) || 0) - (parseFloat(pcs.borderLeftWidth) || 0) - (parseFloat(pcs.borderRightWidth) || 0);
    }
    var dw = declared(el, 'width');
    var full = (dw && /^100%$/.test(dw.value.trim())) || (el.style && el.style.width === '100%');
    var blockish = /^(block|flex|grid|table|list-item|flow-root)$/.test(ecs.display);
    rootFill = !!full || (inner > 0 && Math.abs(hr.width - inner) <= 1 && (blockish || hr.width >= window.innerWidth * 0.5));
  })();
  originX = hr.left; originY = hr.top;
  var tree = arg.unwrap !== false && el === storyRoot && !storyRoot.children.length && !directText(storyRoot) ? null : node(el, 0);
  var portalTrees = [];
  for (var pi = 0; pi < portals.length && pi < 3; pi++) portalTrees.push(node(portals[pi], 0));
  probe.remove();
  var rt = rootVars || { count: 0 };
  return {
    root: tree,
    portals: portalTrees,
    wrappers: wrappers,
    nodes: count,
    rules: rules.length,
    sheets: { read: sheetsRead, blocked: sheetsBlocked },
    rootFill: rootFill,
    rootVariables: rt.count,
    scopedVariables: rt.scoped || 0,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    error: document.body.classList.contains('sb-show-errordisplay') ? (document.querySelector('#error-message') || {}).textContent || 'the story threw' : undefined
  };
})`;
