import { describe, expect, it } from 'vitest';
import { base64Of, figmaFromLink, figmaLinkProblem, imageProblem, MAX_IMAGE_BYTES, requestImageUrl } from './request-attachments';

describe('figma link', () => {
  it('accepts an empty field and figma.com links', () => {
    expect(figmaLinkProblem('')).toBeNull();
    expect(figmaLinkProblem('https://www.figma.com/design/I8dPxMjjL43bblTJjCY6uC/Kit?node-id=12-34')).toBeNull();
    expect(figmaLinkProblem('https://figma.com/file/abc/Kit')).toBeNull();
  });

  it('says how to fix anything else', () => {
    expect(figmaLinkProblem('figma frame')).toMatch(/Copy link to selection/);
    expect(figmaLinkProblem('https://example.com/design/abc')).toMatch(/not a Figma link/);
    expect(figmaLinkProblem('http://www.figma.com/design/abc')).toMatch(/not a Figma link/);
    expect(figmaLinkProblem('https://figma.com.evil.io/design/abc')).toMatch(/not a Figma link/);
  });

  it('reads the file key and node id', () => {
    expect(figmaFromLink('https://www.figma.com/design/I8dPxMjjL43bblTJjCY6uC/Kit?node-id=12-34')).toEqual({
      url: 'https://www.figma.com/design/I8dPxMjjL43bblTJjCY6uC/Kit?node-id=12-34',
      fileKey: 'I8dPxMjjL43bblTJjCY6uC',
      nodeId: '12:34',
    });
    expect(figmaFromLink('https://www.figma.com/')).toEqual({ url: 'https://www.figma.com/' });
    expect(figmaFromLink('')).toBeUndefined();
    expect(figmaFromLink('nope')).toBeUndefined();
  });
});

describe('image', () => {
  it('accepts web images up to the limit', () => {
    expect(imageProblem({ type: 'image/png', size: 1000 })).toBeNull();
    expect(imageProblem({ type: 'image/webp', size: MAX_IMAGE_BYTES })).toBeNull();
    expect(imageProblem({ type: 'application/pdf', size: 1000 })).toMatch(/PNG, JPEG/);
    expect(imageProblem({ type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatch(/larger than 5 MB/);
  });

  it('builds the public URL and reads base64', () => {
    expect(requestImageUrl('peterbono', 'ai-design-system-demo', '.bridge/requests/button-1.png')).toBe(
      'https://github.com/peterbono/ai-design-system-demo/blob/bridge-requests/.bridge/requests/button-1.png?raw=true',
    );
    expect(base64Of('data:image/png;base64,QUJD')).toBe('QUJD');
    expect(base64Of('data:text/plain,abc')).toBeNull();
  });
});
