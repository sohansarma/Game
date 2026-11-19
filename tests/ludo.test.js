import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LudoGame } from '../public/js/arcade/ludo.js';
import { Rng } from '../public/js/rng.js';

test('Team Up: once you are home, your turns go to your partner', () => {
  const g = new LudoGame(new Rng(5), ['human', 'ai', 'human', 'ai'], 0, { teams: true });
  g.finished.push(0); // seat 0 is home
  g.turn = 3;
  g.passTurn();
  assert.equal(g.turn, 2, "seat 0's turn is played for partner 2");
  const ev = g.events.find((e) => e.kind === 'turn');
  assert.equal(ev.helper, 0);
  // without teams the finished seat is just skipped
  const h = new LudoGame(new Rng(5), ['human', 'ai', 'human', 'ai'], 0, {});
  h.finished.push(0);
  h.turn = 3;
  h.passTurn();
  assert.equal(h.turn, 1);
});
