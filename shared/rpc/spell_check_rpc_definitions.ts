import {
    createDynamoGeneralRealtimeBackfillResultSchema,
    createDynamoGeneralRealtimeEventSchema,
    createDynamoGeneralRealtimeQuerySchema,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckEntityIdSchema} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

export const getSpellCheckIgnoredLints = defineRpc({
    name: "getSpellCheckIgnoredLints",
    input: {
        entityId: SpellCheckEntityIdSchema,
    },
    output: {
        spellCheckIgnoredLints: createDynamoGeneralRealtimeQuerySchema(
            SpellCheckIgnoredLintModel.schema(),
        ),
    },
});

export const backfillSpellCheckIgnoredLints = defineRpc({
    name: "backfillSpellCheckIgnoredLints",
    input: {
        entityId: SpellCheckEntityIdSchema,
        readTime: Schema.date,
    },
    output: {
        result: createDynamoGeneralRealtimeBackfillResultSchema(
            SpellCheckIgnoredLintModel.schema(),
        ),
    },
});

export const createSpellCheckIgnoredLint = defineRpc({
    name: "createSpellCheckIgnoredLint",
    input: {
        entityId: SpellCheckEntityIdSchema,
        key: Schema.string,
        kind: Schema.string,
    },
    output: {
        eventTransaction: Schema.array(
            createDynamoGeneralRealtimeEventSchema(SpellCheckIgnoredLintModel.schema()),
        ),
        readTime: Schema.date,
    },
});
