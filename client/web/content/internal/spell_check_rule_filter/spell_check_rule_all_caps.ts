import type {SpellCheckRuleFilter} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

// Harper has individual rules for things like FYI, ASAP, etc.
// Instead of trying to follow their addition of these miscellaneous rules,
// we will just ignore all-caps words for spelling/miscellaneous rules.
// This also includes typing in all-caps, which is common for acronyms.
// Many document editors and chat apps just ignore all-caps words for spell checking.
export const spellCheckRuleFilterAllCaps: SpellCheckRuleFilter = lint => {
    const {text, breakingRuleKind} = lint;

    if (
        (breakingRuleKind === "spelling" || breakingRuleKind === "miscellaneous") &&
        text.toUpperCase() === text
    ) {
        return false;
    }

    return true;
};
