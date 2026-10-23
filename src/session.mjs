// One conversation between a kid and Claude, without any UI. The UI (or the
// headless runner) listens to events and calls answer() / say().
//
// Events: {type: 'speak', text, step?, kind?} | {type: 'ask', question, choices} | {type: 'plan', summary, steps}
//   | {type: 'quiz', question, choices, answer, explain} | {type: 'approved'}
//   | {type: 'activity', emoji, text} | {type: 'done', summary, name, pictures}
//   | {type: 'file', action: 'read'|'write'|'edit'|'draw', file, isNew?, content?} | {type: 'files', files: [{file, isNew}]}
//   | {type: 'turn', cost} | {type: 'blocked', why} | {type: 'error', message}

import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { check } from './guard.mjs';
import { fill } from './config.mjs';
import { systemPrompt, firstMessage } from './prompt.mjs';
import { changedPictures, writePixels } from './pictures.mjs';
import { changedFiles } from './files.mjs';

// A spoken yes to the plan: at least one yes word, and nothing but agreeing words around it,
// so "Ja, det lyder helt perfekt. Tak." unlocks the files and "ja, men gør den blå" does not.
const YES_WORDS = /^(yes|yeah|yep|yup|ok|okay|sure|go|good|great|perfect|awesome|ja|jo|jep|jeps|jamen|jaa+|kør|gør|godt|fint|fedt|super|perfekt)$/;
const AGREEING = new Set(`
  please thanks thank you that that's thats it it's is sounds sound nice cool fine right correct exactly
  absolutely totally really very so just do let's lets ahead all
  tak det lyder helt meget rigtig rigtigt præcis bare sejt mega vildt så er lav du skal gå i gang
`.split(/\s+/).filter(Boolean));
export function isYes(s) {
  const words = s.toLowerCase().match(/[\p{L}']+/gu) ?? [];
  return words.some(w => YES_WORDS.test(w)) && words.every(w => YES_WORDS.test(w) || AGREEING.has(w));
}

export function createSession({ cwd, config, onEvent }) {
  const startedAt = Date.now();
  let planApproved = false;
  let waiting = null; // resolves with the kid's next answer while a tool is waiting
  const inbox = []; // things the kid said while Claude was not asking
  let wake = null;
  let closed = false;
  let q = null;

  const emit = e => onEvent?.(e);
  const textResult = text => ({ content: [{ type: 'text', text }] });
  const nextAnswer = () => new Promise(resolve => { waiting = resolve; });

  const kidex = createSdkMcpServer({
    name: 'kidex',
    version: '0.1.0',
    tools: [
      tool('ask_kid', 'Ask the child a short question, read aloud. Offer 2-4 short choices (emoji first) when you can. Returns what they answered.', {
        question: z.string(),
        choices: z.array(z.string()).max(4).optional(),
      }, async ({ question, choices }) => {
        emit({ type: 'ask', question, choices: choices ?? [] });
        return textResult(`The kid answered: "${await nextAnswer()}"`);
      }),
      tool('show_plan', 'Tell the child, in 1-3 short sentences, what you will build, and ask if that is right. Files and commands stay locked until they say yes. steps: the 2-5 big steps you will take, shown as a checklist that ticks off while you work.', {
        summary: z.string(),
        steps: z.array(z.object({ emoji: z.string(), text: z.string().describe('2-5 kid words, like "Draw the sword"') })).min(2).max(5).optional(),
      }, async ({ summary, steps }) => {
        emit({ type: 'plan', summary, steps: steps ?? [] });
        const answer = await nextAnswer();
        if (answer === '👍' || isYes(answer)) {
          planApproved = true;
          makeBranch();
          emit({ type: 'approved' });
          return textResult('The kid said YES. Build it now. Use tell_kid at each big step, with step set to the step you start. While you work, quiz_kid now and then gives them something to think about.');
        }
        if (answer === '👎') return textResult('The kid said NO. Ask them (ask_kid) what they want instead, then show_plan again.');
        return textResult(`The kid did not say yes; they said: "${answer}". Adjust the plan to that and call show_plan again.`);
      }),
      tool('tell_kid', 'Tell the child one short sentence about what you are doing now. Read aloud. Does not wait for an answer.', {
        text: z.string(),
        step: z.number().int().min(1).optional().describe('The plan step (1 = first) you are starting now; earlier steps get a tick'),
        kind: z.enum(['bug', 'fixed']).optional().describe('"bug" when a test found a problem, "fixed" when you fixed it'),
      }, async ({ text, step, kind }) => {
        emit({ type: 'speak', text, step, kind });
        return textResult('Told them.');
      }),
      tool('quiz_kid', 'While you work, give the child a small fun question about what you are doing (how code, pictures, or games work), with 2-3 choices. It does not wait: they answer on screen and see the explanation, and you keep working. At most one at a time, and not right after another.', {
        question: z.string(),
        choices: z.array(z.string()).min(2).max(3),
        answer: z.number().int().min(0).describe('Index of the right choice (0 = first)'),
        explain: z.string().describe('One short sentence, shown after they answer'),
      }, async ({ question, choices, answer, explain }) => {
        emit({ type: 'quiz', question, choices, answer: Math.min(answer, choices.length - 1), explain });
        return textResult('Shown. Keep working; do not wait for their answer.');
      }),
      tool('draw_picture', 'Write a PNG picture (pixel art) without running a script. rows: one string per pixel row, one character per pixel; each character is a key of palette ("." or any key missing from palette is see-through). Use the size the project needs (e.g. 16x16).', {
        file: z.string().describe('Path of the .png to write, inside the project'),
        palette: z.record(z.string().length(1), z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/)),
        rows: z.array(z.string()).min(1).max(256),
      }, async ({ file, palette, rows }) => {
        const ok = check({ tool: 'Write', input: { file_path: file }, cwd, planApproved, deny: config.deny });
        if (!ok.ok) return { ...textResult(ok.why), isError: true };
        if (!file.toLowerCase().endsWith('.png')) return { ...textResult('The file must end in .png'), isError: true };
        const width = Math.max(...rows.map(r => [...r].length));
        const isNew = !fs.existsSync(path.resolve(cwd, file));
        const abs = writePixels(path.resolve(cwd, file), rows, palette);
        emit({ type: 'file', action: 'draw', file: path.relative(cwd, abs), isNew });
        emit({ type: 'activity', emoji: '🎨', text: path.basename(abs) });
        emit({ type: 'picture', file: abs });
        return textResult(`Wrote ${file} (${width}x${rows.length}).`);
      }),
      tool('all_done', 'Finish: tell the child what you made and how to try it, in 1-3 short sentences. name: what you made, in 1-4 words, for the celebration.', {
        summary: z.string(),
        name: z.string().optional(),
      }, async ({ summary, name }) => {
        commit(summary);
        emit({ type: 'done', summary, name, pictures: changedPictures(cwd, startedAt) });
        return textResult('Told them. Now stop and wait; they may ask for changes.');
      }),
    ],
  });

  const guard = async input => {
    const r = check({
      tool: input.tool_name, input: input.tool_input ?? {}, cwd, planApproved,
      allow: config.allow, deny: config.deny,
    });
    if (!r.ok) emit({ type: 'blocked', why: r.why, tool: input.tool_name });
    else {
      showActivity(input.tool_name, input.tool_input ?? {});
      showFile(input.tool_name, input.tool_input ?? {});
    }
    return { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: r.ok ? 'allow' : 'deny', permissionDecisionReason: r.ok ? undefined : r.why } };
  };

  function showActivity(name, input) {
    const file = String(input.file_path ?? input.path ?? '').split('/').pop();
    const cmd = String(input.command ?? '');
    const checkCmd = config.check?.split('{')[0].trim();
    const a =
      name === 'Read' || name === 'Grep' || name === 'Glob' ? { emoji: '🔍', text: file || 'looking around' }
      : name === 'Write' ? { emoji: '🧱', text: file || 'making something' }
      : name === 'Edit' || name === 'MultiEdit' ? { emoji: '🔨', text: file || 'changing something' }
      : name === 'Bash' && checkCmd && cmd.includes(checkCmd) ? { emoji: '🧪', text: 'testing' }
      : name === 'Bash' ? { emoji: '⚙️', text: cmd.split(' ').slice(0, 3).join(' ') }
      : name === 'Agent' || name === 'Task' ? { emoji: '🤝', text: 'getting a helper' }
      : null;
    if (a) emit({ type: 'activity', ...a });
  }

  // For the files panel: what Claude reads and writes, and what commands made.
  function showFile(name, input) {
    const abs = input.file_path ?? input.notebook_path;
    if (!abs) return;
    const file = path.relative(cwd, path.resolve(cwd, abs));
    if (name === 'Read') emit({ type: 'file', action: 'read', file });
    else if (name === 'Write') emit({ type: 'file', action: 'write', file, isNew: !fs.existsSync(path.resolve(cwd, abs)), content: input.content });
    else if (name === 'Edit' || name === 'MultiEdit') emit({ type: 'file', action: 'edit', file, isNew: false, content: input.new_string ?? input.edits?.[0]?.new_string });
  }

  const afterCommand = async input => {
    if (input.tool_name === 'Bash') {
      const files = changedFiles(cwd, startedAt).map(f => ({ file: path.relative(cwd, f.file), isNew: f.isNew }));
      if (files.length) emit({ type: 'files', files });
    }
    return {};
  };

  function makeBranch() {
    if (!config.git.branch) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
    const branch = fill(config.git.branch, { date: stamp });
    const current = spawnSync('git', ['branch', '--show-current'], { cwd, encoding: 'utf8' }).stdout.trim();
    const prefix = config.git.branch.split('{')[0];
    if (prefix && current.startsWith(prefix)) return; // a change on top of this session's work
    spawnSync('git', ['switch', '-c', branch], { cwd });
  }

  function commit(summary) {
    if (!config.git.commit) return;
    spawnSync('git', ['add', '-A'], { cwd });
    spawnSync('git', ['commit', '-q', '-m', `Kidex: ${summary}`.slice(0, 200)], { cwd });
  }

  async function* prompts() {
    while (!closed) {
      while (inbox.length) {
        yield { type: 'user', message: { role: 'user', content: inbox.shift() }, parent_tool_use_id: null };
      }
      await new Promise(resolve => { wake = resolve; });
    }
  }

  function send(text) {
    inbox.push(text);
    wake?.();
  }

  async function run() {
    q = query({
      prompt: prompts(),
      options: {
        cwd,
        model: config.model,
        effort: config.effort,
        maxBudgetUsd: config.budgetUsd,
        settingSources: ['project'],
        systemPrompt: { type: 'preset', preset: 'claude_code', append: systemPrompt(config) },
        mcpServers: { kidex },
        disallowedTools: ['WebFetch', 'WebSearch', 'AskUserQuestion', 'EnterPlanMode', 'ExitPlanMode', 'Skill', 'SlashCommand'],
        hooks: { PreToolUse: [{ hooks: [guard] }], PostToolUse: [{ hooks: [afterCommand] }] },
        canUseTool: async (name) => ({ behavior: 'deny', message: `${name} is not available in Kidex.` }),
        stderr: () => {},
      },
    });
    try {
      for await (const m of q) {
        if (m.type === 'result') {
          if (m.subtype === 'error_max_budget_usd') emit({ type: 'error', message: `Kidex used up its budget ($${config.budgetUsd}) for this time.` });
          else if (m.is_error) emit({ type: 'error', message: m.subtype === 'success' ? String(m.result ?? 'Something went wrong.') : m.subtype });
          emit({ type: 'turn', cost: m.total_cost_usd });
        }
      }
    } catch (e) {
      if (!closed) emit({ type: 'error', message: e.message });
    }
  }

  return {
    get planApproved() { return planApproved; },
    /** Start with what the kid picked and said first. */
    start({ action, pick, words, lang }) {
      send(firstMessage({ action, pick, words, lang }));
      run();
    },
    /** Something the kid said or picked. Goes to the waiting question, or starts a new turn. */
    answer(text) {
      if (waiting) {
        const w = waiting;
        waiting = null;
        w(text);
      } else {
        send(`The kid said: "${text}"`);
      }
    },
    get isWaiting() { return Boolean(waiting); },
    async stop() {
      closed = true;
      wake?.();
      waiting?.('(The kid stopped Kidex.)');
      try { await q?.interrupt(); } catch {}
      q?.close?.();
    },
  };
}
