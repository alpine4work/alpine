import {
    createRynamoBackfillResultSchema,
    createRynamoEventSchema,
    createRynamoQuerySchema,
} from "~/shared/dynamo/rynamo_types.js";
import {defineRpc} from "~/shared/rpc/internal/define_rpc.js";
import {Schema} from "~/shared/schema/schema.js";
import {SpellCheckEntityIdSchema} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {ServerSynchronizationCheckpointSchema} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export const getSpellCheckIgnoredLints = defineRpc({
    name: "getSpellCheckIgnoredLints",
    isIdempotent: true,
    input: {
        entityId: SpellCheckEntityIdSchema,
    },
    output: {
        spellCheckIgnoredLints: createRynamoQuerySchema(SpellCheckIgnoredLintModel.schema()),
    },
});

export const backfillSpellCheckIgnoredLints = defineRpc({
    name: "backfillSpellCheckIgnoredLints",
    isIdempotent: true,
    input: {
        entityId: SpellCheckEntityIdSchema,
        checkpoint: ServerSynchronizationCheckpointSchema,
    },
    output: {
        result: createRynamoBackfillResultSchema(SpellCheckIgnoredLintModel.schema()),
    },
});

export const createSpellCheckIgnoredLint = defineRpc({
    name: "createSpellCheckIgnoredLint",
    // Throws an error if the line already exists.
    isIdempotent: false,
    input: {
        entityId: SpellCheckEntityIdSchema,
        key: Schema.string,
        kind: Schema.string,
    },
    output: {
        events: Schema.array(createRynamoEventSchema(SpellCheckIgnoredLintModel.schema())),
    },
});
