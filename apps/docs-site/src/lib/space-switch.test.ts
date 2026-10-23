// The Library <-> Studio switch: where it goes from each page (the item rides across), what it is called, and the
// first-visit hint flag.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import SpaceSwitch, { SPACE_SWITCH_NOW_ID } from '../components/SpaceSwitch';
import {
  currentLabel,
  HINT_KEY,
  isPlainClick,
  markHintSeen,
  shouldShowHint,
  switchLabel,
  switchTarget,
  switchTooltip,
} from './space-switch';

const names: Record<string, string> = { button: 'Button', 'alert-dialog': 'AlertDialog' };
const nameOf = (slug: string) => names[slug];

describe('switchTarget from the Library', () => {
  const lib = (pathname: string) => switchTarget({ space: 'library', pathname, nameOf });

  it('opens a component in its Studio drawer, named', () => {
    expect(lib('/components/button/')).toEqual({ href: '/studio/components/?c=button', item: 'Button' });
    expect(lib('/components/alert-dialog')).toEqual({ href: '/studio/components/?c=alert-dialog', item: 'AlertDialog' });
  });

  it('uses the same Studio doors as the pages "Edit in Studio"', () => {
    expect(lib('/components/')).toEqual({ href: '/studio/components/', item: 'Components' });
    expect(lib('/foundations/color/')).toEqual({ href: '/studio/tokens/?focus=color', item: 'Color' });
    expect(lib('/foundations/typography/').href).toBe('/studio/tokens/?focus=font');
    expect(lib('/foundations/spacing/').href).toBe('/studio/tokens/?focus=space');
    expect(lib('/foundations/radius/').href).toBe('/studio/tokens/?focus=radius');
    expect(lib('/foundations/elevation/').href).toBe('/studio/tokens/?focus=shadow');
    expect(lib('/foundations/accessibility/').href).toBe('/studio/quality/');
    expect(lib('/how-review-works/').href).toBe('/studio/settings/#approvals');
    expect(lib('/tokens/')).toEqual({ href: '/studio/tokens/', item: 'Tokens' });
  });

  it('opens Studio home from any other page', () => {
    expect(lib('/library/')).toEqual({ href: '/studio/', item: null });
    expect(lib('/install/')).toEqual({ href: '/studio/', item: null });
    expect(lib('/components/<script>/')).toEqual({ href: '/studio/', item: null });
  });

  it('keeps the team of a team Library, and its component', () => {
    const team = { owner: 'acme', repo: 'ds' };
    expect(switchTarget({ space: 'library', pathname: '/library/acme/ds/components/', search: '?c=card', libraryRoute: 'components/', team, studioRoot: '/studio/acme/ds/' })).toEqual({
      href: '/studio/acme/ds/components/?c=card',
      item: null,
    });
    expect(switchTarget({ space: 'library', pathname: '/library/acme/ds/components/card/', libraryRoute: 'components/card/', team, studioRoot: '/studio/acme/ds/' })).toEqual({
      href: '/studio/acme/ds/components/?c=card',
      item: null,
    });
    expect(switchTarget({ space: 'library', pathname: '/library/acme/ds/', libraryRoute: '', team, studioRoot: '/studio/~/acme/ds/' }).href).toBe('/studio/~/acme/ds/');
    expect(switchTarget({ space: 'library', pathname: '/library-shell/tokens/', libraryRoute: 'tokens/' }).href).toBe('/studio/tokens/');
    expect(switchTarget({ space: 'library', pathname: '/library/acme/ds/foundations/color/', libraryRoute: 'foundations/color/', team, studioRoot: '/studio/acme/ds/' })).toEqual({ href: '/studio/acme/ds/tokens/?focus=color', item: 'Color' });
    expect(switchTarget({ space: 'library', pathname: '/library/acme/ds/foundations/accessibility/', libraryRoute: 'foundations/accessibility/', team, studioRoot: '/studio/acme/ds/' }).href).toBe('/studio/acme/ds/quality/');
  });
});

