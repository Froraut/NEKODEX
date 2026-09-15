import type { CodexTool } from "../../types";

export interface CommandEscalation {
  sandbox_permissions?: "use_default" | "require_escalated";
  justification?: string;
  prefix_rule?: string[];
}

export function hasCommandEscalation(input: CommandEscalation): boolean {
  return input.sandbox_permissions !== undefined
    || input.justification !== undefined
    || input.prefix_rule !== undefined;
}

function objectSchema(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function matchesDeclaredSchema(value: string | string[], schema: Record<string, unknown>): boolean {
  // Do not infer support from a property whose constraints this narrow checker cannot resolve.
  if (["$ref", "allOf", "anyOf", "oneOf", "not", "if", "then", "else"].some(key => key in schema)) return false;
  const expectedType = Array.isArray(value) ? "array" : "string";
  if (schema.type !== expectedType) return false;
  if (schema.const !== undefined && JSON.stringify(schema.const) !== JSON.stringify(value)) return false;
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.some(
    candidate => JSON.stringify(candidate) === JSON.stringify(value)
  ))) return false;
  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) return false;
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) return false;
    if (schema.pattern !== undefined) {
      if (typeof schema.pattern !== "string") return false;
      try {
        if (!new RegExp(schema.pattern).test(value)) return false;
      } catch { return false; }
    }
    return true;
  }
  if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
  if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
  if (schema.uniqueItems === true && new Set(value).size !== value.length) return false;
  const items = objectSchema(schema.items);
  return Boolean(items && value.every(item => matchesDeclaredSchema(item, items)));
}

/** Check only the new approval-related arguments against this turn's exact native tool card. */
export function assertCommandEscalationSchema(
  tool: CodexTool,
  input: CommandEscalation,
): void {
  if (!hasCommandEscalation(input)) return;
  if (tool.freeform || tool.toolSearch) {
    throw new Error(`Native ${tool.name} must be a structured command tool for approval arguments`);
  }
  const parameters = objectSchema(tool.parameters);
  const hasUnknownObjectConstraints = parameters && ["$ref", "allOf", "anyOf", "oneOf", "not", "if", "then", "else"]
    .some(key => key in parameters);
  const properties = parameters?.type === "object" && !hasUnknownObjectConstraints
    ? objectSchema(parameters.properties)
    : undefined;
  if (!properties) {
    throw new Error(`Native ${tool.name} did not advertise an exact command JSON schema for approval arguments`);
  }
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const property = objectSchema(properties[name]);
    if (!property || !matchesDeclaredSchema(value, property)) {
      throw new Error(`Native ${tool.name} JSON schema does not support ${name} with the requested value`);
    }
  }
}
