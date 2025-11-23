import {spellCheckRuleFilterAllCaps} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_all_caps.js";
import {spellCheckRuleFilterBasicMath} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_basic_math.js";
import {spellCheckRuleFilterCustomDictionary} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_custom_dictionary.js";
import {spellCheckRuleFilterMiscGrammar} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_misc_grammar.js";
import {spellCheckRuleFilterUnits} from "~/client/web/content/internal/spell_check_rule_filter/spell_check_rule_units.js";

export type SpellCheckRuleFilterLint = {
    text: string;
    breakingRuleKind: string;
    suggestions: Array<{kind: "replace" | "remove" | "insertafter"; text: string}>;
};

export type SpellCheckRuleFilter = (lint: SpellCheckRuleFilterLint) => boolean;

// Harper doesn't support custom lint rules out of the box, so we have to manually
// filter our lints after running the linter. Someday we should consider contributing
// this feature back to Harper.
export const spellCheckRuleFilter: SpellCheckRuleFilter = lint => {
    return [
        spellCheckRuleFilterCustomDictionary,
        spellCheckRuleFilterAllCaps,
        spellCheckRuleFilterBasicMath,
        spellCheckRuleFilterUnits,
        spellCheckRuleFilterMiscGrammar,
    ].every(fn => fn(lint));
};
