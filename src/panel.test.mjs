import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPanel, closePanel, panelState, pressKey, escapePanel, resizePanel, keyBytes } from './panel.mjs';

const until = async (ok, ms = 3000) => {
  for (const end = Date.now() + ms; !ok(); await new Promise(r => setTimeout(r, 20))) {
    if (Date.now() > end) throw new Error('timed out');
  }
};
const text = () => panelState().lines.map(l => l.replace(/\x1b\[[0-9;]*m/g, '').trimEnd());

test('the program gets a real terminal of the panel size, and its screen keeps colours', async () => {
  openPanel("[ -t 0 ] && [ -t 1 ] && echo tty; tput cols; tput lines; printf '\\033[32mgreen\\033[0m\\n'", { cwd: process.cwd(), title: 'Server', cols: 40, rows: 10 });
  await until(() => panelState().code === 0 && text().includes('green'));
  assert.deepEqual(text().slice(0, 4), ['tty', '40', '10', 'green']);
  assert.match(panelState().lines[3], /\x1b\[0;32mgreen/);
  assert.equal(panelState().lines.length, 10);
  closePanel();
  assert.equal(panelState(), null);
});

test('a full-screen program draws in place, gets keys, and follows a resize', async () => {
  // Draws at row 3, column 5 in its own screen, then shows each line it reads and the new size.
  const script = "printf '\\033[?1049h\\033[3;5Hhello'; stty -echo; while read l; do printf '\\033[5;1H%s %s' \"$l\" \"$(tput cols)\"; done";
  openPanel(script, { cwd: process.cwd(), title: 'x', cols: 30, rows: 8 });
  await until(() => text()[2] === '    hello');
  resizePanel(50, 8);
  for (const c of 'hi') pressKey(c, {});
  pressKey('', { return: true });
  await until(() => text()[4] === 'hi 50');
  closePanel();
});

test('closing stops the program and everything it started', async () => {
  openPanel('sleep 30 & echo $!; wait', { cwd: process.cwd(), title: 'x' });
  await until(() => /^\d+$/.test(text()[0]));
  const pid = Number(text()[0]);
  closePanel();
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
});

test('opening the same program again keeps the one that runs; an ended one starts again', async () => {
  openPanel('echo $$; sleep 30', { cwd: process.cwd(), title: 'x' });
  await until(() => /^\d+$/.test(text()[0]));
  const first = text()[0];
  openPanel('echo $$; sleep 30', { cwd: process.cwd(), title: 'x' });
  assert.equal(text()[0], first);
  closePanel();

  openPanel('exit 3', { cwd: process.cwd(), title: 'x' });
  await until(() => panelState().code === 3);
  openPanel('exit 3', { cwd: process.cwd(), title: 'x' });
  assert.equal(panelState().code, null);
  closePanel();
});

test('ESC closes the program\'s own menu first, and leaves the panel when there is none', async () => {
  // A "menu" that ESC closes: the first ESC clears the screen, later ones change nothing.
  const script = "stty raw -echo; printf menu; while true; do c=$(dd bs=1 count=1 2>/dev/null); [ -n \"$m\" ] || { printf '\\033[2J\\033[H'; m=1; }; done";
  openPanel(script, { cwd: process.cwd(), title: 'x', cols: 20, rows: 4 });
  await until(() => text()[0] === 'menu');
  let left = 0;
  escapePanel(() => left++, 100);
  await new Promise(r => setTimeout(r, 300));
  assert.equal(left, 0);
  assert.equal(text()[0], '');
  escapePanel(() => left++, 100);
  await until(() => left === 1);
  closePanel();
});

test('keys become what a terminal sends', () => {
  assert.equal(keyBytes('', { upArrow: true }), '\x1b[A');
  assert.equal(keyBytes('', { return: true }), '\r');
  assert.equal(keyBytes('', { escape: true }), '\x1b');
  assert.equal(keyBytes('', { delete: true }), '\x7f');
  assert.equal(keyBytes('c', { ctrl: true }), '\x03');
  assert.equal(keyBytes('k', {}), 'k');
});
