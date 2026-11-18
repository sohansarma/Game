import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameProblem, randomNickname } from '../public/js/storage.js';

test('name filter: catches rude names, not innocent numbers', () => {
  for (const ok of ['Kind Fish 17', 'Calm Shark 17', 'Sunny Turtle 62', 'Zoë', 'Captain Pip']) assert.equal(nameProblem(ok), null, ok);
  for (const bad of ['sh1t', 's h i t', 'b1tch 9', 'admin', 'www.x.com', 'call 5551234']) assert.ok(nameProblem(bad), bad);
});

test('random nicknames always pass the filter', () => {
  for (let i = 0; i < 20000; i++) {
    const n = randomNickname();
    assert.equal(nameProblem(n), null, n);
  }
});
