import { test } from 'node:test';
import assert from 'node:assert/strict';
import { check, parse } from './guard.mjs';

const cwd = '/home/kid/project';
const base = { cwd, allow: ['npm run new', './mc test'], deny: ['./mc restart', 'server/data/'] };
const ok = (tool, input, planApproved = true) => check({ ...base, tool, input, planApproved }).ok;

test('reading inside the project is fine, outside is not', () => {
  assert.equal(ok('Read', { file_path: 'src/a.js' }, false), true);
  assert.equal(ok('Read', { file_path: '/etc/passwd' }, false), false);
  assert.equal(ok('Read', { file_path: '../other/secret' }, false), false);
  assert.equal(ok('Grep', { pattern: 'x' }, false), true);
});

test('secrets and denied folders are off limits', () => {
  assert.equal(ok('Read', { file_path: 'server/.env' }), false);
  assert.equal(ok('Read', { file_path: 'server/data/world.db' }), false);
  assert.equal(ok('Edit', { file_path: '.git/config' }), false);
  assert.equal(ok('Bash', { command: 'cat server/.env' }), false);
});

test('no file changes or commands before the kid says yes', () => {
  assert.equal(ok('Write', { file_path: 'a.js' }, false), false);
  assert.equal(ok('Bash', { command: 'npm run new -- cake' }, false), false);
  assert.equal(ok('Bash', { command: 'ls addons && git status' }, false), true);
});

test('after yes: allowed commands run, others do not', () => {
  assert.equal(ok('Write', { file_path: 'addons/cake/x.json' }), true);
  assert.equal(ok('Bash', { command: 'npm run new -- cake' }), true);
  assert.equal(ok('Bash', { command: './mc test cake 2>&1 | tail -20' }), true);
  assert.equal(ok('Bash', { command: 'cd addons/cake && ls' }), true);
  assert.equal(ok('Bash', { command: 'npm install left-pad' }), false);
  assert.equal(ok('Bash', { command: './mc restart' }), false);
  assert.equal(ok('Bash', { command: 'git push origin main' }), false);
  assert.equal(ok('Bash', { command: 'ls; rm -rf ~' }), false);
});

test('no sneaky shell tricks', () => {
  assert.equal(ok('Bash', { command: 'echo $(cat ~/.ssh/id_rsa)' }), false);
  assert.equal(ok('Bash', { command: 'echo hi > /etc/hosts' }), false);
  assert.equal(ok('Bash', { command: 'cd .. && ls' }), false);
  assert.equal(ok('Bash', { command: 'ls >/dev/null' }), true);
});

test('quotes are understood, so patterns with | are one command', () => {
  assert.equal(ok('Bash', { command: 'grep -rn "useItem\\|eat" addons --include=e2e.js | head -20' }, false), true);
  assert.equal(ok('Bash', { command: "rg -ln 't.player|until' tools 2>/dev/null" }, false), true);
  assert.equal(ok('Bash', { command: 'cat "a b.txt" 2>&1 | sort | head' }, false), true);
  assert.deepEqual(parse('a "x|y" | b').segments, [['a', 'x|y'], ['b']]);
});

test('look-only commands stay look-only', () => {
  assert.equal(ok('Bash', { command: 'find . -name "*.tmp" -delete' }), false);
  assert.equal(ok('Bash', { command: 'find . -exec cat {} ;' }), false);
  assert.equal(ok('Bash', { command: 'rg --pre=./evil x' }), false);
  assert.equal(ok('Bash', { command: 'sort -o out.txt in.txt' }), false);
  assert.equal(ok('Bash', { command: 'grep -o "item[a-z]*" a.json' }, false), true);
  assert.equal(ok('Bash', { command: 'git diff --output=x.patch' }), false);
  assert.equal(ok('Bash', { command: 'cat /etc/passwd' }), false);
  assert.equal(ok('Bash', { command: 'cat ~/notes.txt' }), false);
  assert.equal(ok('Bash', { command: 'for f in *; do cat $f; done' }), false);
  assert.equal(ok('Bash', { command: 'cat < /etc/hosts' }), false);
  assert.equal(ok('Bash', { command: 'ls &> out.txt' }), false);
});

test('only known tools', () => {
  assert.equal(ok('WebFetch', { url: 'https://x' }), false);
  assert.equal(ok('mcp__kidex__ask_kid', {}), true);
  assert.equal(ok('mcp__other__thing', {}), false);
});
