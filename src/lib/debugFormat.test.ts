import { describe, expect, it } from "vitest";
import { expressionLabel, formatTopBlendshapes } from "./debugFormat";
import { FFLExpression } from "./types";

describe("debug format", () => {
  it("lists the five strongest blendshapes above the noise floor", () => {
    const blendshapes = [
      { categoryName: "a", score: 0.1 },
      { categoryName: "b", score: 0.9 },
      { categoryName: "c", score: 0.04 },
      { categoryName: "d", score: 0.5 },
      { categoryName: "e", score: 0.3 },
      { categoryName: "f", score: 0.2 },
      { categoryName: "g", score: 0.6 },
    ];

    expect(formatTopBlendshapes(blendshapes)).toBe(
      "b 0.90, g 0.60, d 0.50, e 0.30, f 0.20",
    );
    expect(formatTopBlendshapes([])).toBe("none");
  });

  it("labels known and unknown expression indexes", () => {
    expect(expressionLabel(FFLExpression.Normal)).toMatch(/^0 \S/);
    expect(expressionLabel(999)).toBe("999");
  });
});
