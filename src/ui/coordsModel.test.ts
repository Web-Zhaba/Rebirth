import { describe, expect, it } from "vitest";
import { formatCoordinates } from "./coordsModel";

describe("coordinate formatting", () => {
  it("formats map coordinates for copying", () => {
    expect(formatCoordinates(59.437, 24.7536)).toBe("59.43700, 24.75360");
    expect(formatCoordinates(-33.86882, 151.209296, 4)).toBe("-33.8688, 151.2093");
    expect(formatCoordinates(0, 0)).toBe("0.00000, 0.00000");
  });
});
