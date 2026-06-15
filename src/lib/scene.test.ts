import { describe, expect, it } from "vitest";
import { expressionIndexFromVariantName } from "./scene";

describe("expressionIndexFromVariantName", () => {
  it("parses FFL renderer expression variant names", () => {
    expect(expressionIndexFromVariantName("Expression_0")).toBe(0);
    expect(expressionIndexFromVariantName("Expression_18")).toBe(18);
  });

  it("ignores non-expression variant names", () => {
    expect(expressionIndexFromVariantName("expression_0")).toBeNull();
    expect(expressionIndexFromVariantName("Expression_")).toBeNull();
    expect(expressionIndexFromVariantName("Expression_1_extra")).toBeNull();
    expect(expressionIndexFromVariantName(undefined)).toBeNull();
  });
});
