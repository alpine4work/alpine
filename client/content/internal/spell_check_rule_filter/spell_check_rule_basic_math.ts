import type {SpellCheckRuleFilter} from "~/client/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

// A common use case for this is photo dimensions. Harper flags things like "1920x1080" as a
// spelling error. This isn't perfect, but it should cover most cases.
export const spellCheckRuleFilterBasicMath: SpellCheckRuleFilter = lint => {
    const {text, breakingRuleKind} = lint;

    if (breakingRuleKind === "spelling" && /x\d+/.test(text)) {
        return false;
    }

    return true;
};
