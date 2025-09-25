import {spellCheckRuleFilterBasicMath} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_basic_math.js";

describe("spellCheckRuleFilterBasicMath()", () => {
    describe("spelling rule filtering", () => {
        const testCase = (text: string, expected: boolean) => {
            const lint = {text, breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterBasicMath(lint);
            expect(result).toBe(expected);
        };

        describe("dimension patterns that should be filtered", () => {
            const dimensionPatterns = [
                "1920x1080",
                "3840x2160",
                "375x667",
                "1024x1024",
                "16x16",
                "8x8",
                "5x3",
                "12345x67890",
                "1366x768",
                "16x9",
                "textx123",
            ];

            dimensionPatterns.forEach(pattern => {
                test(`returns false for ${pattern}`, () => {
                    testCase(pattern, false);
                });
            });
        });

        describe("patterns that should not be filtered", () => {
            const nonMatchingPatterns = [
                "example",
                "x-axis",
                "xbox",
                "12345",
                "complex",
                "x",
                "1920X1080",
                "1920 x 1080",
            ];

            nonMatchingPatterns.forEach(pattern => {
                test(`returns true for ${pattern}`, () => {
                    testCase(pattern, true);
                });
            });
        });

        describe("edge cases with x pattern", () => {
            test("returns false for x followed by single digit", () => {
                testCase("x1", false);
            });

            test("returns false for x followed by multiple digits", () => {
                testCase("x999999", false);
            });

            test("returns false for pattern within longer text", () => {
                testCase("imagex1080", false);
            });

            test("returns false for pattern with decimals", () => {
                testCase("x1.5", false);
            });

            test("returns true for uppercase X", () => {
                testCase("1920X1080", true);
            });

            test("returns true for spaces around x", () => {
                testCase("1920 x 1080", true);
            });
        });
    });

    describe("non-spelling rules", () => {
        test("returns true for grammar rule regardless of pattern", () => {
            const lint = {text: "1920x1080", breakingRuleKind: "grammar", suggestions: []};
            const result = spellCheckRuleFilterBasicMath(lint);
            expect(result).toBe(true);
        });

        test("returns true for punctuation rule regardless of pattern", () => {
            const lint = {text: "16x9", breakingRuleKind: "punctuation", suggestions: []};
            const result = spellCheckRuleFilterBasicMath(lint);
            expect(result).toBe(true);
        });

        test("returns true for style rule regardless of pattern", () => {
            const lint = {text: "1024x768", breakingRuleKind: "style", suggestions: []};
            const result = spellCheckRuleFilterBasicMath(lint);
            expect(result).toBe(true);
        });

        test("returns true for miscellaneous rule regardless of pattern", () => {
            const lint = {text: "800x600", breakingRuleKind: "miscellaneous", suggestions: []};
            const result = spellCheckRuleFilterBasicMath(lint);
            expect(result).toBe(true);
        });
    });
});
