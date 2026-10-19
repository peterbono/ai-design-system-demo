// PNG to RGBA and back with the browser's own decoder (a canvas): no image library in the plugin.
import type { RgbaImage } from '@bridge-ds/core';

function canvas(width: number, height: number): CanvasRenderingContext2D {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  return c.getContext('2d', { willReadFrequently: true })!;
}

export async function decodePng(base64: string): Promise<RgbaImage> {
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const ctx = canvas(bmp.width, bmp.height);
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, ctx.canvas.width, ctx.canvas.height);
  return { width: d.width, height: d.height, data: d.data };
}

export async function encodePng(img: RgbaImage): Promise<string> {
  const ctx = canvas(img.width, img.height);
  ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return ctx.canvas.toDataURL('image/png');
}
