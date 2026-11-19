import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as live from '../public/js/liveops.js';

const save = () => ({ shells: 0 });

test('daily missions: 3 different ones, the same for everyone on a day, rotating', () => {
  const seen = new Set();
  for (let i = 1; i <= 28; i++) {
    const day = `2026-11-${String(i).padStart(2, '0')}`;
    const a = live.pickMissions(day), b = live.pickMissions(day);
    assert.equal(a.length, 3);
    assert.equal(new Set(a.map((m) => m.id)).size, 3);
    assert.deepEqual(a.map((m) => m.id), b.map((m) => m.id));
    assert.ok(a[0].easy);
    for (const m of a) seen.add(m.id);
  }
  assert.ok(seen.size >= 9, `pool rotates (${seen.size} templates seen)`);
});

test('mission counters', () => {
  const d = save();
  live.noteMissionGame(d, 'D', 'chess', { kind: 'versus' });
  live.noteMissionGame(d, 'D', 'puffer', { best: true });
  live.noteMissionGame(d, 'D', 'tide', { kind: 'tide' });
  assert.equal(d.missions.games, 3);
  assert.equal(d.missions.versus, 1);
  assert.equal(d.missions.best, 1);
  assert.equal(d.missions.tide, 1);
  assert.deepEqual(d.missions.ids, ['chess', 'puffer', 'tide']);
  const arcade = live.MISSION_POOL.find((m) => m.id === 'arcade');
  assert.equal(arcade.cur(d.missions), 1);
  live.noteMissionGame(d, 'E', 'merge');
  assert.equal(d.missions.games, 1, 'a new day resets');
});

test('Tide Pass: seasons cover every day, game XP is capped per day, tiers pay out once', () => {
  for (const day of ['2026-11-18', '2026-12-25', '2027-04-01', '2027-08-31', '2027-10-05', '2028-02-29']) {
    const s = live.seasonAt(day);
    assert.ok(s && day >= s.from && day <= s.to, `${day} in ${s.id}`);
    assert.ok(live.seasonDaysLeft(s, day) >= 1);
    assert.ok(live.OUTFIT[s.outfit], 'season outfit exists');
  }
  const d = save(), season = live.seasonAt('2026-11-18');
  let added = 0;
  for (let i = 0; i < 50; i++) added += live.addXp(d, season, '2026-11-18', live.XP.game, { game: true });
  assert.equal(added, live.XP.game * live.XP.gameCapPerDay);
  live.addXp(d, season, '2026-11-19', live.XP.game, { game: true });
  assert.equal(d.pass.xp, added + live.XP.game, 'cap resets the next day');
  const tiers = live.tierOfXp(d.pass.xp, season);
  const got = live.claimTiers(d, season, () => 0.5);
  assert.equal(got.filter((g) => g.tier).length, tiers);
  assert.equal(live.claimTiers(d, season).length, 0, 'no double claims');
  // the final tier gives the season outfit
  d.pass.xp = live.TIERS * live.tierXp(season) * 2;
  const shellsBefore = d.shells;
  live.claimTiers(d, season, () => 0.5);
  assert.equal(d.pass.claimed, live.TIERS * 2, 'bonus tiers keep paying past tier 30');
  assert.ok(d.outfits[season.outfit]);
  assert.ok(d.shells > shellsBefore);
  // an outfit you already own turns into shells
  const d2 = { shells: 0, outfits: { [season.outfit]: 1 }, pass: { season: season.id, xp: live.TIERS * live.tierXp(season), claimed: live.TIERS - 1 } };
  live.claimTiers(d2, season, () => 0.5);
  assert.ok(d2.shells >= 800);
});

test('sticker packs, spares turn into shells, pages pay once', () => {
  const d = save();
  let r = 0;
  const roll = () => ((r = (r * 9301 + 49297) % 233280) / 233280);
  for (let i = 0; i < 300; i++) live.openPack(d, roll);
  assert.ok(d.shells > 0, 'spares paid out');
  for (const s of live.STICKERS) if (s.game) live.grantGameSticker(d, s.game);
  assert.equal(live.grantGameSticker(d, 'chess'), null, 'game sticker only once');
  const before = d.shells;
  const pages = live.claimPages(d);
  assert.ok(pages.length >= 1);
  assert.equal(d.shells - before, pages.reduce((a, p) => a + p.shells, 0));
  assert.equal(live.claimPages(d).length, 0);
});

test('wardrobe: buy with shells, never twice, season outfits not for sale', () => {
  const d = { shells: 300 };
  assert.equal(live.buyOutfit(d, 'crown'), false);
  assert.equal(live.buyOutfit(d, 'bow'), true);
  assert.equal(d.shells, 50);
  assert.equal(d.pipOutfit, 'bow');
  assert.equal(live.buyOutfit(d, 'bow'), false);
  d.shells = 99999;
  assert.equal(live.buyOutfit(d, 'scarf'), false);
});

test('seasonal stickers come only from that season\'s packs; advent doors open once', () => {
  const d = { shells: 0 };
  for (let i = 0; i < 200; i++) live.openPack(d, Math.random, 's1');
  assert.ok(Object.keys(d.stickers).some((k) => k.startsWith('s1-')));
  assert.ok(!Object.keys(d.stickers).some((k) => /^s[023]-/.test(k)));
  assert.equal(live.adventDoor('2026-11-30'), null);
  const r = live.openAdvent(d, '2026-12-21', () => 0.5);
  assert.ok(d.stickers['s1-0'] >= 1 && r.got.length > 1);
  assert.equal(live.openAdvent(d, '2026-12-21'), null, 'one door a day');
});
