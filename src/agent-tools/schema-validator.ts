import Ajv, { type ValidateFunction } from "ajv";
import Ajv2020 from "ajv/dist/2020";
import addFormats from "ajv-formats";

/** Closed local dialect selection. Schema declarations remain intact; no remote meta-schema fetch. */
export function compileToolInputSchema(schema: Record<string, unknown>): ValidateFunction {
  // Both tool owners validate synchronously. An async Ajv validator returns a
  // Promise, which must never be mistaken for an accepted argument object.
  if (JSON.stringify(schema).includes('"$async"')) throw new Error("Async tool input schemas are unsupported");
  const dialect = schema.$schema;
  if (dialect !== undefined && dialect !== "http://json-schema.org/draft-07/schema#"
    && dialect !== "https://json-schema.org/draft/2020-12/schema") throw new Error("Unsupported tool input schema dialect");
  const ajv = dialect === "https://json-schema.org/draft/2020-12/schema"
    ? new Ajv2020({ strict: true, allowUnionTypes: true, allErrors: false }) : new Ajv({ strict: true, allowUnionTypes: true, allErrors: false });
  addFormats(ajv);
  return ajv.compile(schema);
}
