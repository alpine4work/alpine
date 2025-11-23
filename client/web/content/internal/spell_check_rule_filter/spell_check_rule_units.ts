import type {SpellCheckRuleFilter} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_filter.js";

// Filter out units of measurement that might be flagged as spelling errors.
// Common patterns like "5s", "10m", "100cm", "2.5kg", etc.
export const spellCheckRuleFilterUnits: SpellCheckRuleFilter = lint => {
    const {text, breakingRuleKind} = lint;

    // Only filter spelling rules, not other rule types
    if (breakingRuleKind !== "spelling") {
        return true;
    }

    // Pattern for number + unit (e.g., "5s", "10m", "100cm", "2.5kg")
    // Matches: optional digits, optional decimal point, digits, unit letters
    const unitPattern = /^\d*\.?\d+[a-zA-Z]+$/;

    if (unitPattern.test(text)) {
        return false;
    }

    return true;
};
