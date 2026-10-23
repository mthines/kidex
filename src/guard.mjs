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
  'git status', 'git diff', 'git log', 'git show', 'node --check', 'jq',
];

// Never, whatever the project allows.
const NEVER = ['sudo', 'git push', 'git reset', 'git checkout', 'git switch', 'git commit', 'git rebase',
  'git clean', 'git stash', 'rm -rf /', 'curl', 'wget', 'ssh', 'scp', 'npm publish', 'brew', 'launchctl',
  'osascript', 'docker', 'colima', 'kill', 'pkill'];
const NEVER_PATHS = ['.env', '.mcp.json', '.git/', '.ssh', 'id_rsa', '.npmrc', '.claude/'];

/**
 * @param {{tool: string, input: any, cwd: string, planApproved: boolean, allow?: string[], deny?: string[]}} call
 * @returns {{ok: true} | {ok: false, why: string}}
 */
export function check({ tool, input = {}, cwd, planApproved, allow = [], deny = [] }) {
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

  if (tool === 'Bash') return bashOk(String(input.command ?? ''), { cwd, planApproved, allow, deny, denyPaths });

  return no(`${tool} is not available in Kidex.`);
}

function bashOk(command, { cwd, planApproved, allow, deny, denyPaths }) {
  if (/\$\(|`/.test(command)) return no('No $( ) or backticks in Kidex: run plain commands.');
  const never = [...NEVER, ...deny.filter(d => d.includes(' ') || !d.includes('/'))];
  for (const bad of never) {
    if (hasWord(command, bad)) return no(`"${bad}" is not allowed in Kidex.`);
  }
  for (const p of denyPaths) {
    if (command.includes(p)) return no(`Kidex keeps away from ${p}.`);
  }

  for (const raw of command.split(/&&|\|\||;|\||\n/)) {
    const part = raw.trim().replace(/\s*2>&1\s*$/, '').replace(/\s*>\s*\/dev\/null\s*$/, '').trim();
    if (!part) continue;
    if (/(^|\s)\d*>{1,2}/.test(part)) return no('Write files with the Write tool, not with > in a command.');
    if (/^cd(\s|$)/.test(part)) {
      const to = part.slice(2).trim() || '.';
      const ok = pathOk(to, cwd, denyPaths);
      if (!ok.ok) return ok;
      continue;
    }
    if (startsWithAny(part, LOOK)) continue;
    if (!planApproved) return no('Ask the kid first: call show_plan and wait for a yes before running commands.');
    if (startsWithAny(part, allow)) continue;
    return no(`Kidex may only run: ${[...allow, ...LOOK].join(', ')}.`);
  }
  return yes();
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
