// "Share" on the Quality header: a DS Menu with two actions. "Copy summary" puts a short text on the clipboard for
// Slack or a slide; "Download image" saves the header as a PNG, drawn from an SVG in the page's own colors (light or
// dark) and fonts. Words and the drawing: lib/library-health.ts. Rendered by pages/studio/quality/index.astro.
import { useRef, useState } from 'react';
import { Copy, Download, Share2 } from 'lucide-react';
import { Button, Menu, MenuContent, MenuItem, MenuTrigger } from '@bridge-ds/react';
import { qualityShareText, qualitySvg, SHARE_COLOR_VARS, SHARE_IMAGE, type HealthFigure, type ShareColors } from '../../../lib/library-health';

export interface QualityShareProps {
  figures: HealthFigure[];
  sentence: string;
  /** The Quality page path; the absolute link is built from the address the viewer is on. */
  path: string;
}

/** A computed custom property as a color the SVG understands (the canvas normalizes any CSS color to hex or rgba). */
function readColors(el: Element): ShareColors {
  const style = getComputedStyle(el);
  const probe = document.createElement('canvas').getContext('2d');
  const out = {} as ShareColors;
  for (const [key, name] of Object.entries(SHARE_COLOR_VARS) as [keyof ShareColors, string][]) {
    const raw = style.getPropertyValue(name).trim();
    if (probe && raw) probe.fillStyle = raw;
    out[key] = probe && raw ? String(probe.fillStyle) : raw;
  }
  return out;
}

const toDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

/**
 * The page's Fraunces and Instrument Sans faces as @font-face rules with the files embedded (latin subset only): an
 * SVG drawn as an image cannot load fonts from the page. Empty when the stylesheets cannot be read.
 */
async function embeddedFonts(): Promise<string> {
  const rules: { family: string; src: string; weight: string; style: string }[] = [];
  for (const sheet of Array.from(document.styleSheets)) {
    let list: CSSRuleList;
    try {
      list = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(list)) {
      if (!(rule instanceof CSSFontFaceRule)) continue;
      const s = rule.style;
      const family = s.getPropertyValue('font-family').replace(/["']/g, '').trim();
      if (!/^(Fraunces|Instrument Sans)/i.test(family)) continue;
      const range = s.getPropertyValue('unicode-range');
      if (range && !/U\+0+-0*FF\b/i.test(range)) continue;
      if ((s.getPropertyValue('font-style') || 'normal').trim() !== 'normal') continue;
      const url = s.getPropertyValue('src').match(/url\(["']?([^"')]+)["']?\)/)?.[1];
      if (url) rules.push({ family, src: new URL(url, sheet.href ?? location.href).href, weight: s.getPropertyValue('font-weight') || '400', style: 'normal' });
    }
  }
  const css = await Promise.all(
    rules.map(async (r) => {
      try {
        const data = await toDataUrl(await (await fetch(r.src)).blob());
        return `@font-face{font-family:'${r.family}';font-style:${r.style};font-weight:${r.weight};src:url(${data});}`;
      } catch {
        return '';
      }
    }),
  );
  return css.join('');
}

async function headerPng(svg: string): Promise<Blob> {
  const img = new Image();
  img.decoding = 'async';
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = SHARE_IMAGE.width * scale;
  canvas.height = SHARE_IMAGE.height * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no image'))), 'image/png'));
}

export function QualityShare({ figures, sentence, path }: QualityShareProps) {
  const [said, setSaid] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const say = (text: string) => {
    setSaid(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setSaid(''), 6000);
  };
  const url = () => new URL(path, location.href).href;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(qualityShareText({ figures, sentence, url: url() }));
      say('Summary copied. Paste it in Slack or on a slide.');
    } catch {
      say('Copy is not available in this browser. Download the image instead.');
    }
  };

  const download = async () => {
    say('Preparing the image.');
    try {
      const link = new URL(url());
      const svg = qualitySvg({
        figures,
        sentence,
        colors: readColors(root.current ?? document.body),
        caption: `Bridge Studio, ${link.host}${link.pathname}`,
        fontCss: await embeddedFonts(),
      });
      const blob = await headerPng(svg);
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = SHARE_IMAGE.file;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
      say('Image downloaded.');
    } catch {
      say('The image could not be made in this browser. Copy the summary instead.');
    }
  };

  return (
    <div ref={root} className="ql-share">
      <p className="ql-said" role="status" aria-live="polite">
        {said}
      </p>
      <Menu>
        <MenuTrigger render={<Button variant="secondary" iconStart={Share2}>Share</Button>} />
        <MenuContent align="end">
          <MenuItem icon={Copy} onClick={() => void copy()}>
            Copy summary
          </MenuItem>
          <MenuItem icon={Download} onClick={() => void download()}>
            Download image
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
