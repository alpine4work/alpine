import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckEntityIdSchema} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintSchema} from "~/shared/spell_check/spell_check_schema.js";

export const getSpellCheckIgnoredLints = defineRpc({
    name: "getSpellCheckIgnoredLints",
    input: {
        spellCheckEntityId: SpellCheckEntityIdSchema,
    },
    output: {
        ignoredLints: Schema.array(SpellCheckIgnoredLintSchema),
    },
});

export const createSpellCheckIgnoredLint = defineRpc({
    name: "createSpellCheckIgnoredLint",
    input: {
        spellCheckEntityId: SpellCheckEntityIdSchema,
        key: Schema.string,
        kind: Schema.string,
    },
    output: {},
});
