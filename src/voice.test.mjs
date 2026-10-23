import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loudness } from './voice.mjs';

const sound = amplitude => {
  const b = Buffer.alloc(1600);
  for (let i = 0; i < 800; i++) b.writeInt16LE(Math.round(Math.sin(i / 5) * amplitude * 32767), i * 2);
  return b;
};

test('the sound meter: silence is 0, talking is in the middle, shouting is near 1', () => {
  assert.equal(loudness(Buffer.alloc(1600)), 0);
  assert.equal(loudness(Buffer.alloc(0)), 0);
  const talk = loudness(sound(0.05));
  assert.ok(talk > 0.2 && talk < 0.8, `talking: ${talk}`);
  assert.ok(loudness(sound(0.9)) > 0.9);
});
