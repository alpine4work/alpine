import {SpellCheckRuleFilterLint} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";
import {spellCheckRuleFilterMiscGrammar} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_misc_grammar.js";

describe("spellCheckRuleFilterMiscGrammar()", () => {
    describe("how to wordchoice rule", () => {
        // eslint-disable-next-line string-quotes
        test("returns false for 'how ' with wordchoice rule and 'to ' as insertafter suggestion", () => {
            const lint: SpellCheckRuleFilterLint = {
                text: "how ",
                breakingRuleKind: "wordchoice",
                suggestions: [{kind: "insertafter", text: "to "}],
            };
            const result = spellCheckRuleFilterMiscGrammar(lint);
            expect(result).toBe(false);
        });

        // eslint-disable-next-line string-quotes
        test("returns true for 'how ' with wordchoice rule but no 'to ' insertafter suggestions", () => {
            const lint: SpellCheckRuleFilterLint = {
                text: "how ",
                breakingRuleKind: "wordchoice",
                suggestions: [
                    {kind: "replace", text: "how about"},
                    {kind: "insertafter", text: "about "},
                    {kind: "replace", text: "to "},
                ],
            };
            const result = spellCheckRuleFilterMiscGrammar(lint);
            expect(result).toBe(true);
        });
    });
});
