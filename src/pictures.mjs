// Show the pictures Claude made, right in the terminal: two pixels per
// character with the "▀" half block and true colour.

import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);

/** PNG files under cwd changed since `since` (ms), newest first. */
export function changedPictures(cwd, since, { max = 4, depth = 7 } = {}) {
  const found = [];
  const walk = (dir, d) => {
    if (d > depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, d + 1);
      else if (e.name.toLowerCase().endsWith('.png')) {
        const t = fs.statSync(p).mtimeMs;
        if (t >= since) found.push({ file: p, t });
      }
    }
  };
  walk(cwd, 0);
  return found.sort((a, b) => b.t - a.t).slice(0, max).map(f => f.file);
}

/** Lines of ANSI text drawing the image, at most `width` characters wide. */
export function render(file, { width = 32 } = {}) {
  const png = PNG.sync.read(fs.readFileSync(file));
  const scale = Math.max(1, Math.ceil(png.width / width));
  // Small pixel art (16×16) gets blown up so it is not tiny.
  const grow = png.width <= width / 2 ? Math.floor(width / png.width) : 1;
  const w = Math.floor(png.width / scale) * grow;
  const h = Math.floor(png.height / scale) * grow;
  const px = (x, y) => {
    const sx = Math.floor(x / grow) * scale, sy = Math.floor(y / grow) * scale;
    const i = (sy * png.width + sx) * 4;
    return [png.data[i], png.data[i + 1], png.data[i + 2], png.data[i + 3]];
  };
  const lines = [];
  for (let y = 0; y < h; y += 2) {
    let line = '';
    for (let x = 0; x < w; x++) {
      const top = px(x, y), bottom = y + 1 < h ? px(x, y + 1) : [0, 0, 0, 0];
      const tOn = top[3] > 64, bOn = bottom[3] > 64;
      if (!tOn && !bOn) line += '\x1b[0m ';
      else if (tOn && !bOn) line += `\x1b[0m\x1b[38;2;${top[0]};${top[1]};${top[2]}m▀`;
      else if (!tOn && bOn) line += `\x1b[0m\x1b[38;2;${bottom[0]};${bottom[1]};${bottom[2]}m▄`;
      else line += `\x1b[38;2;${top[0]};${top[1]};${top[2]};48;2;${bottom[0]};${bottom[1]};${bottom[2]}m▀`;
    }
    lines.push(line + '\x1b[0m');
  }
  return lines;
}
