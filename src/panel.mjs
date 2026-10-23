// A program that keeps running beside the kid, like a project's dev screen: an action with
// "panel" starts it in a terminal of its own (a pty), and Kidex draws that terminal's screen
// and passes keys to it. It stops when Kidex quits.

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import htm from 'htm';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import pty from 'node-pty';
import xterm from '@xterm/headless';

const html = htm.bind(React.createElement);
const require = createRequire(import.meta.url);

let current = null; // {cmd, title, child, term, code}
const listeners = new Set();
let pending = null;
// Programs redraw in many small writes: show the screen at most every 30 ms.
const changed = () => { pending ??= setTimeout(() => { pending = null; for (const f of listeners) f(); }, 30); };

/** Starts the program in the panel, unless it already runs. */
export function openPanel(cmd, { cwd, title, cols = 80, rows = 24 }) {
  if (current?.cmd === cmd && current.code === null) return;
  closePanel();
  executableHelper();
  const term = new xterm.Terminal({ cols, rows, scrollback: 0, allowProposedApi: true });
  const child = pty.spawn('/bin/sh', ['-c', cmd], { name: 'xterm-256color', cols, rows, cwd, env: process.env });
  const p = current = { cmd, title, child, term, code: null };
  child.onData(d => { if (current === p) term.write(d, changed); });
  child.onExit(({ exitCode }) => { p.code = exitCode; changed(); });
  // The terminal answers some questions programs ask it, like where the cursor is.
  term.onData(d => { if (p.code === null) child.write(d); });
  changed();
}

export function resizePanel(cols, rows) {
  const p = current;
  if (!p || cols < 2 || rows < 2 || (p.term.cols === cols && p.term.rows === rows)) return;
  p.term.resize(cols, rows);
  if (p.code === null) p.child.resize(cols, rows);
  changed();
}

/** Sends what a key press means to the program, the way a terminal would. */
export function pressKey(input, key) {
  if (current?.code === null) current.child.write(keyBytes(input, key));
}

/**
 * ESC belongs to the program first, to close its own menus. When its screen stays the same,
 * it had nothing to close, so leave() runs: ESC leaves the panel instead.
 */
export function escapePanel(leave, wait = 150) {
  const p = current;
  if (p?.code !== null) return leave();
  const before = screenLines(p.term).join('\n');
  p.child.write('\x1b');
  setTimeout(() => { if (current === p && screenLines(p.term).join('\n') === before) leave(); }, wait);
}

export function closePanel() {
  const p = current;
  current = null;
  if (p?.code === null) {
    // The pty's process leads its own group: hang up on all of it, like closing a terminal window.
    try { process.kill(-p.child.pid, 'SIGHUP'); } catch { p.child.kill(); }
  }
  changed();
}

process.on('exit', closePanel);

/** The panel as the screen sees it; re-renders when the program draws. */
export function usePanel() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN(n => n + 1);
    listeners.add(f);
    return () => listeners.delete(f);
  }, []);
  return panelState();
}

/** The program's title, its screen as lines with colours, and its exit code once it ends. */
export function panelState() {
  if (!current) return null;
  const { cmd, title, code, term } = current;
  return { cmd, title, code, lines: screenLines(term) };
}

/** The program's screen in a frame: bright while the keys go to it. A note covers the last row. */
export function TerminalView({ panel, focused, width, height, note }) {
  const shown = panel.lines.slice(0, height - 2 - (note ? 1 : 0));
  return html`
    <${Box} width=${width} height=${height} flexDirection="column" borderStyle=${focused ? 'bold' : 'round'} borderColor=${focused ? 'whiteBright' : 'gray'}>
      ${shown.map((l, i) => html`<${Text} key=${i} wrap="truncate-end">${l}<//>`)}
      ${note && html`<${Text} color="yellow" bold wrap="truncate-end">${note}<//>`}
    <//>`;
}

export function keyBytes(input, key) {
  if (key.upArrow) return '\x1b[A';
  if (key.downArrow) return '\x1b[B';
  if (key.rightArrow) return '\x1b[C';
  if (key.leftArrow) return '\x1b[D';
  if (key.pageUp) return '\x1b[5~';
  if (key.pageDown) return '\x1b[6~';
  if (key.home) return '\x1b[H';
  if (key.end) return '\x1b[F';
  if (key.return) return '\r';
  if (key.escape) return '\x1b';
  if (key.tab) return key.shift ? '\x1b[Z' : '\t';
  // A Mac's backspace key arrives as "delete".
  if (key.backspace || key.delete) return '\x7f';
  if (key.ctrl && /^[a-z]$/i.test(input)) return String.fromCharCode(input.toLowerCase().charCodeAt(0) - 96);
  return key.meta ? '\x1b' + input : input;
}

/** Each row of the terminal as text with ANSI colours, which Ink draws as they are. */
function screenLines(term) {
  const buf = term.buffer.active;
  const cell = buf.getNullCell();
  const lines = [];
  for (let y = 0; y < term.rows; y++) {
    const line = buf.getLine(buf.viewportY + y);
    let s = '', sgr = '';
    for (let x = 0; line && x < term.cols; x++) {
      line.getCell(x, cell);
      if (cell.getWidth() === 0) continue; // the second half of a wide character
      const next = style(cell);
      if (next !== sgr) { s += `\x1b[0${next}m`; sgr = next; }
      s += cell.getChars() || ' ';
    }
    lines.push(sgr ? s + '\x1b[0m' : s);
  }
  return lines;
}

function style(c) {
  let s = '';
  if (c.isBold()) s += ';1';
  if (c.isDim()) s += ';2';
  if (c.isItalic()) s += ';3';
  if (c.isUnderline()) s += ';4';
  if (c.isInverse()) s += ';7';
  return s + color(c.isFgPalette(), c.isFgRGB(), c.getFgColor(), 30) + color(c.isBgPalette(), c.isBgRGB(), c.getBgColor(), 40);
}

function color(palette, rgb, v, base) {
  if (palette) return v < 8 ? `;${base + v}` : v < 16 ? `;${base + 60 + v - 8}` : `;${base + 8};5;${v}`;
  if (rgb) return `;${base + 8};2;${(v >> 16) & 255};${(v >> 8) & 255};${v & 255}`;
  return '';
}

// npm drops the execute bit from node-pty's prebuilt helper, and then every spawn fails.
function executableHelper() {
  const helper = path.join(path.dirname(require.resolve('node-pty/package.json')), 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper');
  try { if (!(fs.statSync(helper).mode & 0o111)) fs.chmodSync(helper, 0o755); } catch {}
}
