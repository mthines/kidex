// What Claude is doing with files, said simply, for the panel kids watch while
// it builds: which files are new or changed, and what kind of file each is.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.cache']);

/**
 * Files under cwd changed since `since` (ms), newest first. In a git repo
 * this asks git, so ignored files (like a game server's live world) never show.
 */
export function changedFiles(cwd, since, { filter = () => true, max = 40, depth = 7 } = {}) {
  const git = spawnSync('git', ['status', '--porcelain', '-uall', '-z', '.'], { cwd, encoding: 'utf8' });
  if (git.status === 0) {
    const top = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).stdout.trim();
    return git.stdout.split('\0').filter(Boolean)
      .map(line => ({ file: path.join(top, line.slice(3)), isNew: line.startsWith('??') || line.startsWith('A') }))
      .filter(f => filter(f.file) && fs.existsSync(f.file))
      .map(f => ({ ...f, t: fs.statSync(f.file).mtimeMs }))
      .filter(f => f.t >= since)
      .sort((a, b) => b.t - a.t)
      .slice(0, max);
  }
  const found = [];
  const walk = (dir, d) => {
    if (d > depth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name) || e.name.startsWith('.')) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, d + 1);
      else if (filter(p)) {
        const s = fs.statSync(p);
        if (s.mtimeMs >= since) found.push({ file: p, t: s.mtimeMs, isNew: s.birthtimeMs >= since });
      }
    }
  };
  walk(cwd, 0);
  return found.sort((a, b) => b.t - a.t).slice(0, max);
}

const KINDS = [
  { test: f => /(^|\/)(tests?|e2e|spec)\/|\.(test|spec)\.\w+$|e2e\.js$/.test(f), icon: '🧪', en: 'A test: a robot tries it to check that it works', da: 'En test: en robot prøver det af, så vi ved det virker' },
  { test: f => /\.(js|mjs|cjs|ts|py|lua)$/.test(f), icon: '📜', en: 'Code: tells the computer what to do, step by step', da: 'Kode: fortæller computeren hvad den skal gøre, trin for trin' },
  { test: f => /manifest\.json$/.test(f), icon: '🪪', en: "An ID card: the pack's name and number", da: 'Et ID-kort: pakkens navn og nummer' },
  { test: f => /\.json$/.test(f), icon: '📋', en: 'Settings: names and numbers, no steps', da: 'Indstillinger: navne og tal, ingen trin' },
  { test: f => /\.(png|jpe?g|gif|svg)$/.test(f), icon: '🎨', en: 'A picture', da: 'Et billede' },
  { test: f => /\.html?$/.test(f), icon: '🌐', en: 'A web page: what you see in the browser', da: 'En webside: det du ser i browseren' },
  { test: f => /\.css$/.test(f), icon: '💅', en: 'Style: colours, sizes, and where things go', da: 'Udseende: farver, størrelser og hvor tingene står' },
  { test: f => /\.(md|txt)$/.test(f), icon: '📝', en: 'Notes for people to read', da: 'Noter som mennesker kan læse' },
  { test: f => /\.(mcfunction)$/.test(f), icon: '⌨️', en: 'Commands, one per line', da: 'Kommandoer, én per linje' },
];

/**
 * Icon and kid-sized explanation of a file. A project can explain its own
 * files in kidex.json: "explain": {"kit.json": {"en": "...", "da": "..."}}
 * (keys are file names or folder paths that the file's path ends with or contains).
 */
export function describe(file, lang, explain = {}) {
  const posix = file.split(path.sep).join('/');
  const kind = KINDS.find(k => k.test(posix)) ?? { icon: '📄', en: 'A file', da: 'En fil' };
  const own = Object.entries(explain).find(([k]) => posix.endsWith(k) || posix.includes(k.endsWith('/') ? k : k + '/'));
  const text = own ? (typeof own[1] === 'string' ? own[1] : own[1][lang] ?? own[1].en) : kind[lang] ?? kind.en;
  return { icon: kind.icon, text };
}

// Lines every file of its kind starts with: they teach nothing, so the peek skips them.
const BOILERPLATE = /^\s*(<!doctype|<\/?html|<\/?head|<meta|<link|<\/?body>|<title|"format_version"|import\s|export\s*\{|[{}[\],]+\s*$|"use strict")/i;

/** A few lines of what was written, past the boilerplate, for a peek at real code. Not for pictures. */
export function peek(content, { lines = 5, width = 34 } = {}) {
  if (typeof content !== 'string' || !content.trim()) return [];
  const all = content.split('\n').filter(l => l.trim());
  const start = all.findIndex(l => !BOILERPLATE.test(l));
  return all.slice(Math.max(0, start), Math.max(0, start) + lines).map(l => {
    const t = l.replace(/\t/g, '  ');
    return t.length > width ? t.slice(0, width - 1) + '…' : t;
  });
}
