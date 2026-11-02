// The library update rules: versions, what a product installs, the lockfile patch, the pull request and the page's words.
import { describe, expect, it } from 'vitest';
import {
  LIBRARY_UPDATE_WORDS,
  compareVersions,
  installedVersion,
  isUpdatePull,
  libraryDirsOf,
  libraryLine,
  libraryState,
  lockKindOf,
  patchLockfile,
  patchPackageJson,
  rangeFloor,
  rangeFor,
  satisfies,
  updateBody,
  updateBranch,
  updateTitle,
  updateVersionOf,
  UPDATE_BRANCH,
  UPDATE_MARKER,
  versionsBehind,
} from './library-update';
import { LOCK, LOCK_TEXT, PKG } from './library-update.fixture';
import { REACT_184 } from './library-update.fixture';

describe('versions', () => {
  it('compares versions, prereleases before their release', () => {
    expect(compareVersions('1.8.3', '1.8.4')).toBe(-1);
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('2.0.0-next.1', '2.0.0')).toBe(-1);
    expect(compareVersions('2.0.0-next.2', '2.0.0-next.10')).toBe(-1);
    expect(compareVersions('1.8.4', '1.8.4')).toBe(0);
    expect(compareVersions('latest', '1.0.0')).toBeNull();
  });

  it('reads the ranges a package.json uses', () => {
    expect(satisfies('1.8.4', '^1.8.2')).toBe(true);
    expect(satisfies('2.0.0', '^1.8.2')).toBe(false);
    expect(satisfies('0.8.0', '^0.7.0')).toBe(false);
    expect(satisfies('0.7.5', '^0.7.0')).toBe(true);
    expect(satisfies('0.0.4', '^0.0.3')).toBe(false);
    expect(satisfies('1.9.0', '~1.8.2')).toBe(false);
    expect(satisfies('1.8.9', '~1.8.2')).toBe(true);
    expect(satisfies('1.8.4', '>=1.8.3')).toBe(true);
    expect(satisfies('19.0.0', '>=18')).toBe(true);
    expect(satisfies('1.8.4', '1.8.3')).toBe(false);
    expect(satisfies('1.8.4', '1.x')).toBe(true);
    expect(satisfies('1.8.4', '^0.9.0 || ^1.0.0')).toBe(true);
    expect(satisfies('1.8.4', '>=1.0.0 <1.8.4')).toBe(false);
    expect(satisfies('1.8.4', '*')).toBe(true);
    expect(satisfies('2.0.0-next.1', '^1.8.2')).toBe(false);
    expect(satisfies('1.8.4', 'workspace:*')).toBeNull();
    expect(satisfies('1.8.4', 'github:acme/lib')).toBeNull();
  });

  it('keeps a range that takes the new version, rewrites ^ ~ and exact ones, leaves the rest', () => {
    expect(rangeFor('^1.8.2', '1.8.4')).toBe('^1.8.2');
    expect(rangeFor('^1.8.2', '2.0.0')).toBe('^2.0.0');
    expect(rangeFor('~1.8.2', '1.9.0')).toBe('~1.9.0');
    expect(rangeFor('1.8.3', '1.8.4')).toBe('1.8.4');
    expect(rangeFor('workspace:*', '1.8.4')).toBeNull();
    expect(rangeFloor('^1.8.2')).toBe('1.8.2');
    expect(rangeFloor('>=18')).toBe('18.0.0');
  });

  it('versionsBehind: the packages older than the latest, components first, the rest left out', () => {
    expect(versionsBehind({ '@bridge-ds/tokens': '1.5.0', '@bridge-ds/react': '1.8.3', '@bridge-ds/toolbar': '0.7.0' }, { '@bridge-ds/react': '1.8.4', '@bridge-ds/tokens': '2.0.0', '@bridge-ds/toolbar': '0.7.0' })).toEqual([
      { name: '@bridge-ds/react', installed: '1.8.3', latest: '1.8.4', bump: 'patch' },
      { name: '@bridge-ds/tokens', installed: '1.5.0', latest: '2.0.0', bump: 'major' },
    ]);
    expect(versionsBehind({ '@bridge-ds/react': null, '@bridge-ds/tokens': 'next' }, { '@bridge-ds/react': '1.8.4', '@bridge-ds/tokens': '1.6.0' })).toEqual([]);
  });
});

