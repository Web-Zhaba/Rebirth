import { describe, expect, it } from "vitest";
import { signedDaily } from "./resourceModel";

describe("resource daily labels", () => {
  it("formats signed daily values", () => {
    expect(signedDaily(24.25, "кг")).toBe("+24,3 кг/дн");
    expect(signedDaily(-3, "м³")).toBe("−3 м³/дн");
    expect(signedDaily(0.01, "кг")).toBe("0 кг/дн");
  });
});
