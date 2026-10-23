// Ears and mouth: record the mic with ffmpeg, turn it into text with
// whisper.cpp, and read answers out loud with macOS `say`.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = process.env.KIDEX_HOME ?? path.join(os.homedir(), '.kidex');
export const MODEL = process.env.KIDEX_WHISPER_MODEL ?? path.join(HOME, 'models', 'ggml-small.bin');
export const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin';

const has = cmd => spawnSync('sh', ['-c', `command -v ${cmd}`]).status === 0;
const whisperBin = () => ['whisper-cli', 'whisper-cpp'].find(has);

/** What works on this machine, for `kidex doctor` and for picking typing over talking. */
export function abilities() {
  return {
    record: has('ffmpeg'),
    transcribe: Boolean(whisperBin()) && fs.existsSync(MODEL),
    whisper: whisperBin() ?? null,
    model: fs.existsSync(MODEL),
    speak: has('say'),
  };
}

/** Start recording. Call stop() on the result to get the wav file. */
export function startRecording() {
  const file = path.join(os.tmpdir(), `kidex-${process.pid}-${Date.now()}.wav`);
  const mic = process.env.KIDEX_MIC ?? ':default';
  const ff = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'avfoundation', '-i', mic, '-ac', '1', '-ar', '16000', file], { stdio: ['pipe', 'ignore', 'pipe'] });
  let err = '';
  ff.stderr.on('data', d => { err += d; });
  const done = new Promise(resolve => ff.on('close', resolve));
  return {
    file,
    async stop() {
      ff.stdin.write('q'); // ffmpeg finishes the file cleanly on "q"
      ff.stdin.end();
      const t = setTimeout(() => ff.kill('SIGINT'), 2000);
      await done;
      clearTimeout(t);
      if (!fs.existsSync(file) || fs.statSync(file).size < 1000) {
        throw new Error(`The microphone did not record anything. ${err.trim()}`);
      }
      return file;
    },
    cancel() { ff.kill('SIGKILL'); fs.rmSync(file, { force: true }); },
  };
}

/** wav → text. lang: "da", "en" or "auto". */
export function transcribe(file, lang = 'auto') {
  const bin = whisperBin();
  if (!bin) return Promise.reject(new Error('whisper.cpp is missing: brew install whisper-cpp'));
  return new Promise((resolve, reject) => {
    const args = ['-m', MODEL, '-l', lang, '-nt', '-np', '-f', file];
    const p = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => {
      fs.rmSync(file, { force: true });
      if (code !== 0) return reject(new Error(`whisper failed: ${err.trim().split('\n').pop()}`));
      resolve(cleanTranscript(out));
    });
  });
}

/** Whisper marks silence and noise like "[BLANK_AUDIO]" or "(music)". */
export function cleanTranscript(s) {
  return s.replace(/\[[^\]]*\]|\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
}

let speaking = null;

/** Read text out loud. A new line cuts off the one before. */
export function speak(line, { lang = 'en', voices = {}, rate } = {}) {
  hush();
  const clean = stripForSpeech(line);
  if (!clean || !has('say')) return Promise.resolve();
  const args = [];
  const voice = voices[lang];
  if (voice) args.push('-v', voice);
  if (rate) args.push('-r', String(rate));
  args.push(clean);
  const p = spawn('say', args, { stdio: 'ignore' });
  speaking = p;
  return new Promise(resolve => p.on('close', () => { if (speaking === p) speaking = null; resolve(); }));
}

export function hush() {
  if (speaking) speaking.kill();
  speaking = null;
}

/** Emojis and markdown sound silly when read aloud. */
export function stripForSpeech(s) {
  return String(s ?? '')
    .replace(/[`*_#>]/g, '')
    .replace(/\p{Extended_Pictographic}|️|‍/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Very small guess at the language of a sentence, to pick the voice. */
export function guessLang(s, fallback = 'en') {
  if (/[æøå]/i.test(s)) return 'da';
  const da = (s.toLowerCase().match(/\b(jeg|du|det|og|er|en|et|skal|vil|kan|ikke|hvad|lav|med|til|på)\b/g) ?? []).length;
  const en = (s.toLowerCase().match(/\b(i|you|the|and|is|a|an|will|can|not|what|make|with|to|on)\b/g) ?? []).length;
  if (da > en) return 'da';
  if (en > da) return 'en';
  return fallback;
}