describe('what a product installs', () => {
  it('tells the lockfile from the root files', () => {
    expect(lockKindOf(['package.json', 'package-lock.json', 'yarn.lock'])).toBe('npm');
    expect(lockKindOf(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm');
    expect(lockKindOf(['package.json', 'yarn.lock'])).toBe('yarn');
    expect(lockKindOf(['package.json'])).toBe('none');
  });

  it('reads the installed versions of the direct library packages (not the transitive core)', () => {
    const s = libraryState({ pkg: PKG, lock: LOCK, lockKind: 'npm', latest: { '@bridge-ds/react': '1.8.4', '@bridge-ds/tokens': '1.6.0', '@bridge-ds/toolbar': '0.7.0' } });
    expect(s.packages.map((p) => [p.name, p.installed])).toEqual([
      ['@bridge-ds/react', '1.8.3'],
      ['@bridge-ds/tokens', '1.6.0'],
      ['@bridge-ds/toolbar', '0.7.0'],
    ]);
    expect(s.behind).toEqual([{ name: '@bridge-ds/react', installed: '1.8.3', latest: '1.8.4', bump: 'patch' }]);
    expect(s.headline?.name).toBe('@bridge-ds/react');
  });

  it('finds the workspace that asks for the library, and its own copy first', () => {
    const lock = { lockfileVersion: 3, packages: { '': { name: 'mono' }, 'apps/web': { dependencies: { '@bridge-ds/react': '^1.8.0' } }, 'apps/web/node_modules/@bridge-ds/react': { version: '1.8.1' }, 'node_modules/@bridge-ds/react': { version: '1.7.0' } } };
    expect(libraryDirsOf(lock)).toEqual(['apps/web']);
    expect(installedVersion(lock, '@bridge-ds/react', 'apps/web')).toBe('1.8.1');
    expect(installedVersion(lock, '@bridge-ds/react')).toBe('1.7.0');
    expect(libraryDirsOf({ packages: {} })).toEqual(['']);
  });

  it('without an npm lockfile, knows the range only', () => {
    const s = libraryState({ pkg: PKG, lock: null, lockKind: 'pnpm', latest: { '@bridge-ds/react': '1.8.4' } });
    expect(s.headline).toMatchObject({ name: '@bridge-ds/react', installed: null, range: '^1.8.2', latest: '1.8.4' });
    expect(s.behind).toEqual([]);
  });
});

describe('patchLockfile', () => {
  it('moves only version, resolved and integrity when the dependency tree is unchanged', () => {
    const r = patchLockfile(LOCK_TEXT, [{ name: '@bridge-ds/react', manifest: REACT_184 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const after = JSON.parse(r.text);
    expect(after.packages['node_modules/@bridge-ds/react']).toEqual({
      ...LOCK.packages['node_modules/@bridge-ds/react'],
      version: '1.8.4',
      resolved: 'https://registry.npmjs.org/@bridge-ds/react/-/react-1.8.4.tgz',
      integrity: 'sha512-new',
    });
    // Every other line stays as npm wrote it: the diff is the three lines of that entry.
    const before = LOCK_TEXT.split('\n');
    const changed = r.text.split('\n').filter((l, i) => l !== before[i]);
    expect(changed).toEqual(['      "version": "1.8.4",', '      "resolved": "https://registry.npmjs.org/@bridge-ds/react/-/react-1.8.4.tgz",', '      "integrity": "sha512-new",']);
    expect(r.text.endsWith('}\n')).toBe(true);
  });

  it('writes the new workspace range into the lockfile too', () => {
    const r = patchLockfile(LOCK_TEXT, [{ name: '@bridge-ds/react', manifest: { ...REACT_184, version: '2.0.0' } }], new Map([['\u0000@bridge-ds/react', '^2.0.0']]));
    // The toolbar's peer range (>=1.8.3) takes 2.0.0; the root now asks for ^2.0.0.
    expect(r.ok).toBe(true);
    if (r.ok) expect(JSON.parse(r.text).packages[''].dependencies['@bridge-ds/react']).toBe('^2.0.0');
  });

  it('falls back when the new version changes its dependencies', () => {
    const m = { ...REACT_184, dependencies: { ...REACT_184.dependencies, '@base-ui/react': '1.10.0' } };
    expect(patchLockfile(LOCK_TEXT, [{ name: '@bridge-ds/react', manifest: m }])).toEqual({ ok: false, reason: 'dependencies-changed' });
    const peer = { ...REACT_184, peerDependencies: { react: '>=19' } };
    expect(patchLockfile(LOCK_TEXT, [{ name: '@bridge-ds/react', manifest: peer }])).toEqual({ ok: false, reason: 'dependencies-changed' });
  });

  it('falls back when a dependent does not take the new version, or the package is not from the registry', () => {
    // The root still asks for ^1.8.2: 2.0.0 is out of it.
    expect(patchLockfile(LOCK_TEXT, [{ name: '@bridge-ds/react', manifest: { ...REACT_184, version: '2.0.0' } }])).toEqual({ ok: false, reason: 'dependents' });
    const own = JSON.parse(LOCK_TEXT);
    own.packages['node_modules/@bridge-ds/react'].resolved = 'https://npm.acme.dev/@bridge-ds/react/-/react-1.8.3.tgz';
    expect(patchLockfile(JSON.stringify(own), [{ name: '@bridge-ds/react', manifest: REACT_184 }])).toEqual({ ok: false, reason: 'other-source' });
    const two = JSON.parse(LOCK_TEXT);
    two.packages['node_modules/@bridge-ds/toolbar/node_modules/@bridge-ds/react'] = { ...two.packages['node_modules/@bridge-ds/react'] };
    expect(patchLockfile(JSON.stringify(two), [{ name: '@bridge-ds/react', manifest: REACT_184 }])).toEqual({ ok: false, reason: 'several-copies' });
    expect(patchLockfile(JSON.stringify({ ...LOCK, lockfileVersion: 1 }), [{ name: '@bridge-ds/react', manifest: REACT_184 }])).toEqual({ ok: false, reason: 'lockfile-version' });
    expect(patchLockfile('not json', [])).toEqual({ ok: false, reason: 'not-json' });
  });

  it('patchPackageJson changes only the named ranges, in the file’s own style', () => {
    const text = '{\n\t"dependencies": {\n\t\t"@bridge-ds/react": "1.8.3",\n\t\t"react": "18.3.1"\n\t}\n}';
    expect(patchPackageJson(text, new Map([['@bridge-ds/react', '1.8.4']]))).toBe('{\n\t"dependencies": {\n\t\t"@bridge-ds/react": "1.8.4",\n\t\t"react": "18.3.1"\n\t}\n}');
  });
});

describe('the pull request', () => {
  it('has the update branch, the title and Bridge’s marker with the version', () => {
    expect(updateBranch('1.8.4')).toBe('bridge/update-library-1.8.4');
    expect(UPDATE_BRANCH.test('bridge/update-library-1.8.4')).toBe(true);
    expect(UPDATE_BRANCH.test('bridge/update-library-1.8.4/../main')).toBe(false);
    expect(UPDATE_BRANCH.test('main')).toBe(false);
    expect(updateTitle('1.8.4')).toBe('Update the Bridge library to 1.8.4');
    const body = updateBody({
      product: 'Art print shop',
      version: '1.8.4',
      packages: [{ name: '@bridge-ds/react', from: '1.8.3', to: '1.8.4', rangeFrom: '^1.8.2', rangeTo: '^1.8.2' }],
      changelog: 'https://bridge.floriangouloubi.com/library/peterbono/ai-design-system-demo/changelog/',
      lockfile: 'patched',
      requestedBy: 'Florian',
    });
    expect(body).toContain(UPDATE_MARKER);
    expect(updateVersionOf(body)).toBe('1.8.4');
    expect(body).toContain('| `@bridge-ds/react` | 1.8.3 | 1.8.4 | [What changed](https://bridge.floriangouloubi.com/library/peterbono/ai-design-system-demo/changelog/) |');
    expect(body).toContain('Bridge never merges this pull request.');
    expect(body).toContain('Requested by Florian through Bridge.');
    expect(body).not.toMatch(/\u2014/);
    const install = updateBody({ product: 'Shop', version: '2.0.0', packages: [{ name: '@bridge-ds/react', from: '1.8.3', to: '2.0.0', rangeFrom: '^1.8.2', rangeTo: '^2.0.0' }], changelog: null, lockfile: 'install', requestedBy: null });
    expect(install).toContain('Run `npm install` on this branch');
    expect(install).toContain('(package.json ^1.8.2 to ^2.0.0)');
  });

  it('recognizes only its own update pull request', () => {
    const own = { body: `${UPDATE_MARKER}\nx`, head: { ref: 'bridge/update-library-1.8.4', repo: { full_name: 'Acme/Shop' } } };
    expect(isUpdatePull(own, 'acme/shop')).toBe(true);
    expect(isUpdatePull({ ...own, body: 'no marker' }, 'acme/shop')).toBe(false);
    expect(isUpdatePull({ ...own, head: { ref: 'bridge/update-library-1.8.4', repo: { full_name: 'someone/fork' } } }, 'acme/shop')).toBe(false);
    expect(isUpdatePull({ ...own, head: { ref: 'explore/x', repo: { full_name: 'acme/shop' } } }, 'acme/shop')).toBe(false);
  });
});

describe('the product page’s words', () => {
  const behind = libraryState({ pkg: PKG, lock: LOCK, lockKind: 'npm', latest: { '@bridge-ds/react': '1.8.4', '@bridge-ds/tokens': '1.6.0', '@bridge-ds/toolbar': '0.7.0' } });
  const current = libraryState({ pkg: PKG, lock: LOCK, lockKind: 'npm', latest: { '@bridge-ds/react': '1.8.3', '@bridge-ds/tokens': '1.6.0', '@bridge-ds/toolbar': '0.7.0' } });
  const pr = { number: 7, url: 'https://github.com/acme/shop/pull/7', version: '1.8.4' };

  it('behind, for a lead: the line and the one action', () => {
    expect(libraryLine('Art print shop', behind, { update: null, canSend: true, github: true })).toEqual({ text: 'Art print shop uses the library from 1.8.3. The latest is 1.8.4.', send: true, sent: false, link: null });
  });

  it('for anyone who cannot send the update (a designer): no line at all, a fact they cannot act on', () => {
    expect(libraryLine('Art print shop', behind, { update: null, canSend: false, github: false })).toBeNull();
    expect(libraryLine('Art print shop', behind, { update: pr, canSend: false, github: true })).toBeNull();
    expect(libraryLine('Art print shop', current, { update: null, canSend: false, github: true })).toBeNull();
  });

  it('sent: "Update sent to the developers." and the link only for people with GitHub (an email admin has none)', () => {
    expect(libraryLine('Art print shop', behind, { update: pr, canSend: true, github: true })).toMatchObject({ send: false, sent: true, link: pr.url });
    expect(libraryLine('Art print shop', behind, { update: pr, canSend: true, github: false })).toMatchObject({ send: false, sent: true, link: null });
  });

  it('an update open for an older version: a lead sends the newer one (in place)', () => {
    expect(libraryLine('Art print shop', behind, { update: { ...pr, version: '1.8.3' }, canSend: true, github: true })).toMatchObject({ send: true, sent: false });
  });

  it('up to date, and not known (another lockfile)', () => {
    expect(libraryLine('Art print shop', current, { update: null, canSend: true, github: true })).toEqual({ text: 'Art print shop uses the latest library, 1.8.3.', send: false, sent: false, link: null });
    const pnpm = libraryState({ pkg: PKG, lock: null, lockKind: 'pnpm', latest: { '@bridge-ds/react': '1.8.4' } });
    expect(libraryLine('Art print shop', pnpm, { update: null, canSend: true, github: true })?.text).toBe('The latest library is 1.8.4. Bridge cannot tell which one Art print shop uses yet.');
    const out = libraryState({ pkg: PKG, lock: null, lockKind: 'yarn', latest: { '@bridge-ds/react': '2.0.0' } });
    expect(libraryLine('Art print shop', out, { update: null, canSend: true, github: true })).toMatchObject({ text: 'Art print shop uses the library from 1.8.2. The latest is 2.0.0.', send: true });
    expect(libraryLine('Art print shop', null, { update: null, canSend: true, github: true })).toBeNull();
  });

  it('designers never read a package, a lockfile or a pull request', () => {
    const words = [LIBRARY_UPDATE_WORDS.behind('Shop', '1.0.0', '1.1.0'), LIBRARY_UPDATE_WORDS.current('Shop', '1.1.0'), LIBRARY_UPDATE_WORDS.unknown('Shop', '1.1.0'), LIBRARY_UPDATE_WORDS.send, LIBRARY_UPDATE_WORDS.sent, LIBRARY_UPDATE_WORDS.open, LIBRARY_UPDATE_WORDS.failed].join(' ');
    expect(words).not.toMatch(/npm|package|lockfile|pull request|branch|merge|GitHub|@bridge-ds|\u2014/i);
  });
});
