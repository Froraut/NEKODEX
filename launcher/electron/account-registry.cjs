const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { writePrivateFileAtomic } = require("./atomic-file.cjs");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function validateAccountId(value) {
  if (typeof value !== "string" || (value !== "default"
    && (value.length !== 36 || !UUID_PATTERN.test(value)))) {
    throw new TypeError("Account id must be default or a canonical lower-case UUID");
  }
  return value;
}

function validateLabel(value) {
  if (typeof value !== "string" || !value.trim() || value.trim().length > 80) {
    throw new TypeError("Account label must contain 1 to 80 characters after trimming");
  }
  return value.trim();
}

function validateMode(value) {
  if (value !== "selected" && value !== "balanced") {
    throw new TypeError("Account routing mode must be selected or balanced");
  }
  return value;
}

function requireShape(value, keys, description) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || !keys.every((key) => Object.hasOwn(value, key))) {
    throw new TypeError(`Invalid ${description} shape`);
  }
}

function validateConfig(value) {
  requireShape(value, ["accounts", "selectedId", "mode"], "account registry");
  if (!Array.isArray(value.accounts) || value.accounts.length === 0) {
    throw new TypeError("Account registry must contain accounts");
  }
  const ids = new Set();
  const accounts = value.accounts.map((account) => {
    requireShape(account, ["id", "label", "enabled"], "account metadata");
    const id = validateAccountId(account.id);
    const label = validateLabel(account.label);
    if (ids.has(id)) throw new Error("Duplicate account id in registry");
    if (label !== account.label) throw new TypeError("Saved account labels must be trimmed");
    if (typeof account.enabled !== "boolean") throw new TypeError("Account enabled must be boolean");
    ids.add(id);
    return { id, label, enabled: account.enabled };
  });
  if (!ids.has("default")) throw new Error("Account registry must retain the default account");
  if (!accounts.some((account) => account.enabled)) throw new Error("At least one account must be enabled");
  const selectedId = validateAccountId(value.selectedId);
  if (!ids.has(selectedId)) throw new Error("Selected account does not exist");
  return { accounts, selectedId, mode: validateMode(value.mode) };
}

/**
 * Synchronous metadata-only registry; keep one instance per coreHome in the
 * launcher main process. coreHome must come from trusted launcher configuration,
 * never UI input. The fixed filename and internally generated IDs expose no
 * path selection API. No cookies, passwords, tokens, or auth claims belong here.
 *
 * A disabled account may remain selected (or be selected explicitly). In
 * selected mode the scheduler MUST fail if that account is disabled, rather
 * than silently route to another account. Enabled is config, not auth status.
 * A missing file uses defaults in memory until the first successful mutation.
 */
function createAccountRegistry(coreHome) {
  if (typeof coreHome !== "string" || !coreHome.trim() || !path.isAbsolute(coreHome)) {
    throw new TypeError("coreHome must be an absolute launcher directory");
  }
  const filename = path.join(coreHome, "account-registry.json");
  let state;
  let saved;
  try {
    saved = fs.readFileSync(filename, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  state = saved === undefined ? {
    accounts: [{ id: "default", label: "Primary account", enabled: true }],
    selectedId: "default",
    mode: "selected",
  } : validateConfig(JSON.parse(saved));

  function snapshot() {
    return {
      accounts: state.accounts.map(({ id, label, enabled }) => ({ id, label, enabled })),
      selectedId: state.selectedId,
      mode: state.mode,
    };
  }

  function save(next) {
    const config = validateConfig(next);
    writePrivateFileAtomic(filename, `${JSON.stringify(config, null, 2)}\n`);
    state = config;
    return snapshot();
  }

  function requireAccount(id) {
    validateAccountId(id);
    const account = state.accounts.find((entry) => entry.id === id);
    if (!account) throw new Error("Account does not exist");
    return account;
  }

  return Object.freeze({
    snapshot,
    list: snapshot,
    add(label) {
      const normalizedLabel = validateLabel(label);
      let id;
      do { id = randomUUID(); } while (state.accounts.some((account) => account.id === id));
      return save({
        accounts: [...state.accounts, { id, label: normalizedLabel, enabled: true }],
        selectedId: id,
        mode: state.mode,
      });
    },
    select(id) {
      requireAccount(id);
      return save({ ...state, selectedId: id });
    },
    setEnabled(id, enabled) {
      requireAccount(id);
      if (typeof enabled !== "boolean") throw new TypeError("Account enabled must be boolean");
      return save({
        ...state,
        accounts: state.accounts.map((account) => account.id === id ? { ...account, enabled } : account),
      });
    },
    setMode(mode) {
      return save({ ...state, mode: validateMode(mode) });
    },
  });
}

module.exports = { createAccountRegistry, validateAccountId };
