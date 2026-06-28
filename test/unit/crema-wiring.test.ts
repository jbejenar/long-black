/**
 * Proves long-black resolves and consumes crema's compiled public API.
 * (C0.07 DoD: long-black `npm i`s crema and imports streamFlatten/split/etc.)
 */

import { describe, it, expect } from "vitest";
import {
  streamFlatten,
  split,
  compress,
  verify,
  generateMetadata,
  ProgressLogger,
  FLATTEN_POSTGRES_CONFIG,
} from "crema";

describe("crema wiring", () => {
  it("imports crema's public API as compiled JS", () => {
    expect(typeof streamFlatten).toBe("function");
    expect(typeof split).toBe("function");
    expect(typeof compress).toBe("function");
    expect(typeof verify).toBe("function");
    expect(typeof generateMetadata).toBe("function");
    expect(typeof ProgressLogger).toBe("function");
  });

  it("re-exports the E1.24 flatten config", () => {
    expect(FLATTEN_POSTGRES_CONFIG.max).toBe(1);
    expect(FLATTEN_POSTGRES_CONFIG.max_lifetime).toBeNull();
  });
});
