import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describe, peek } from './files.mjs';

test('files are explained in kid words, and a project can explain its own', () => {
  assert.equal(describe('src/main.js', 'en').icon, '📜');
  assert.equal(describe('tests/e2e.js', 'da').icon, '🧪');
  assert.equal(describe('pack/manifest.json', 'en').icon, '🪪');
  assert.match(describe('a/b.png', 'da').text, /billede/i);
  const explain = { 'kit.json': { en: 'What you get', da: 'Det du får' }, 'textures/': 'A picture for the game' };
  assert.equal(describe('addons/x/kit.json', 'da', explain).text, 'Det du får');
  assert.equal(describe('addons/x/textures/items/x.png', 'en', explain).text, 'A picture for the game');
});

test('the peek skips boilerplate and stays short', () => {
  const html = '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n<title>Robot</title>\n<button onclick="dance()">Dance!</button>';
  assert.deepEqual(peek(html), ['<button onclick="dance()">Dance!<…']);
  assert.equal(peek('a\nb\nc\nd\ne\nf\ng').length, 5);
  assert.deepEqual(peek(undefined), []);
});
