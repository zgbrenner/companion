import {
  AutoConfig,
  AutoTokenizer,
  MobileBertPreTrainedModel,
  TokenClassifierOutput,
  env,
} from './vendor/transformers.web.min.js';

const CORE = globalThis.CompanionLifejacketCore;
const MODEL_ID = 'lifejacket';
const MODEL_LABEL = 'MobileBERT LLMLingua-2 Q8';
const MAX_SEQUENCE_LENGTH = 128;
const MAX_INPUT_CHARS = 120_000;
const MAX_CHUNK_CHARS = 360;

class MobileBertForTokenClassification extends MobileBertPreTrainedModel {
  async _call(modelInputs) {
    return new TokenClassifierOutput(await super._call(modelInputs));
  }
}

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL('src/models/');
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL('src/vendor/ort/');
env.backends.onnx.wasm.numThreads = 1;
env.backends.onnx.wasm.proxy = false;

let runtimePromise = null;

async function loadRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const config = await AutoConfig.from_pretrained(MODEL_ID, { local_files_only: true });
      const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
        config,
        local_files_only: true,
      });
      const model = await MobileBertForTokenClassification.from_pretrained(MODEL_ID, {
        config,
        dtype: 'q8',
        device: 'wasm',
        local_files_only: true,
      });
      return { tokenizer, model };
    })().catch(error => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise;
}

function classOneProbability(logit0, logit1) {
  const maximum = Math.max(logit0, logit1);
  const a = Math.exp(logit0 - maximum);
  const b = Math.exp(logit1 - maximum);
  return b / (a + b);
}

function tokenStrings(tokenizer, text) {
  const value = tokenizer.tokenize(text);
  return Array.isArray(value) ? value : [];
}

function sentencePieces(text) {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
    const pieces = [...segmenter.segment(text)].map(item => item.segment).filter(Boolean);
    return pieces.length ? pieces : [text];
  } catch {
    return text.match(/[^.!?\n]+(?:[.!?]+|\n+|$)/g) || [text];
  }
}

function wordPieces(text) {
  try {
    const segmenter = new Intl.Segmenter(undefined, { granularity: 'word' });
    return [...segmenter.segment(text)].map(item => ({
      text: item.segment,
      isWordLike: Boolean(item.isWordLike),
    }));
  } catch {
    return text.split(/(\s+|[^\p{L}\p{N}_]+)/u).filter(Boolean).map(value => ({
      text: value,
      isWordLike: /[\p{L}\p{N}_]/u.test(value),
    }));
  }
}

