import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openPanel, closePanel, panelState } from './panel.mjs';

const until = async (ok, ms = 3000) => {
  for (const end = Date.now() + ms; !ok(); await new Promise(r => setTimeout(r, 20))) {
    if (Date.now() > end) throw new Error('timed out');
  }
};

test('shows output line by line, keeps the last redraw of a line, and drops colours', async () => {
  openPanel("printf 'one\\n\\033[32mtwo\\033[0m\\nwait.\\rready!\\nhalf'; exit 3", { cwd: process.cwd(), title: 'Server' });
  await until(() => panelState()?.code === 3);
  assert.deepEqual(panelState().lines, ['one', 'two', 'ready!', 'half']);
  assert.equal(panelState().title, 'Server');
  closePanel();
  assert.equal(panelState(), null);
});

test('closing stops the command and everything it started', async () => {
  openPanel('sleep 30 & echo $!; wait', { cwd: process.cwd(), title: 'x' });
  await until(() => panelState()?.lines.length > 0);
  const pid = Number(panelState().lines[0]);
  closePanel();
  await until(() => { try { process.kill(pid, 0); return false; } catch { return true; } });
});

test('opening the same command again shows it instead of starting a second one', async () => {
  openPanel('echo started; sleep 30', { cwd: process.cwd(), title: 'x' });
  await until(() => panelState()?.lines.length > 0);
  const first = panelState().child;
  openPanel('echo started; sleep 30', { cwd: process.cwd(), title: 'x' });
  assert.equal(panelState().child, first);
  closePanel();
});
