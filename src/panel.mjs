// A command that keeps running beside the kid, like a project's dev server: an action
// with "panel" starts it, its output scrolls by on the right, and it stops when Kidex quits.

import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import htm from 'htm';
import { spawn } from 'node:child_process';

const html = htm.bind(React.createElement);
const KEEP = 200; // lines kept; the panel shows the newest that fit

let current = null; // {cmd, title, lines, partial, child, code, hidden}
const listeners = new Set();
const changed = () => { for (const f of listeners) f(); };

const ANSI = /\x1b\[[0-?]*[ -\/]*[@-~]|\x1b\][^\x07]*\x07/g;

/** Starts the command in the panel, or shows it again if it already runs. */
export function openPanel(cmd, { cwd, title }) {
  if (current?.cmd === cmd && current.code === null) { current.hidden = false; changed(); return; }
  closePanel();
  const child = spawn(cmd, {
    cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', FORCE_COLOR: '0' },
  });
  const p = current = { cmd, title, lines: [], partial: '', child, code: null, hidden: false };
  const add = chunk => {
    if (current !== p) return;
    const parts = (p.partial + chunk.toString().replace(ANSI, '')).split('\n');
    p.partial = parts.pop();
    // "\r" redraws a line in place (progress dots, spinners): keep what came last.
    for (const l of parts) p.lines.push(l.split('\r').filter(Boolean).pop() ?? '');
    p.lines = p.lines.slice(-KEEP);
    changed();
  };
  child.stdout.on('data', add);
  child.stderr.on('data', add);
  child.on('error', e => { p.lines.push(e.message); changed(); });
  child.on('exit', code => { p.code = code ?? 1; changed(); });
}

/** Hides or shows the panel; the command keeps running either way. */
export function togglePanel() {
  if (!current) return;
  current.hidden = !current.hidden;
  changed();
}

export function closePanel() {
  const p = current;
  current = null;
  if (p?.code === null) {
    // The whole process group: a shell command often starts its own children.
    try { process.kill(-p.child.pid, 'SIGTERM'); } catch {}
  }
  changed();
}

process.on('exit', closePanel);

/** The panel as the screen sees it; re-renders when output arrives. */
export function usePanel() {
  const [, setN] = useState(0);
  useEffect(() => {
    const f = () => setN(n => n + 1);
    listeners.add(f);
    return () => listeners.delete(f);
  }, []);
  return panelState();
}

/** The command, its output so far (with a line still being written), and its exit code once it ends. */
export function panelState() {
  if (!current) return null;
  const tail = current.partial.split('\r').filter(Boolean).pop();
  return { ...current, lines: tail ? [...current.lines, tail] : current.lines };
}

export function CommandPanel({ panel, width, height }) {
  const shown = panel.lines.slice(-Math.max(1, height - 3));
  const status = panel.code === null ? html`<${Text} color="green">●<//>` : html`<${Text} color="red">■ ${panel.code}<//>`;
  return html`
    <${Box} width=${width} height=${height} flexDirection="column" borderStyle="round" borderColor="gray" paddingX=${1} marginRight=${1}>
      <${Text} bold color="gray" wrap="truncate-end">${status} ${panel.title}<//>
      ${shown.map((l, i) => html`<${Text} key=${i} color="gray" wrap="truncate-end">${l || ' '}<//>`)}
    <//>`;
}
