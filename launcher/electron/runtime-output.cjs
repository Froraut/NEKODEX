const { StringDecoder } = require('node:string_decoder');

const MAX_RUNTIME_LOG_LINE_CHARS = 64 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;

/** Decode child output once, retain bounded lines, and keep raw capture independent. */
function collectRuntimeLines(stream, onLine, onError, { onChunk, maxLineChars = MAX_RUNTIME_LOG_LINE_CHARS } = {}) {
  const decoder = new StringDecoder('utf8');
  let buffered = '', truncated = false;
  const emit = (final = false) => {
    const line = final ? buffered.trim() : buffered.trimEnd();
    if (line || truncated) onLine(line + (truncated ? '…[truncated]' : ''));
    buffered = ''; truncated = false;
  };
  const consume = text => {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf('\n', offset);
      const end = newline < 0 ? text.length : newline;
      const remaining = maxLineChars - buffered.length;
      if (end - offset > remaining) truncated = true;
      buffered += text.slice(offset, Math.min(end, offset + remaining));
      if (newline < 0) return;
      emit(); offset = newline + 1;
    }
  };
  stream.on('data', chunk => { onChunk?.(chunk); consume(decoder.write(chunk)); });
  stream.on('end', () => { consume(decoder.end()); emit(true); });
  stream.on('error', error => onError?.(error));
}

function collectCapturedRuntimeOutput(stream, chunks, onLine, onError, retainOutput = true) {
  let bytes = 0;
  collectRuntimeLines(stream, onLine, onError, { onChunk(chunk) {
    bytes += chunk.length;
    if (retainOutput && bytes <= MAX_CAPTURE_BYTES) chunks.push(chunk);
  } });
}

module.exports = { collectRuntimeLines, collectCapturedRuntimeOutput };
