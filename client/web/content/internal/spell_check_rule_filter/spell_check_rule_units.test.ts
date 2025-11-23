import {spellCheckRuleFilterUnits} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_units.js";

describe("spellCheckRuleFilterUnits()", () => {
    describe("spelling rule filtering", () => {
        const testCase = (text: string, expected: boolean) => {
            const lint = {text, breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(expected);
        };

        describe("time units", () => {
            const timeUnits = ["5s", "10m", "2h", "24h", "7d", "1y", "30ms", "100ns", "1000us"];

            timeUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("length/distance units", () => {
            const lengthUnits = ["100cm", "10m", "5km", "12in", "6ft", "2mm", "50nm", "1000px"];

            lengthUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("weight/mass units", () => {
            const weightUnits = ["2kg", "500g", "10lb", "5oz", "1t", "250mg"];

            weightUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("volume units", () => {
            const volumeUnits = ["500ml", "1l", "2gal", "100fl", "250cl"];

            volumeUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("temperature units", () => {
            const temperatureUnits = ["25c", "75f", "300k"];

            temperatureUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("digital units", () => {
            const digitalUnits = ["1kb", "500mb", "2gb", "1tb", "100b", "8bit"];

            digitalUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("decimal units", () => {
            const decimalUnits = ["2.5kg", "10.75m", "0.5s", "3.14cm", "100.0ml"];

            decimalUnits.forEach(unit => {
                test(`returns false for ${unit}`, () => {
                    testCase(unit, false);
                });
            });
        });

        describe("units that should not be filtered", () => {
            const nonUnits = [
                "hello",
                "world",
                "s", // just a letter
                "m", // just a letter
                "kg", // just letters without number
                "5", // just a number
                "5 kg", // space between number and unit
                "kg5", // unit before number
                "abc123", // letters before numbers
            ];

            nonUnits.forEach(nonUnit => {
                test(`returns true for ${nonUnit}`, () => {
                    testCase(nonUnit, true);
                });
            });
        });
    });

    describe("non-spelling rules", () => {
        const ruleTypes = ["grammar", "punctuation", "style", "miscellaneous"];

        ruleTypes.forEach(ruleType => {
            test(`returns true for ${ruleType} rule regardless of content`, () => {
                const lint = {text: "5kg", breakingRuleKind: ruleType, suggestions: []};
                const result = spellCheckRuleFilterUnits(lint);
                expect(result).toBe(true);
            });
        });
    });

    describe("edge cases", () => {
        test("returns true for empty string", () => {
            const lint = {text: "", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(true);
        });

        test("returns false for large numbers with units", () => {
            const lint = {text: "999999kg", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(false);
        });

        test("returns false for multiple decimal places", () => {
            const lint = {text: "12.345678m", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(false);
        });

        test("returns false for leading decimal point", () => {
            const lint = {text: ".5kg", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(false);
        });

        test("returns false for mixed case units", () => {
            const lint = {text: "5KG", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(false);
        });

        test("returns false for long unit names", () => {
            const lint = {text: "100meters", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterUnits(lint);
            expect(result).toBe(false);
        });
    });

    describe("pattern validation", () => {
        test("regex matches number + unit combinations", () => {
            const pattern = /^\d*\.?\d+[a-zA-Z]+$/;
            expect(pattern.test("5kg")).toBe(true);
            expect(pattern.test("10.5m")).toBe(true);
            expect(pattern.test(".5s")).toBe(true);
            expect(pattern.test("100cm")).toBe(true);
            expect(pattern.test("hello")).toBe(false);
            expect(pattern.test("5 kg")).toBe(false);
            expect(pattern.test("kg5")).toBe(false);
        });
    });
});
