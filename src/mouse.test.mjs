import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import React from 'react';
import { render, Box, Text } from 'ink';
import htm from 'htm';
import { takeMouse, usePresses, PressArea, Press } from './mouse.mjs';

const html = htm.bind(React.createElement);

test('mouse reports leave the keys; only left presses count, from 0', () => {
  assert.deepEqual(takeMouse('a\x1b[<0;10;5M\x1b[<0;10;5mb'), { rest: 'ab', presses: [{ x: 9, y: 4 }] });
  assert.deepEqual(takeMouse('\x1b[<4;1;1M').presses, [{ x: 0, y: 0 }]); // with shift
  assert.deepEqual(takeMouse('\x1b[<64;10;5M\x1b[<2;3;3M\x1b[<32;3;3M').presses, []); // wheel, right button, drag
  assert.deepEqual(takeMouse('\x1b[A q'), { rest: '\x1b[A q', presses: [] });
});

test('a press runs the smallest pressable box under it', async () => {
  const pressed = [];
  let presses;
  function Screen() {
    presses = usePresses();
    return html`
      <${PressArea} presses=${presses}>
        <${Press} on=${() => pressed.push('area')} width=${40} height=${10} paddingLeft=${10} paddingTop=${2}>
          <${Press} on=${() => pressed.push('button')} width=${8} height=${3} borderStyle="round"><${Text}>Yes<//><//>
          <${Press} width=${8} height=${3}><${Text}>Off<//><//>
        <//>
      <//>`;
  }
  const stdout = Object.assign(new PassThrough(), { columns: 80, rows: 20, isTTY: false });
  stdout.resume();
  const app = render(html`<${Box}><${Screen} /><//>`, { stdout, patchConsole: false });
  await new Promise(r => setTimeout(r, 50));
  presses.press(12, 3);
  presses.press(17, 4); // the 8×3 button at 10,2 ends at column 17, row 4
  presses.press(20, 3); // the next box has no on: the area gets it
  assert.equal(presses.press(50, 3), false);
  assert.deepEqual(pressed, ['button', 'button', 'area']);
  app.unmount();
});
