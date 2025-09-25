import {
    SpellCheckRuleFilterLint,
    spellCheckRuleFilter,
} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

describe("spellCheckRuleFilter()", () => {
    describe("combined filter functionality", () => {
        test("returns false when any individual filter returns false", () => {
            // This should be filtered by custom dictionary
            const customDictionaryLint = {
                text: "colour",
                breakingRuleKind: "spelling",
                suggestions: [],
            };
            expect(spellCheckRuleFilter(customDictionaryLint)).toBe(false);

            // This should be filtered by all caps filter
            const allCapsLint = {text: "NASA", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(allCapsLint)).toBe(false);

            // This should be filtered by basic math filter
            const basicMathLint = {
                text: "1920x1080",
                breakingRuleKind: "spelling",
                suggestions: [],
            };
            expect(spellCheckRuleFilter(basicMathLint)).toBe(false);

            // This should be filtered by units filter
            const unitsLint = {text: "5kg", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(unitsLint)).toBe(false);

            // This should be filtered by miscellaneous grammar filter
            const miscGrammarLint: SpellCheckRuleFilterLint = {
                text: "how ",
                breakingRuleKind: "wordchoice",
                suggestions: [{kind: "insertafter", text: "to "}],
            };
            expect(spellCheckRuleFilter(miscGrammarLint)).toBe(false);
        });

        test("returns true when all individual filters return true", () => {
            const lint = {text: "unknownword", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(true);
        });

        test("returns true for non-spelling rules that don not match any filter", () => {
            const grammarLint = {text: "colour", breakingRuleKind: "grammar", suggestions: []};
            expect(spellCheckRuleFilter(grammarLint)).toBe(true);
        });
    });

    describe("filter integration", () => {
        const testCases: Array<{
            input: SpellCheckRuleFilterLint;
            expected: boolean;
            description: string;
        }> = [
            // Custom dictionary cases
            {
                input: {text: "fiancée", breakingRuleKind: "spelling", suggestions: []},
                expected: false,
                description: "custom dictionary word",
            },
            // All caps cases
            {
                input: {text: "FAQ", breakingRuleKind: "spelling", suggestions: []},
                expected: false,
                description: "all caps spelling",
            },
            {
                input: {text: "URGENT", breakingRuleKind: "miscellaneous", suggestions: []},
                expected: false,
                description: "all caps miscellaneous",
            },
            // Basic math cases
            {
                input: {text: "1024x768", breakingRuleKind: "spelling", suggestions: []},
                expected: false,
                description: "basic math pattern",
            },
            // Units cases
            {
                input: {text: "5kg", breakingRuleKind: "spelling", suggestions: []},
                expected: false,
                description: "units pattern",
            },
            // Miscellaneous grammar cases
            {
                input: {
                    text: "how ",
                    breakingRuleKind: "wordchoice",
                    suggestions: [{kind: "insertafter", text: "to "}],
                },
                expected: false,
                description: "misc grammar pattern",
            },
            // Cases that should pass through
            {
                input: {text: "mispelled", breakingRuleKind: "spelling", suggestions: []},
                expected: true,
                description: "unknown misspelled word",
            },
            {
                input: {text: "color", breakingRuleKind: "spelling", suggestions: []},
                expected: true,
                description: "American spelling not in Canadian dictionary",
            },
            {
                input: {text: "punctuation", breakingRuleKind: "punctuation", suggestions: []},
                expected: true,
                description: "non-spelling rule",
            },
        ];

        testCases.forEach(({input, expected, description}) => {
            test(`returns ${expected} for ${description}: ${input.text}`, () => {
                expect(spellCheckRuleFilter(input)).toBe(expected);
            });
        });
    });

    describe("edge cases", () => {
        test("handles empty text", () => {
            const lint = {text: "", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(false);
        });

        test("handles undefined breakingRuleKind", () => {
            const lint = {text: "colour", breakingRuleKind: undefined as any, suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(true);
        });

        test("handles unknown breakingRuleKind", () => {
            const lint = {text: "colour", breakingRuleKind: "unknown", suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(true);
        });

        test("handles special characters", () => {
            const lint = {text: "@#$%", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(false);
        });

        test("handles numbers", () => {
            const lint = {text: "12345", breakingRuleKind: "spelling", suggestions: []};
            expect(spellCheckRuleFilter(lint)).toBe(false);
        });
    });
});