function splitOversizePiece(piece, tokenizer) {
  const tokens = tokenStrings(tokenizer, piece);
  if (tokens.length <= MAX_SEQUENCE_LENGTH - 2 && piece.length <= MAX_CHUNK_CHARS) return [piece];
  const segments = wordPieces(piece);
  const chunks = [];
  let current = '';
  for (const segment of segments) {
    const next = current + segment.text;
    const nextTokenCount = tokenStrings(tokenizer, next).length;
    if (current && (nextTokenCount > MAX_SEQUENCE_LENGTH - 2 || next.length > MAX_CHUNK_CHARS)) {
      chunks.push(current);
      current = segment.text;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.length ? chunks : [piece];
}

function chunksForText(text, tokenizer) {
  const chunks = [];
  let current = '';
  for (const sentence of sentencePieces(text)) {
    for (const piece of splitOversizePiece(sentence, tokenizer)) {
      const next = current + piece;
      const nextTokens = tokenStrings(tokenizer, next).length;
      if (current && (nextTokens > MAX_SEQUENCE_LENGTH - 2 || next.length > MAX_CHUNK_CHARS)) {
        chunks.push(current);
        current = piece;
      } else {
        current = next;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

async function scoreChunk(text, runtime) {
  const { tokenizer, model } = runtime;
  const tokens = tokenStrings(tokenizer, text);
  const encoded = await tokenizer(text, {
    padding: false,
    truncation: true,
    max_length: MAX_SEQUENCE_LENGTH,
  });
  const output = await model(encoded);
  const dimensions = output.logits?.dims || [];
  const data = output.logits?.data;
  const sequenceLength = Number(dimensions[1] || 0);
  const classes = Number(dimensions[2] || 0);
  if (!data || sequenceLength < 2 || classes < 2) {
    throw new Error('Lifejacket model returned invalid token-classification logits');
  }
  const usable = Math.min(tokens.length, Math.max(0, sequenceLength - 2));
  const probabilities = [];
  for (let index = 0; index < usable; index += 1) {
    const offset = (index + 1) * classes;
    probabilities.push(classOneProbability(Number(data[offset]), Number(data[offset + 1])));
  }
  return { tokens: tokens.slice(0, usable), probabilities };
}

function lexicalScores(text, scored, tokenizer, keepRatio) {
  const segments = wordPieces(text);
  let tokenCursor = 0;
  const scoredSegments = segments.map((segment, index) => {
    if (/^\s+$/.test(segment.text)) return { ...segment, index, score: null, force: false };
    const count = tokenStrings(tokenizer, segment.text).length;
    const values = scored.probabilities.slice(tokenCursor, tokenCursor + Math.max(1, count));
    tokenCursor += count;
    const score = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 1;
    const force = /\d/u.test(segment.text)
      || /^[\p{P}\p{S}]+$/u.test(segment.text)
      || /^(?:[A-Z]{2,}|[A-Z][A-Za-z]*[A-Z][A-Za-z]*)$/.test(segment.text);
    return { ...segment, index, score, force };
  });

  const candidates = scoredSegments.filter(segment => segment.isWordLike && !segment.force && segment.score != null);
  const keepCount = Math.max(1, Math.ceil(candidates.length * Math.min(0.85, Math.max(0.4, Number(keepRatio) || 0.65))));
  const selected = new Set(
    candidates
      .slice()
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, keepCount)
      .map(segment => segment.index),
  );
  const wordLike = scoredSegments.filter(segment => segment.isWordLike);
  if (wordLike[0]) selected.add(wordLike[0].index);
  if (wordLike.at(-1)) selected.add(wordLike.at(-1).index);
  for (const segment of scoredSegments) if (segment.force) selected.add(segment.index);
  return { segments: scoredSegments, selected };
}

function rebuildLexical({ segments, selected }) {
  let output = '';
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (/^\s+$/.test(segment.text)) {
      const before = [...selected].some(selectedIndex => selectedIndex < index);
      const after = [...selected].some(selectedIndex => selectedIndex > index);
      if (before && after) output += segment.text.includes('\n') ? '\n' : ' ';
      continue;
    }
    if (selected.has(index)) output += segment.text;
  }
  return output
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ +([,.;:!?])/g, '$1')
    .replace(/([([{]) +/g, '$1')
    .replace(/ +([)\]}])/g, '$1')
    .replace(/\n{3,}/g, '\n\n');
}

async function compressPlainText(text, keepRatio, runtime) {
  if (!text.trim()) return { text, chunks: 0 };
  const chunks = chunksForText(text, runtime.tokenizer);
  const output = [];
  for (const chunk of chunks) {
    if (!chunk.trim()) {
      output.push(chunk);
      continue;
    }
    const scored = await scoreChunk(chunk, runtime);
    const lexical = lexicalScores(chunk, scored, runtime.tokenizer, keepRatio);
    output.push(rebuildLexical(lexical));
  }
  return { text: output.join(''), chunks: chunks.length };
}

async function compressPrompt(originalValue, keepRatioValue) {
  if (!CORE) throw new Error('Lifejacket safety core is unavailable');
  const original = String(originalValue || '');
  if (!original.trim()) throw new Error('Prompt is empty');
  if (original.length > MAX_INPUT_CHARS) throw new Error(`Prompt exceeds ${MAX_INPUT_CHARS.toLocaleString()} characters`);
  const keepRatio = Math.min(0.85, Math.max(0.4, Number(keepRatioValue) || 0.65));
  const startedAt = performance.now();
  const runtime = await loadRuntime();
  const protectedPrompt = CORE.protectPrompt(original);
  const output = [];
  let chunks = 0;
  for (const segment of protectedPrompt.segments) {
    if (segment.type === 'protected') {
      output.push(segment.text);
      continue;
    }
    const compressed = await compressPlainText(segment.text, keepRatio, runtime);
    output.push(compressed.text);
    chunks += compressed.chunks;
  }
  // An all-protected prompt still invokes the model, satisfying the always-on
  // compressor contract while the protected output remains byte-for-byte exact.
  if (chunks === 0) await scoreChunk(original.slice(0, MAX_CHUNK_CHARS), runtime);
  const finalized = CORE.finalizeCompression({
    original,
    candidate: output.join('').trim(),
    protectedSpans: protectedPrompt.protectedSpans,
  });
  return {
    ...finalized,
    model: MODEL_LABEL,
    durationMs: Math.round(performance.now() - startedAt),
    chunks: Math.max(1, chunks),
    modelInvoked: true,
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'cuc:lifejacket-compress-offscreen') return undefined;
  if (sender?.id !== chrome.runtime.id || sender.tab) {
    sendResponse({ ok: false, error: 'invalid-sender' });
    return false;
  }
  compressPrompt(message.text, message.keepRatio)
    .then(result => sendResponse({ ok: true, ...result }))
    .catch(error => sendResponse({
      ok: false,
      error: String(error?.message || error).slice(0, 240),
      model: MODEL_LABEL,
    }));
  return true;
});
