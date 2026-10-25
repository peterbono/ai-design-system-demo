// /docs/security/ (pages/docs/security.astro) states durations, limits and domains for IT teams. Each one is read here
// from the code that sets it: a change in the code fails this test until the page says the new value.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_SESSION_TTL_MS } from '../../api/_lib/account';
import { SESSION_TTL_S as FIX_SESSION_TTL_S } from '../../api/_lib/fix-sessions';
import { ACCESS_TTL_S, GRANT_TTL_S, REFRESH_TTL_S } from '../../api/_lib/oauth';
import { BLOB_KEEP_S, IMMUTABLE_KEEP_S, KEEP_S, USER_KEEP_S } from '../../api/_lib/team-read';
import { JOIN_REQUEST_TTL_MS } from '../../api/_lib/teams';
import { BACKUPS_KEPT, CODE_TTL_S, MAX_TRIES } from '../../api/account/index';
import { SIGNIN_TTL_MS as CONTRIB_SIGNIN_TTL_MS, WRITE_LIMIT_DEFAULT } from '../../api/contribute/index';
import { INVITE_TRACE_MS, INVITE_TTL_MS } from '../../api/invites/index';
import { SIGNIN_TTL_MS as LIBRARY_SIGNIN_TTL_MS } from '../../api/library-access/index';
import { LINK_TTL_S } from '../../api/plugin-link/index';
import { ROOT } from './repo';

const page = readFileSync(join(ROOT, 'apps/docs-site/src/pages/docs/security.astro'), 'utf8');
const manifest = JSON.parse(readFileSync(join(ROOT, 'apps/figma-plugin/manifest.json'), 'utf8')) as { networkAccess: { allowedDomains: string[] } };

const S = { minute: 60, hour: 3600, day: 86_400 };
/** "10 minutes", "1 hour", "24 hours", "30 days": how the page writes a duration given in seconds. */
function words(seconds: number): string {
  const unit = seconds % S.day === 0 && seconds >= 2 * S.day ? 'day' : seconds % S.hour === 0 && seconds >= S.hour ? 'hour' : 'minute';
  const n = seconds / S[unit];
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

describe('Security and data page: the numbers come from the code', () => {
  it.each([
    ['account session', ACCOUNT_SESSION_TTL_MS / 1000],
    ['invite', INVITE_TTL_MS / 1000],
    ['invite trace', INVITE_TRACE_MS / 1000],
    ['join request', JOIN_REQUEST_TTL_MS / 1000],
    ['sign-in code', CODE_TTL_S],
    ['email sign-in link (contribute)', CONTRIB_SIGNIN_TTL_MS / 1000],
    ['email sign-in link (library)', LIBRARY_SIGNIN_TTL_MS / 1000],
    ['cache, most answers', KEEP_S],
    ['cache, public profiles', USER_KEEP_S],
    ['cache, immutable answers', IMMUTABLE_KEEP_S],
    ['cache, file contents', BLOB_KEEP_S],
    ['connector access token', ACCESS_TTL_S],
    ['connector refresh token', REFRESH_TTL_S],
    ['connector connection', GRANT_TTL_S],
    ['plugin hand-off', LINK_TTL_S],
    ['fix session', FIX_SESSION_TTL_S],
  ])('says the %s duration', (_what, seconds) => {
    expect(page).toContain(words(seconds));
  });

  it('says the limits', () => {
    expect(page).toContain(`${MAX_TRIES} tries`);
    expect(page).toContain(`${BACKUPS_KEPT} backups`);
    expect(page).toContain(`${WRITE_LIMIT_DEFAULT} writes a day`);
  });

  it('lists exactly the domains the Figma plugin may reach', () => {
    for (const d of manifest.networkAccess.allowedDomains) expect(page).toContain(`<code>${d}</code>`);
    expect(manifest.networkAccess.allowedDomains).toHaveLength(2);
  });

  it('writes in the Bridge voice: no em dash', () => {
    expect(page).not.toContain('—');
  });
});
