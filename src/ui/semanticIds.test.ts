import { describe, expect, it } from "vitest";
import { SEMANTIC_IDS, semanticIds } from "./semanticIds";

describe("semantic control ids", () => {
  it("keeps ids unique and stable", () => {
    expect(new Set(semanticIds).size).toBe(semanticIds.length);
    expect(SEMANTIC_IDS.townPanel).toBe("town-panel");
    expect(SEMANTIC_IDS.techPanel).toBe("tech-panel");
  });
});
