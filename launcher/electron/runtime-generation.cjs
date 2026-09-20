const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const MAX_CONFIG_BYTES = 4 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

class RuntimeGenerationStore {
  constructor({ configPath, journalPath }) {
    if (![configPath, journalPath].every(value => typeof value === "string" && path.isAbsolute(value))) {
      throw new Error("Runtime generation paths must be absolute");
    }
    this.configPath = path.resolve(configPath);
    this.journalPath = path.resolve(journalPath);
  }

  read() {
    if (!fs.existsSync(this.journalPath)) return null;
    const stat = fs.lstatSync(this.journalPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 1 || stat.size > MAX_CONFIG_BYTES * 3) {
      throw new Error("Pending runtime generation journal is unsafe");
    }
    const value = JSON.parse(fs.readFileSync(this.journalPath, "utf8"));
    const before = typeof value?.before === "string" ? Buffer.from(value.before, "base64") : null;
    const candidate = typeof value?.candidate === "string" ? Buffer.from(value.candidate, "base64") : null;
    if (value?.version !== 1 || typeof value.id !== "string" || !/^[a-f0-9-]{36}$/.test(value.id)
      || path.resolve(value.configPath || "") !== this.configPath
      || !["prepared", "staged"].includes(value.phase)
      || !SHA256.test(value.beforeSha256 || "") || !SHA256.test(value.candidateSha256 || "")
      || !before || before.length > MAX_CONFIG_BYTES || digest(before) !== value.beforeSha256
      || !candidate || candidate.length > MAX_CONFIG_BYTES || digest(candidate) !== value.candidateSha256
      || typeof value.fromVersion !== "string" || typeof value.toVersion !== "string") {
      throw new Error("Pending runtime generation journal is invalid");
    }
    return { ...value, before, candidate };
  }

  currentBytes() {
    const bytes = fs.readFileSync(this.configPath);
    if (bytes.length > MAX_CONFIG_BYTES) throw new Error("Runtime configuration is too large for generation recovery");
    return bytes;
  }

  inspect(id) {
    const journal = this.read();
    if (!journal) return { status: "none" };
    if (id !== undefined && journal.id !== id) throw new Error("Runtime generation identity changed");
    const currentSha256 = digest(this.currentBytes());
    const status = currentSha256 === journal.candidateSha256 ? "candidate"
      : currentSha256 === journal.beforeSha256 ? "previous" : "concurrent";
    return { status, journal };
  }

  recover() {
    const observed = this.inspect();
    if (observed.status === "none") return { status: "none" };
    if (observed.status === "concurrent") {
      throw new Error("Runtime config changed outside the pending generation; preserving it and the recovery journal");
    }
    if (observed.status === "candidate") writePrivateFileAtomic(this.configPath, observed.journal.before);
    fs.rmSync(this.journalPath, { force: true });
    return { status: observed.status === "candidate" ? "rolled-back" : "already-restored",
      id: observed.journal.id, fromVersion: observed.journal.fromVersion, toVersion: observed.journal.toVersion };
  }

  stage({ before, candidate, fromVersion, toVersion }) {
    if (!Buffer.isBuffer(before) || !Buffer.isBuffer(candidate)
      || before.length > MAX_CONFIG_BYTES || candidate.length > MAX_CONFIG_BYTES) {
      throw new Error("Runtime generation config bytes are invalid");
    }
    if (this.read()) throw new Error("A runtime generation is already pending");
    const current = this.currentBytes();
    if (!current.equals(before)) throw new Error("Runtime configuration changed before generation staging");
    const journal = {
      version: 1,
      id: randomUUID(),
      phase: "prepared",
      configPath: this.configPath,
      before: before.toString("base64"),
      candidate: candidate.toString("base64"),
      beforeSha256: digest(before),
      candidateSha256: digest(candidate),
      fromVersion,
      toVersion,
      createdAt: new Date().toISOString(),
    };
    writePrivateFileAtomic(this.journalPath, `${JSON.stringify(journal)}\n`);
    if (!this.currentBytes().equals(before)) {
      fs.rmSync(this.journalPath, { force: true });
      throw new Error("Runtime configuration changed while generation staging was prepared");
    }
    writePrivateFileAtomic(this.configPath, candidate);
    journal.phase = "staged";
    writePrivateFileAtomic(this.journalPath, `${JSON.stringify(journal)}\n`);
    return { id: journal.id, fromVersion, toVersion };
  }

  rollback(id) {
    const observed = this.inspect(id);
    if (observed.status === "none") throw new Error("Runtime generation is no longer pending");
    if (observed.status === "concurrent") {
      throw new Error("Runtime config changed after generation staging; preserving the concurrent edit and recovery journal");
    }
    if (observed.status === "candidate") writePrivateFileAtomic(this.configPath, observed.journal.before);
    fs.rmSync(this.journalPath, { force: true });
    return { restored: observed.status === "candidate", fromVersion: observed.journal.fromVersion };
  }

  activateCandidateForStop(id) {
    const observed = this.inspect(id);
    if (observed.status === "none") throw new Error("Runtime generation is no longer pending");
    if (observed.status === "concurrent") {
      throw new Error("Runtime config changed outside the pending generation; preserving it and the recovery journal");
    }
    if (observed.status === "previous") {
      if (!this.currentBytes().equals(observed.journal.before)) {
        throw new Error("Previous runtime config changed before candidate ownership recovery");
      }
      writePrivateFileAtomic(this.configPath, observed.journal.candidate);
    }
    return { activated: observed.status === "previous", id: observed.journal.id };
  }

  commit(id) {
    const observed = this.inspect(id);
    if (observed.status !== "candidate") {
      throw new Error(observed.status === "none"
        ? "Runtime generation is no longer pending"
        : "Runtime config changed before generation commit; preserving the recovery journal");
    }
    fs.rmSync(this.journalPath, { force: true });
    return { committed: true, toVersion: observed.journal.toVersion };
  }
}

module.exports = { RuntimeGenerationStore };
