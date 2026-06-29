/**
 * long-black — Australian business (ABN) data → normalized NDJSON.
 *
 * The pipeline spine lives in `crema`; this package is the ABN domain layer.
 */

export const VERSION = "0.6.0";

export { AbnDocumentSchema } from "./schema.js";
export type { AbnDocument } from "./schema.js";
