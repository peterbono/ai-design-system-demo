import { describe, expect, it } from 'vitest';
import { attrUrl, cssValue, escapeHtml, html, jsonForScript, safeUrl, trusted } from './html';

describe('escapeHtml', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escapeHtml(`<img src=x onerror="alert(1)">'&`)).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;');
  });
  it('turns null and numbers into text', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(12)).toBe('12');
  });
});

describe('safeUrl', () => {
  it('keeps http, https, mailto and relative links', () => {
    for (const u of ['https://github.com/a/b', 'http://x.dev', 'mailto:a@b.c', '/studio/', './a', '?pr=1', '#top', 'docs/a.md', '//cdn.example.com/a.png'])
      expect(safeUrl(u)).toBe(u);
  });
  it('drops javascript:, data:, vbscript: and file: links, however they are spelled', () => {
    for (const u of ['javascript:alert(1)', ' JaVaScRiPt:alert(1)', 'java\tscript:alert(1)', 'java\nscript:alert(1)', '\u0001javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '\\\\evil', '///evil'])
      expect(safeUrl(u)).toBe('');
  });
  it('returns the fallback for non-strings and empty values', () => {
    expect(safeUrl(undefined, '#')).toBe('#');
    expect(safeUrl({ href: 'x' })).toBe('');
    expect(safeUrl('  ', '#')).toBe('#');
  });
  it('attrUrl escapes quotes so the value cannot leave the attribute', () => {
    expect(attrUrl('https://x.dev/?q="><svg onload=alert(1)>')).toBe('https://x.dev/?q=&quot;&gt;&lt;svg onload=alert(1)&gt;');
    expect(attrUrl('javascript:alert(1)')).toBe('#');
  });
});

describe('html', () => {
  it('escapes interpolations and keeps trusted fragments', () => {
    const name = '<img src=x onerror=alert(1)>';
    const out = String(html`<p title="${name}">${name} ${trusted('<b>ok</b>')} ${[html`<i>${name}</i>`]}</p>`);
    expect(out).toBe('<p title="&lt;img src=x onerror=alert(1)&gt;">&lt;img src=x onerror=alert(1)&gt; <b>ok</b> <i>&lt;img src=x onerror=alert(1)&gt;</i></p>');
  });
  it('renders null, undefined and false as nothing', () => {
    expect(String(html`${null}${undefined}${false}`)).toBe('');
  });
});

describe('jsonForScript', () => {
  it('cannot close the script element or open a comment', () => {
    const out = jsonForScript({ d: '</script><script>alert(1)</script><!--', a: 'x & y', s: 'a\u2028b' });
    expect(out).not.toMatch(/[<>&\u2028]/);
    expect(JSON.parse(out)).toEqual({ d: '</script><script>alert(1)</script><!--', a: 'x & y', s: 'a\u2028b' });
  });
  it('re-serialises JSON text read from disk', () => {
    expect(jsonForScript('{"x":"</script>"}', { parse: true })).toBe('{"x":"\\u003c/script\\u003e"}');
    expect(() => jsonForScript('not json', { parse: true })).toThrow();
  });
});

describe('cssValue', () => {
  it('keeps plain colors and lengths', () => {
    expect(cssValue('#0b1825')).toBe('#0b1825');
    expect(cssValue('rgb(0 0 0 / 50%)')).toBe('rgb(0 0 0 / 50%)');
    expect(cssValue('"Instrument Sans", sans-serif')).toBe('&quot;Instrument Sans&quot;, sans-serif');
  });
  it('drops values that load a resource or leave the declaration', () => {
    for (const v of ['red;background:url(javascript:alert(1))', 'url(https://evil.example/x)', 'image-set("a.png" 1x)', 'expression(alert(1))', 'red\\3b', '@import x', 'red}body{x:y', '"><svg onload=alert(1)>'])
      expect(cssValue(v)).toBe('');
  });
});
