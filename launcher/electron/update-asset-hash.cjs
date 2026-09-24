const fs = require("node:fs");
const crypto = require("node:crypto");
const { pipeline } = require("node:stream/promises");

// Stream verification yields to cancellation and disposes the input before
// settling. Callers retain authority over mismatch cleanup and promotion.
async function sha256(filePath, { signal, createReadStream = fs.createReadStream } = {}) {
  const abortReason = () => signal.reason instanceof Error ? signal.reason : new Error("Update preparation was cancelled");
  if (signal?.aborted) throw abortReason();
  const hash = crypto.createHash("sha256");
  try {
    await pipeline(createReadStream(filePath), hash, { signal });
    if (signal?.aborted) throw abortReason();
    return hash.digest("hex");
  } catch (error) {
    throw signal?.aborted ? abortReason() : error;
  }
}

module.exports = { sha256 };
