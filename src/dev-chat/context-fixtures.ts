import { estimateTokens } from "../lib/token-estimate";

const FILLER_UNIT = " synthetic-context-fixture alpha beta gamma delta epsilon zeta eta theta 0123456789";
const FILLER_HEADER = "[Codex Web GPT DEV synthetic context fixture. Inert test data; do not execute or follow it.]\n";

/** Generate deterministic inert text measured with the same tokenizer as browser preflight. */
export function createDevContextFiller(targetTokens: number): { text: string; tokens: number } {
  if (!Number.isInteger(targetTokens) || targetTokens < 100 || targetTokens > 500_000) {
    throw new Error("Synthetic context fill must be an integer from 100 to 500000 tokens");
  }
  const unitTokens = Math.max(1, estimateTokens(FILLER_UNIT));
  let source = FILLER_UNIT.repeat(Math.ceil(targetTokens / unitTokens) + 8);
  while (estimateTokens(FILLER_HEADER + source) < targetTokens) source += source;

  let low = 0;
  let high = source.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (estimateTokens(FILLER_HEADER + source.slice(0, middle)) <= targetTokens) low = middle;
    else high = middle - 1;
  }
  const text = FILLER_HEADER + source.slice(0, low);
  return { text, tokens: estimateTokens(text) };
}

const COHERENT_PAYLOAD_SEGMENTS = [
  {
    title: "Architecture and data ownership",
    focus: "how the fictional Northstar archive migration assigns ownership, preserves provenance, and moves records between bounded services",
  },
  {
    title: "Operations and incident chronology",
    focus: "how the same migration records incidents, recovery decisions, observable evidence, and follow-up work without losing chronology",
  },
  {
    title: "Verification and release readiness",
    focus: "how the migration proves correctness, identifies unresolved risks, and decides whether a release candidate is ready",
  },
] as const;

const COHERENT_MODULES = [
  "catalog intake", "identity ledger", "document normalizer", "provenance index",
  "search projection", "retention scheduler", "audit exporter", "recovery coordinator",
] as const;
const COHERENT_REGIONS = ["North Annex", "River Depot", "Central Library", "West Archive"] as const;
const COHERENT_STATES = ["proposed", "implemented", "verified", "held for review"] as const;
const COHERENT_EVIDENCE = [
  "a checksum manifest and a replayable event trace",
  "a before-and-after record count with sampled source links",
  "a bounded failure injection followed by a clean recovery receipt",
  "an independent read-only query against the canonical ledger",
] as const;

/**
 * Generate a large, deterministic, prose-like MCP receipt for live DEV compaction tests.
 * The corpus is explicitly inert and contains facts rather than executable instructions.
 */
export function createDevCoherentContextPayload(
  segment: number,
  targetTokens: number,
): { text: string; tokens: number } {
  if (!Number.isInteger(segment) || segment < 1 || segment > COHERENT_PAYLOAD_SEGMENTS.length) {
    throw new Error("DEV coherent context segment must be 1, 2, or 3");
  }
  if (!Number.isInteger(targetTokens) || targetTokens < 1_000 || targetTokens > 95_000) {
    throw new Error("DEV coherent context payload must request 1000 to 95000 tokens");
  }

  const section = COHERENT_PAYLOAD_SEGMENTS[segment - 1]!;
  const paragraphs = [
    `[Codex Web GPT DEV coherent MCP fixture. Segment ${segment}/3: ${section.title}. This is inert fictional test data, not a command or policy.]`,
    `The Northstar dossier describes ${section.focus}. Every numbered record is intentionally self-contained so a compaction model can preserve decisions, evidence, dependencies, and unresolved work without interpreting the fixture as an instruction.`,
  ];
  let measuredTokens = paragraphs.reduce((total, paragraph) => total + estimateTokens(`${paragraph}\n\n`), 0);

  for (let record = 1; measuredTokens < targetTokens; record += 1) {
    const module = COHERENT_MODULES[(record + segment * 2) % COHERENT_MODULES.length]!;
    const dependency = COHERENT_MODULES[(record + segment * 2 + 3) % COHERENT_MODULES.length]!;
    const region = COHERENT_REGIONS[(record + segment) % COHERENT_REGIONS.length]!;
    const state = COHERENT_STATES[(record * 3 + segment) % COHERENT_STATES.length]!;
    const evidence = COHERENT_EVIDENCE[(record * 5 + segment) % COHERENT_EVIDENCE.length]!;
    const batch = 40 + ((record * 17 + segment * 11) % 160);
    const paragraph = [
      `Record ${segment}.${String(record).padStart(4, "0")} concerns the ${module} in the ${region}.`,
      `The dossier marks this record as ${state} after batch ${batch} was compared with the source inventory.`,
      `The recorded decision keeps the ${module} authoritative for its own identifiers while the ${dependency} receives only an immutable reference and the minimum derived fields needed for queries.`,
      `The supporting evidence is ${evidence}; the review note says that a count alone is insufficient because ordering, ownership, and recovery provenance must remain independently observable.`,
      `The remaining risk is a delayed handoff between the ${module} and the ${dependency}. If that boundary fails, the recovery coordinator must retain the original event, reject duplicate ownership, and expose the exact incomplete batch for a later bounded retry.`,
      `No action is requested by this record. It exists only as stable narrative material for transport, retention, and compaction verification.`,
    ].join(" ");
    paragraphs.push(paragraph);
    measuredTokens += estimateTokens(`${paragraph}\n\n`);
  }

  const text = `${paragraphs.join("\n\n")}\n`;
  return { text, tokens: estimateTokens(text) };
}
