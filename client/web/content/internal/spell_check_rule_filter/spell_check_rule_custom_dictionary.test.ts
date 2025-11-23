import {spellCheckRuleFilterCustomDictionary} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_custom_dictionary.js";

describe("spellCheckRuleFilterCustomDictionary()", () => {
    describe("spelling rule filtering", () => {
        const testCase = (text: string, expected: boolean) => {
            const lint = {text, breakingRuleKind: "spelling", suggestions: []};
            const result = spellCheckRuleFilterCustomDictionary(lint);
            expect(result).toBe(expected);
        };

        describe("loan words", () => {
            const loanWords = [
                "fiancée",
                "fiancé",
                "jalapeño",
                "résumé",
                "attaché",
                "café",
                "exposé",
            ];

            loanWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("latin words", () => {
            const latinWords = ["per", "se", "facto", "memoriam", "et", "al", "cetera", "priori"];

            latinWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("general words", () => {
            const generalWords = ["demos", "checkout", "realtime", "hostname", "localhost", "lego"];

            generalWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("shortened words", () => {
            const shortenedWords = ["etc"];

            shortenedWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("proper nouns (exact case)", () => {
            const properNounsExactCase = ["Juneteenth", "Alpine", "Airtable"];

            properNounsExactCase.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });

                test(`returns true for ${word.toLowerCase()}`, () => {
                    testCase(word.toLowerCase(), true);
                });
            });
        });

        describe("quirky chat words", () => {
            const quirkyChatWords = ["lol", "brb", "btw", "imo", "idk", "smh", "fomo", "tbh"];

            quirkyChatWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("Canadian spellings", () => {
            const canadianWords = [
                "colour",
                "favour",
                "behaviour",
                "honour",
                "centre",
                "theatre",
                "metre",
                "litre",
                "fibre",
                "calibre",
                "cancelled",
                "traveller",
                "modelled",
                "labelled",
                "dialogue",
                "catalogue",
                "cheque",
                "grey",
                "defence",
                "licence",
                "practise",
                "analyse",
                "mould",
                "sulphur",
                "neighbour",
                "flavour",
                "vapour",
                "vigour",
            ];

            canadianWords.forEach(word => {
                test(`returns false for ${word}`, () => {
                    testCase(word, false);
                });
            });
        });

        describe("words not in dictionary", () => {
            test("returns true for unknown word", () => {
                testCase("unknownword", true);
            });

            test("returns true for misspelling", () => {
                testCase("mispelled", true);
            });

            test("returns true for American spelling of Canadian word", () => {
                testCase("color", true);
            });

            test("returns true for American spelling of Canadian word - center", () => {
                testCase("center", true);
            });
        });

        describe("randomized casing tests", () => {
            const testWords = [
                "colour",
                "fiancée",
                "centre",
                "realtime",
                "localhost",
                "behaviour",
                "etc",
                "lol",
            ];

            testWords.forEach(word => {
                test(`returns false for uppercase: ${word.toUpperCase()}`, () => {
                    const uppercaseWord = word.toUpperCase();
                    testCase(uppercaseWord, false);
                });

                test(`returns false for title case: ${
                    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
                }`, () => {
                    const titleCaseWord =
                        word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
                    testCase(titleCaseWord, false);
                });

                test(`returns false for alternating case: ${word
                    .split("")
                    .map((char, index) =>
                        index % 2 === 0 ? char.toUpperCase() : char.toLowerCase(),
                    )
                    .join("")}`, () => {
                    const alternatingCaseWord = word
                        .split("")
                        .map((char, index) =>
                            index % 2 === 0 ? char.toUpperCase() : char.toLowerCase(),
                        )
                        .join("");
                    testCase(alternatingCaseWord, false);
                });
            });
        });
    });

    describe("non-spelling rules", () => {
        test("returns true for grammar rule regardless of word", () => {
            const lint = {text: "colour", breakingRuleKind: "grammar", suggestions: []};
            const result = spellCheckRuleFilterCustomDictionary(lint);
            expect(result).toBe(true);
        });

        test("returns true for punctuation rule regardless of word", () => {
            const lint = {text: "fiancée", breakingRuleKind: "punctuation", suggestions: []};
            const result = spellCheckRuleFilterCustomDictionary(lint);
            expect(result).toBe(true);
        });

        test("returns true for style rule regardless of word", () => {
            const lint = {text: "realtime", breakingRuleKind: "style", suggestions: []};
            const result = spellCheckRuleFilterCustomDictionary(lint);
            expect(result).toBe(true);
        });
    });
});
