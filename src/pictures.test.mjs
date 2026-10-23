import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PNG } from 'pngjs';
import { render, changedPictures } from './pictures.mjs';
import { cleanTranscript, guessLang, stripForSpeech } from './voice.mjs';
import { isYes } from './session.mjs';

test('a 16×16 picture is drawn 32 characters wide, two pixels per line', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kidex-'));
  const png = new PNG({ width: 16, height: 16 });
  png.data.fill(255);
  const file = path.join(dir, 'red.png');
  fs.writeFileSync(file, PNG.sync.write(png));

  const lines = render(file, { width: 32 });
  assert.equal(lines.length, 16);
  assert.equal(lines[0].replace(/\x1b\[[0-9;]*m/g, '').length, 32);
  assert.deepEqual(changedPictures(dir, 0), [file]);
  assert.deepEqual(changedPictures(dir, Date.now() + 1000), []);
});

test('speech bits', () => {
  assert.equal(cleanTranscript(' [BLANK_AUDIO] (music) make a cake '), 'make a cake');
  assert.equal(guessLang('jeg vil lave en kage'), 'da');
  assert.equal(guessLang('I want to make a cake'), 'en');
  assert.equal(stripForSpeech('🎉 **Done!**'), 'Done!');
  assert.ok(isYes('Ja!') && isYes('yes') && isYes('gør det'));
  assert.ok(!isYes('yes but make it blue') && !isYes('nej'));
});
