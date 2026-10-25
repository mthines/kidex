// Decides which tool calls Claude may make while a kid is driving.
// It runs as a PreToolUse hook, so it applies even when the project's own
// Claude settings would allow more.

import path from 'node:path';

const ALWAYS = new Set(['TodoWrite', 'ToolSearch', 'Agent', 'Task', 'TaskOutput']);
const READS = new Set(['Read', 'Glob', 'Grep', 'LS', 'NotebookRead']);
const WRITES = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

// Commands that only look at things. Allowed before the plan is approved too.
const LOOK = [
  'ls', 'cat', 'head', 'tail', 'wc', 'pwd', 'find', 'grep', 'rg', 'tree', 'file', 'stat', 'echo',
  'sort', 'cut', 'tr', 'basename', 'dirname', 'diff', 'du', 'true',
  'git status', 'git diff', 'git log', 'git show', 'git ls-files', 'node --check', 'jq',
];

// Never, whatever the project allows.
const NEVER = ['sudo', 'git push', 'git reset', 'git checkout', 'git switch', 'git commit', 'git rebase',
  'git clean', 'git stash', 'rm -rf /', 'curl', 'wget', 'ssh', 'scp', 'npm publish', 'brew', 'launchctl',
  'osascript', 'docker', 'colima', 'kill', 'pkill'];
const NEVER_PATHS = ['.env', '.mcp.json', '.git/', '.ssh', 'id_rsa', '.npmrc', '.claude/'];

/**
 * now: commands allowed before the plan is approved too, like giving the kid something in the game.
 * @param {{tool: string, input: any, cwd: string, planApproved: boolean, allow?: string[], now?: string[], deny?: string[]}} call
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export function check({ tool, input = {}, cwd, planApproved, allow = [], now = [], deny = [] }) {
  if (tool.startsWith('mcp__kidex__')) return yes();
  if (ALWAYS.has(tool)) return yes();

  const denyPaths = [...NEVER_PATHS, ...deny.filter(d => !d.includes(' '))];

  if (READS.has(tool)) {
    const p = input.file_path ?? input.path ?? input.notebook_path;
    return p ? pathOk(p, cwd, denyPaths) : yes();
  }

  if (WRITES.has(tool)) {
    if (!planApproved) return no('Ask the kid first: call show_plan and wait for a yes before changing files.');
    return pathOk(input.file_path ?? input.notebook_path, cwd, denyPaths);
  }

  if (tool === 'Bash') return bashOk(String(input.command ?? ''), { cwd, planApproved, allow, now, deny, denyPaths });

  return no(`${tool} is not available in Kidex.`);
}

function bashOk(command, { cwd, planApproved, allow, now, deny, denyPaths }) {
  if (/\$\(|`/.test(command)) return no('No $( ) or backticks in Kidex: run plain commands.');
  const never = [...NEVER, ...deny.filter(d => d.includes(' ') || !d.includes('/'))];
  for (const bad of never) {
    if (hasWord(command, bad)) return no(`"${bad}" is not allowed in Kidex.`);
  }
  // The project's own path doesn't count: a project in "mods.git/main" must not look like ".git/".
  const outsideProject = command.split(cwd).join('.');
  for (const p of denyPaths) {
    if (outsideProject.includes(p)) return no(`Kidex keeps away from ${p}.`);
  }

  const parsed = parse(command);
  if (parsed.error) return no(parsed.error);
  for (const r of parsed.redirects) {
    if (r.op.startsWith('>') && r.target !== '/dev/null') return no('Write files with the Write tool, not with > in a command.');
    if (r.op === '<') { const ok = pathOk(r.target, cwd, denyPaths); if (!ok.ok) return ok; }
  }

  for (const words of parsed.segments) {
    // Paths outside the project are off limits for every command.
    for (const w of words) {
      if (w === '/dev/null') continue;
      if (/^[/~]/.test(w) || w.split('/').includes('..')) {
        const ok = pathOk(w.replace(/^~/, process.env.HOME ?? '~'), cwd, denyPaths);
        if (!ok.ok) return ok;
      }
    }
    const part = words.join(' ');
    if (words[0] === 'cd') {
      // Paths are checked from the project folder, so commands must run there too.
      if (words.length < 2 || path.resolve(cwd, words[1]) !== cwd) { // a bare cd goes home
        return no(`Run commands from the project folder (cd ${cwd}), with paths like addons/x/file, instead of cd into folders.`);
      }
      continue;
    }
    if (startsWithAny(part, LOOK)) {
      const flags = SNEAKY_FLAGS[words[0]] ?? [];
      const sneaky = words.find(w => flags.some(f => w === f || w.startsWith(f + '=')));
      if (sneaky) return no(`${words[0]} ${sneaky} is not allowed in Kidex.`);
      continue;
    }
    // A line break in a word would sneak a second command into a program that reads one per line, like a game console.
    if (words.some(w => /[\r\n]/.test(w))) return no('One command per line: no line breaks inside a command.');
    if (startsWithAny(part, now)) continue;
    if (!planApproved) return no('Ask the kid first: call show_plan and wait for a yes before running commands.');
    if (startsWithAny(part, allow)) continue;
    return no(`Kidex may only run: ${[...allow, ...now, ...LOOK].join(', ')}. Run one simple command at a time (no loops).`);
  }
  return yes();
}

// Flags that make a look-only command change or run things.
const SNEAKY_FLAGS = {
  find: ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fprint', '-fprint0', '-fprintf', '-fls'],
  rg: ['--pre'],
  sort: ['-o', '--output'],
  git: ['--output'],
};

/**
 * Splits a shell command into its simple commands (lists of words, quotes
 * removed) and its redirects. Quotes and backslashes are respected, so
 * `grep "a\|b"` is one command.
 */
