const fs = require("node:fs");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");
const { abortReason } = require("./update-abort.cjs");

// Stream verification yields to cancellation and disposes the input before
// settling. Callers retain authority over mismatch cleanup and promotion.
async function sha256(filePath, { signal, createReadStream = fs.createReadStream } = {}) {
  if (signal?.aborted) throw abortReason(signal);
  const hash = crypto.createHash("sha256");
  try {
    await pipeline(createReadStream(filePath), hash, { signal });
    if (signal?.aborted) throw abortReason(signal);
    return hash.digest("hex");
  } catch (error) {
    throw signal?.aborted ? abortReason(signal) : error;
  }
}

module.exports = { sha256 };
