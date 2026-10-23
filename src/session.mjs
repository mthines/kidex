// One conversation between a kid and Claude, without any UI. The UI (or the
// headless runner) listens to events and calls answer() / say().
//
// Events: {type: 'speak', text} | {type: 'ask', question, choices} | {type: 'plan', summary}
//   | {type: 'activity', emoji, text} | {type: 'done', summary, pictures}
//   | {type: 'turn', cost} | {type: 'blocked', why} | {type: 'error', message}

import { query, createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { spawnSync } from 'node:child_process';
import { z } from 'zod';
import { check } from './guard.mjs';
import { fill } from './config.mjs';
import { systemPrompt, firstMessage } from './prompt.mjs';
import { changedPictures } from './pictures.mjs';

const YES = /^\s*(yes|yeah|yep|yup|ok|okay|sure|do it|go|ja|jo|jep|jeps|jaaa*|okay|gør det|kør|fedt|super)\b[\s!.]*$/i;
export const isYes = s => YES.test(s);

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
      tool('show_plan', 'Tell the child, in 1-3 short sentences, what you will build, and ask if that is right. Files and commands stay locked until they say yes.', {
        summary: z.string(),
      }, async ({ summary }) => {
        emit({ type: 'plan', summary });
        const answer = await nextAnswer();
        if (answer === '👍' || isYes(answer)) {
          planApproved = true;
          makeBranch();
          return textResult('The kid said YES. Build it now. Use tell_kid at each big step.');
        }
        if (answer === '👎') return textResult('The kid said NO. Ask them (ask_kid) what they want instead, then show_plan again.');
        return textResult(`The kid did not say yes; they said: "${answer}". Adjust the plan to that and call show_plan again.`);
      }),
      tool('tell_kid', 'Tell the child one short sentence about what you are doing now. Read aloud. Does not wait for an answer.', {
        text: z.string(),
      }, async ({ text }) => {
        emit({ type: 'speak', text });
        return textResult('Told them.');
      }),
      tool('all_done', 'Finish: tell the child what you made and how to try it, in 1-3 short sentences.', {
        summary: z.string(),
      }, async ({ summary }) => {
        commit(summary);
        emit({ type: 'done', summary, pictures: changedPictures(cwd, startedAt) });
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
    else showActivity(input.tool_name, input.tool_input ?? {});
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
        hooks: { PreToolUse: [{ hooks: [guard] }] },
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
