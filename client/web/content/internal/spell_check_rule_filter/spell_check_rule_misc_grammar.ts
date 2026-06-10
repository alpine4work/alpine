import type {SpellCheckRuleFilter} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

// This is for one-off rules that we find that don't align with how we think
// English should work. These are typically grammar or word choice rules that we
// disagree with or find too pedantic.
export const spellCheckRuleFilterMiscGrammar: SpellCheckRuleFilter = lint => {
    const {text, breakingRuleKind, suggestions} = lint;

    // Filter the "how to" word choice rule Harper always suggests changing "how " to
    // "how to" which we find unnecessary
    if (
        breakingRuleKind === "wordchoice" &&
        text === "how " &&
        suggestions?.some(
            suggestion =>
                suggestion.text.toLowerCase() === "to " && suggestion.kind === "insertafter",
        )
    ) {
        return false;
    }

    return true;
};
