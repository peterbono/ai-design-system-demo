import assert from 'node:assert/strict';
import { test } from 'vitest';
import { loadConfig, toConfigJson } from '../src/config';
import { approverLists, canShip, DEFAULT_RIGHTS, groupsPhrase, holdersOf, normalizeRights, shipPolicy, whoCanShipSentence } from '../src/rights';

const owners = { design: ['dana'], tech: ['theo', 'tara'] };

test('config without rights keeps the old behavior: no rights, auto visual impact', () => {
  const c = loadConfig({ repo: 'acme/ds', governance: { owners } });
  assert.equal(c.governance.rights, undefined);
  assert.equal(c.visualImpact, undefined);
  assert.deepEqual(approverLists(owners, c.governance.rights), owners);
  assert.equal(shipPolicy(owners, c.governance.rights), null);
  assert.equal(canShip('dana', shipPolicy(owners, c.governance.rights)), true);
});

test('rights load, missing entries take the default, groups keep design then tech order', () => {
  const c = loadConfig({ repo: 'acme/ds', governance: { owners, rights: { ship: ['tech', 'design'] } } });
  assert.deepEqual(c.governance.rights, { approveDesign: ['design'], approveTech: ['tech'], ship: ['design', 'tech'] });
  assert.deepEqual(normalizeRights({}), DEFAULT_RIGHTS);
  assert.deepEqual(toConfigJson(c).governance, c.governance);
});

test('rights and visualImpact validation', () => {
  assert.throws(() => loadConfig({ governance: { rights: { ship: ['pm'] } } } as never), /governance\.rights\.ship/);
  assert.throws(() => loadConfig({ governance: { rights: { ship: [] } } } as never), /governance\.rights\.ship/);
  assert.throws(() => loadConfig({ governance: { rights: { merge: ['tech'] } } } as never), /governance\.rights\.merge/);
  assert.throws(() => loadConfig({ governance: { rights: 'tech' } } as never), /governance\.rights/);
  assert.throws(() => loadConfig({ visualImpact: { mode: 'sometimes' } } as never), /visualImpact\.mode/);
  assert.throws(() => loadConfig({ visualImpact: { label: 'x' } } as never), /visualImpact\.label/);
  assert.deepEqual(loadConfig({ visualImpact: { mode: 'on-demand' } }).visualImpact, { mode: 'on-demand' });
  assert.deepEqual(toConfigJson(loadConfig({ visualImpact: { mode: 'on-demand' } })).visualImpact, { mode: 'on-demand' });
});

test('holders and approver lists follow the groups', () => {
  const r = normalizeRights({ approveDesign: ['design', 'tech'], ship: ['design', 'tech'] });
  assert.deepEqual(holdersOf('approveDesign', owners, r), ['dana', 'theo', 'tara']);
  assert.deepEqual(holdersOf('approveTech', owners, r), ['theo', 'tara']);
  assert.deepEqual(approverLists(owners, r), { design: ['dana', 'theo', 'tara'], tech: ['theo', 'tara'] });
});

test('ship policy: tech owners by default, design owners when the team says so', () => {
  const tech = shipPolicy(owners, DEFAULT_RIGHTS)!;
  assert.deepEqual(tech, { logins: ['theo', 'tara'], groups: ['tech'], entries: ['theo', 'tara'] });
  assert.equal(canShip('dana', tech), false);
  assert.equal(canShip('@Theo', tech), true);
  assert.equal(canShip(null, tech), false);
  assert.equal(whoCanShipSentence(tech), 'Only the tech owner can merge this (@theo, @tara).');
  const both = shipPolicy(owners, normalizeRights({ ship: ['design', 'tech'] }))!;
  assert.equal(canShip('dana', both), true);
  assert.equal(groupsPhrase(both.groups), 'a design or tech owner');
});

test('ship policy with empty owner lists singles nobody out', () => {
  assert.equal(shipPolicy({ design: [], tech: [] }, DEFAULT_RIGHTS), null);
  assert.equal(canShip('anyone', null), true);
});
