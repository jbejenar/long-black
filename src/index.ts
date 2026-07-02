/**
 * long-black — Australian business (ABN) data → normalized NDJSON.
 *
 * The pipeline spine lives in `crema`; this package is the ABN domain layer.
 */

/**
 * The output-schema (contract) version — the single source of truth for
 * `metadata.json` `schemaVersion`. MUST equal `package.json` "version"; a unit test
 * (`version.test.ts`) enforces this. It had silently frozen at 0.6.0 while
 * package.json advanced to 0.17.x, so shipped metadata under-reported the schema
 * version — the drift guard prevents that recurring.
 */
export const VERSION = "0.18.0";

export { AbnDocumentSchema } from "./schema.js";
export type { AbnDocument } from "./schema.js";
