import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appName, appleScript, colorFor, findApp, shellLine } from './launcher.mjs';

test('the shell line goes to the folder, runs Kidex, and closes the window only when Kidex succeeds', () => {
  assert.equal(shellLine({ cwd: '/Users/me/My mods' }), "cd '/Users/me/My mods' && kidex . && exit");
  assert.equal(shellLine({ cwd: "/tmp/kid's", command: 'mc kidex' }), "cd '/tmp/kid'\\''s' && mc kidex && exit");
});

test('the AppleScript quotes the line for the terminal it opens', () => {
  for (const terminal of ['iTerm', 'Terminal']) {
    const s = appleScript({ cwd: '/a "b"', terminal });
    assert.match(s, new RegExp(`tell application "${terminal}"`));
    assert.ok(s.includes(`"cd '/a \\"b\\"' && kidex . && exit"`));
  }
});

test('kitty starts a login shell in the folder that runs Kidex and keeps a shell if it fails', () => {
  const s = appleScript({ cwd: '/Users/me/My mods', command: 'mc kidex', terminal: 'kitty', shell: '/bin/zsh' });
  assert.equal(s, `do shell script "open -na kitty --args -o font_size=18 --directory '/Users/me/My mods' '/bin/zsh' -lic 'mc kidex || exec '\\\\''/bin/zsh'\\\\'' -l'"`);
});

test('the text is big, or as big as asked', () => {
  assert.match(appleScript({ cwd: '/a', terminal: 'kitty', fontSize: '24' }), /-o font_size=24 /);
  assert.match(appleScript({ cwd: '/a', terminal: 'Terminal' }), /set font size of t to 18/);
});

test('each name keeps its color', () => {
  assert.equal(colorFor('Minecraft mods'), colorFor('Minecraft mods'));
  assert.match(colorFor('web toys'), /^#[0-9a-f]{6}$/);
});

test('the app name says it opens Kidex', () => {
  assert.equal(appName('Minecraft'), 'Minecraft (Kidex)');
  assert.equal(appName('Minecraft (Kidex)'), 'Minecraft (Kidex)');
  assert.equal(appName('a/b:c'), 'a-b-c (Kidex)');
});

test('an icon app is found by its name or its path', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kidex-'));
  fs.mkdirSync(path.join(dir, 'Game.app'));
  assert.equal(findApp(path.join(dir, 'Game')), path.join(dir, 'Game.app'));
  assert.equal(findApp(path.join(dir, 'Game.app')), path.join(dir, 'Game.app'));
  assert.throws(() => findApp('No Such Game Anywhere'), /Can't find the app/);
});
