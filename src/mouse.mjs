// Clicking with the mouse or trackpad: the terminal reports where a button was pressed,
// and the smallest pressable box under that spot gets the press.

import { EventEmitter } from 'node:events';
import React, { createContext, useContext, useEffect, useRef } from 'react';
import { Box } from 'ink';
import htm from 'htm';

const html = htm.bind(React.createElement);

// Report presses (1000) as ESC[<b;x;yM (1006), which works past column 223.
export const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
export const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l';

/** Takes the mouse reports out of what the terminal sent: the keys left, and each left press as {x, y} from 0. */
export function takeMouse(chunk) {
  const presses = [];
  const rest = chunk.replace(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/g, (_, b, x, y, end) => {
    // Only the left button going down, with or without shift, alt and ctrl: not releases, wheels or drags.
    if (end === 'M' && (Number(b) & ~28) === 0) presses.push({ x: Number(x) - 1, y: Number(y) - 1 });
    return '';
  });
  return { rest, presses };
}

const pressed = new EventEmitter();

/**
 * Ink throws mouse reports away before useInput sees them, so take them out of stdin first:
 * Ink reads its keys with stdin.read(), and gets them without the mouse.
 */
export function watchMouse(stdin) {
  const read = stdin.read.bind(stdin);
  stdin.read = (...args) => {
    const chunk = read(...args);
    if (typeof chunk !== 'string' || !chunk.includes('\x1b[<')) return chunk;
    const { rest, presses } = takeMouse(chunk);
    for (const p of presses) pressed.emit('press', p);
    return rest;
  };
}

/** Where a box is on the screen, from its place in the layout. */
export function bounds(node) {
  const { yogaNode } = node;
  if (!yogaNode) return null;
  let x = 0, y = 0;
  for (let n = node; n?.yogaNode; n = n.parentNode) {
    x += n.yogaNode.getComputedLeft();
    y += n.yogaNode.getComputedTop();
  }
  return { x, y, width: yogaNode.getComputedWidth(), height: yogaNode.getComputedHeight() };
}

const Presses = createContext(null);

/** Holds the screen's pressable boxes; a press runs the one there, unless on is false. */
export function usePresses(on = true) {
  const all = useRef(new Set()).current;
  const enabled = useRef(on);
  enabled.current = on;
  useEffect(() => {
    const f = ({ x, y }) => { if (enabled.current) press(x, y); };
    pressed.on('press', f);
    return () => pressed.off('press', f);
  }, []);
  function press(x, y) {
    let best = null, area = Infinity;
    for (const p of all) {
      const b = p.ref.current && bounds(p.ref.current);
      if (!b || x < b.x || y < b.y || x >= b.x + b.width || y >= b.y + b.height) continue;
      if (b.width * b.height < area) { best = p; area = b.width * b.height; }
    }
    best?.on();
    return best !== null;
  }
  return { all, press };
}

export const PressArea = ({ presses, children }) => html`<${Presses.Provider} value=${presses.all}>${children}<//>`;

/** A Box that runs on() when pressed. Without on, it is a plain Box. */
export function Press({ on, children, ...props }) {
  const all = useContext(Presses);
  const ref = useRef(null);
  const me = useRef({ ref }).current;
  me.on = on;
  useEffect(() => {
    if (!all || !on) return;
    all.add(me);
    return () => all.delete(me);
  }, [all, !on]);
  return html`<${Box} ref=${ref} ...${props}>${children}<//>`;
}
