import {spellCheckRuleFilterAllCaps} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_all_caps.js";

describe("spellCheckRuleFilterAllCaps()", () => {
    describe("spelling rule filtering", () => {
        describe("all caps words that should be filtered", () => {
            const allCapsWords = ["NASA", "URGENT", "API2", "F.B.I.", "HTML5", "U.S.A."];

            allCapsWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    const lint = {text: word, breakingRuleKind: "spelling", suggestions: []};
                    const result = spellCheckRuleFilterAllCaps(lint);
                    expect(result).toBe(false);
                });
            });
        });

        describe("mixed case words that should not be filtered", () => {
            const mixedCaseWords = ["Hello", "hello", "iPhone", "camelCase", "MacBook"];

            mixedCaseWords.forEach(word => {
                test(`returns true for ${word}`, () => {
                    const lint = {text: word, breakingRuleKind: "spelling", suggestions: []};
                    const result = spellCheckRuleFilterAllCaps(lint);
                    expect(result).toBe(true);
                });
            });
        });
    });

    describe("miscellaneous rule filtering", () => {
        describe("all caps miscellaneous words", () => {
            const allCapsMiscWords = ["ASAP", "FYI", "LOL", "ROFL"];

            allCapsMiscWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    const lint = {text: word, breakingRuleKind: "miscellaneous", suggestions: []};
                    const result = spellCheckRuleFilterAllCaps(lint);
                    expect(result).toBe(false);
                });
            });
        });

        describe("mixed case miscellaneous words", () => {
            const mixedCaseMiscWords = ["Asap", "fyi", "Lol"];

            mixedCaseMiscWords.forEach(word => {
                test(`returns true for ${word}`, () => {
                    const lint = {text: word, breakingRuleKind: "miscellaneous", suggestions: []};
                    const result = spellCheckRuleFilterAllCaps(lint);
                    expect(result).toBe(true);
                });
            });
        });
    });

    describe("other rule types", () => {
        test("returns true for grammar rule regardless of case", () => {
            const lint = {text: "NASA", breakingRuleKind: "grammar", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(true);
        });

        test("returns true for punctuation rule regardless of case", () => {
            const lint = {text: "URGENT", breakingRuleKind: "punctuation", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(true);
        });

        test("returns true for style rule regardless of case", () => {
            const lint = {text: "API", breakingRuleKind: "style", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(true);
        });
    });

    describe("edge cases", () => {
        test("returns false for empty string", () => {
            const lint = {text: "", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });

        test("returns false for single uppercase letter", () => {
            const lint = {text: "A", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });

        test("returns true for single lowercase letter", () => {
            const lint = {text: "a", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(true);
        });

        test("returns false for numbers only", () => {
            const lint = {text: "123", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });

        test("returns false for special characters only", () => {
            const lint = {text: "!!!", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });

        test("returns false for mixed uppercase letters and numbers", () => {
            const lint = {text: "HTML5", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });

        test("returns false for uppercase with punctuation", () => {
            const lint = {text: "U.S.A.", breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterAllCaps(lint);
            expect(result).toBe(false);
        });
    });

    describe("common acronyms", () => {
        const commonAcronyms = [
            "API",
            "HTML",
            "CSS",
            "JSON",
            "HTTP",
            "HTTPS",
            "SQL",
            "XML",
            "PDF",
            "CEO",
            "CTO",
            "URL",
            "URI",
            "UUID",
            "AWS",
            "CPU",
            "GPU",
            "RAM",
            "SSD",
            "USB",
        ];

        commonAcronyms.forEach(acronym => {
            test(`returns false for ${acronym}`, () => {
                const lint = {text: acronym, breakingRuleKind: "spelling", suggestions: []};
                const result = spellCheckRuleFilterAllCaps(lint);
                expect(result).toBe(false);
            });
        });
    });
});