describe('switchTarget from Studio', () => {
  const studio = (pathname: string, search = '') => switchTarget({ space: 'studio', pathname, search, nameOf });

  it('opens the open drawer component in the Library, and vice versa', () => {
    expect(studio('/studio/components/', '?c=button')).toEqual({ href: '/components/button/', item: 'Button' });
    expect(studio('/studio/components/', '?family=Actions')).toEqual({ href: '/components/', item: 'Components' });
    expect(studio('/studio/components/docs/button/')).toEqual({ href: '/components/button/', item: 'Button' });
  });

  it('maps tokens, focus groups and quality back to their Library pages', () => {
    expect(studio('/studio/tokens/')).toEqual({ href: '/tokens/', item: 'Tokens' });
    expect(studio('/studio/tokens/', '?focus=color')).toEqual({ href: '/foundations/color/', item: 'Color' });
    expect(studio('/studio/quality/').href).toBe('/foundations/accessibility/');
    expect(studio('/studio/')).toEqual({ href: '/library/', item: null });
    expect(studio('/studio/changes/', '?pr=12')).toEqual({ href: '/library/', item: null });
  });

  it('opens the team Library from a team shell, with the component', () => {
    const team = { owner: 'acme', repo: 'ds' };
    const t = (pathname: string, search = '', studioRoot = '/studio/acme/ds/') => switchTarget({ space: 'studio', pathname, search, team, studioRoot, nameOf });
    expect(t('/studio/acme/ds/components/', '?c=button')).toEqual({ href: '/library/acme/ds/components/button/', item: 'Button' });
    expect(t('/studio/acme/ds/tokens/', '?focus=color')).toEqual({ href: '/library/acme/ds/foundations/color/', item: 'Color' });
    expect(t('/studio/acme/ds/tokens/').href).toBe('/library/acme/ds/tokens/');
    expect(t('/studio/acme/ds/quality/').href).toBe('/library/acme/ds/foundations/accessibility/');
    expect(t('/studio/acme/ds/settings/').href).toBe('/library/acme/ds/');
    expect(t('/studio/~/acme/ds/components/', '', '/studio/~/acme/ds/').href).toBe('/library/acme/ds/components/');
  });

  it('opens the site\'s own Library from the team shell of the repository it documents, for every visitor', () => {
    const own = { owner: 'peterbono', repo: 'ai-design-system-demo' };
    const t = (pathname: string, search = '') => switchTarget({ space: 'studio', pathname, search, team: own, own, studioRoot: '/studio/peterbono/ai-design-system-demo/', nameOf });
    expect(t('/studio/peterbono/ai-design-system-demo/components/', '?c=button')).toEqual({ href: '/components/button/', item: 'Button' });
    expect(t('/studio/peterbono/ai-design-system-demo/tokens/', '?focus=color').href).toBe('/foundations/color/');
    expect(t('/studio/peterbono/ai-design-system-demo/').href).toBe('/library/');
    expect(switchTarget({ space: 'studio', pathname: '/studio/acme/ds/', team: { owner: 'acme', repo: 'ds' }, own, studioRoot: '/studio/acme/ds/' }).href).toBe('/library/acme/ds/');
  });
});

describe('names', () => {
  it('names the action, and says where you are in the description', () => {
    expect(switchLabel('library')).toBe('Open Studio');
    expect(switchLabel('studio')).toBe('Open Library');
    expect(currentLabel('library')).toBe("You're in the Library");
    expect(currentLabel('studio')).toBe("You're in the Studio");
  });

  it('says the item in the tooltip when one is carried', () => {
    expect(switchTooltip('library', 'Button')).toBe('Open Button in Studio');
    expect(switchTooltip('library', null)).toBe('Open Studio');
    expect(switchTooltip('studio', 'Button')).toBe('Open Button in the Library');
    expect(switchTooltip('studio', null)).toBe('Open the Library');
  });

  it('renders one link with the action as its name, the current space as its description', () => {
    const html = renderToStaticMarkup(createElement(SpaceSwitch, { space: 'library', href: '/studio/components/?c=button', item: 'Button' }));
    const links = html.match(/<a\b/g) ?? [];
    expect(links).toHaveLength(1);
    expect(html).not.toMatch(/role="(switch|button|tab)"/);
    expect(html).toContain('aria-label="Open Studio"');
    expect(html).toContain(`aria-describedby="${SPACE_SWITCH_NOW_ID}"`);
    expect(html).toContain(`id="${SPACE_SWITCH_NOW_ID}"`);
    expect(html).toContain('You&#x27;re in the Library');
    expect(html).toContain('data-tooltip="Open Button in Studio"');
    expect(html).toContain('href="/studio/components/?c=button"');
    expect(html).not.toContain(String.fromCharCode(0x2014));
    const studio = renderToStaticMarkup(createElement(SpaceSwitch, { space: 'studio', href: '/library/' }));
    expect(studio).toContain('aria-label="Open Library"');
    expect(studio).toContain('data-tooltip="Open the Library"');
    // The maintainer avatar slot only exists where Studio is the destination.
    expect(studio).not.toContain('data-team-avatar');
  });
});

describe('first-visit hint', () => {
  const memory = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
  };

  it('plays once: until it is marked seen', () => {
    const s = memory();
    expect(shouldShowHint(s, false)).toBe(true);
    expect(markHintSeen(s)).toBe(true);
    expect(s.m.get(HINT_KEY)).toBe('1');
    expect(shouldShowHint(s, false)).toBe(false);
  });

  it('never plays under reduced motion or without storage', () => {
    expect(shouldShowHint(memory(), true)).toBe(false);
    expect(shouldShowHint(null, false)).toBe(false);
  });

  it('survives a browser that refuses storage', () => {
    const refusing = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(shouldShowHint(refusing, false)).toBe(false);
    expect(markHintSeen(refusing)).toBe(false);
  });
});

describe('isPlainClick', () => {
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
  it('leaves new-tab and new-window clicks to the browser', () => {
    expect(isPlainClick(click)).toBe(true);
    expect(isPlainClick({ ...click, metaKey: true })).toBe(false);
    expect(isPlainClick({ ...click, ctrlKey: true })).toBe(false);
    expect(isPlainClick({ ...click, shiftKey: true })).toBe(false);
    expect(isPlainClick({ ...click, button: 1 })).toBe(false);
  });
});