export function parse(command) {
  const segments = [];
  const redirects = [];
  let words = [];
  let word = '';
  let inWord = false;
  const endWord = () => { if (inWord) words.push(word); word = ''; inWord = false; };
  const endSegment = () => { endWord(); if (words.length) segments.push(words); words = []; };

  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'") {
      const j = command.indexOf("'", i + 1);
      if (j < 0) return { error: 'A quote is not closed.' };
      word += command.slice(i + 1, j); inWord = true; i = j;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < command.length && command[j] !== '"'; j++) {
        if (command[j] === '\\' && '"\\$`'.includes(command[j + 1])) j++;
        word += command[j];
      }
      if (j >= command.length) return { error: 'A quote is not closed.' };
      inWord = true; i = j;
    } else if (c === '\\') {
      word += command[i + 1] ?? ''; inWord = true; i++;
    } else if (c === ' ' || c === '\t') {
      endWord();
    } else if ('&|;\n'.includes(c)) {
      if (c === '&' && command[i + 1] === '>') return { error: 'Write files with the Write tool, not with > in a command.' };
      endSegment();
      if ((c === '&' || c === '|') && command[i + 1] === c) i++;
    } else if (c === '>' || c === '<') {
      if (/^\d+$/.test(word)) { word = ''; inWord = false; } else endWord(); // "2>" belongs to the redirect
      let op = c;
      if (command[i + 1] === '>' || command[i + 1] === '&') op += command[++i];
      while (command[i + 1] === ' ') i++;
      let target = '';
      while (i + 1 < command.length && !' \t&|;\n<>'.includes(command[i + 1])) target += command[++i];
      if (op.endsWith('&')) continue; // 2>&1: pointing one output at another
      if (c === '>' && op === '>&') continue;
      redirects.push({ op, target });
    } else if (c === '(' || c === ')' || c === '{' && !inWord) {
      return { error: 'Run one simple command at a time (no ( ) groups or loops).' };
    } else {
      word += c; inWord = true;
    }
  }
  endSegment();
  // Shell keywords mean loops and ifs, which we don't try to understand.
  if (segments.some(s => ['for', 'while', 'until', 'if', 'do', 'done', 'then', 'function'].includes(s[0]))) {
    return { error: 'Run one simple command at a time (no loops or ifs).' };
  }
  return { segments, redirects };
}

function pathOk(p, cwd, denyPaths) {
  if (!p) return no('Missing a file path.');
  const abs = path.resolve(cwd, p);
  const rel = path.relative(cwd, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return no(`Stay inside ${cwd}.`);
  const posix = rel.split(path.sep).join('/');
  const parts = posix.split('/');
  for (const d of denyPaths) {
    const clean = d.replace(/\/$/, '');
    // "server/data/" blocks that folder; a bare name like ".env" blocks it at any depth.
    if (posix === clean || posix.startsWith(clean + '/') || (!clean.includes('/') && parts.includes(clean))) {
      return no(`Kidex keeps away from ${d}.`);
    }
  }
  return yes();
}

function startsWithAny(cmd, prefixes) {
  // "./mc test" allows "./mc test cake" but not "./mc tester"; "open toys/" allows any path below it.
  return prefixes.some(p => cmd === p || cmd.startsWith(/[\s/]$/.test(p) ? p : p + ' '));
}

function hasWord(cmd, phrase) {
  const esc = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[\\s;&|(])${esc}($|[\\s;&|)])`).test(cmd);
}

const yes = () => ({ ok: true });
const no = why => ({ ok: false, why });
