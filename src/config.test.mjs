import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, sessionConfig } from './config.mjs';

test('SPACE on the start screen talks: kidex.json "talk" says what may run right away', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kidex-'));
  fs.writeFileSync(path.join(dir, 'kidex.json'), JSON.stringify({ effort: 'medium', talk: { prompt: 'Kits are in kits/.', now: ['./mc kit'], effort: 'low' } }));
  const config = loadConfig(dir);
  assert.equal(config.talk.id, 'talk');
  assert.match(config.talk.prompt, /right away, without a plan: \.\/mc kit\./);
  assert.match(config.talk.prompt, /Kits are in kits\/\.$/);
  const s = sessionConfig(config, config.talk, { language: 'da' });
  assert.deepEqual([s.now, s.effort, s.language], [['./mc kit'], 'low', 'da']);
  assert.deepEqual(sessionConfig(config, config.actions[0]).now, []);
  assert.deepEqual(loadConfig(os.tmpdir()).talk.now, []);
});
