import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'src/lifejacket-runtime.js'), 'utf8');

assert.match(source, /MAX_UNKNOWN_TOKEN_RATIO\s*=\s*0\.2/);
assert.match(source, /token\s*=>\s*token\s*===\s*['"]\[UNK\]['"]/);
assert.match(source, /scored\.unknownRatio\s*>\s*MAX_UNKNOWN_TOKEN_RATIO/);
assert.match(source, /output\.push\(chunk\)/);
assert.match(source, /lowCoverageChunks/);
assert.match(source, /kept unchanged because model language coverage was low/i);
assert.ok(
  source.indexOf('const scored = await scoreChunk(chunk, runtime)')
    < source.indexOf('scored.unknownRatio > MAX_UNKNOWN_TOKEN_RATIO'),
  'the quantized model is invoked before low-coverage text is passed through',
);
assert.doesNotMatch(source, /allowRemoteModels\s*=\s*true/);

console.log('PASS  Lifejacket invokes the model and safely passes through low-coverage text');
