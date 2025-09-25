import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoGeneralRealtimeTableSchema} from "~/server/dynamo/core/general_realtime/dynamo_general_realtime_table_schema.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {SpellCheckIgnoredLintSchema} from "~/shared/spell_check/spell_check_schema.js";

export async function createSpellCheckIgnoredLintModelFromItem(
    context: ServerActionContext,
    item: {
        readonly createdTime: Date;
        readonly creatorId: AccountId;
        readonly key: string;
        readonly kind: string;
    },
): Promise<SpellCheckIgnoredLintModel> {
    return new SpellCheckIgnoredLintModel({
        createdTime: item.createdTime,
        creatorId: item.creatorId,
        key: item.key,
        kind: item.kind,
    });
}

export const SpellCheckTable = DynamoGeneralRealtimeTableSchema.new({
    // Enable optional features we use that may incur extra costs.
    features: {
        realtimeQuery: {IgnoredLint: true},
    },
    name: "SpellCheck",
    partitions: [
        {
            name: "IgnoredLint",
            partitionKeyAttributes: {
                spellCheckEntityId: DynamoKeyAttributeSchema.labelString<SpellCheckEntityId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {
                        key: DynamoKeyAttributeSchema.labelString(),
                        kind: DynamoKeyAttributeSchema.labelString(),
                    },
                    attributes: SpellCheckIgnoredLintSchema,
                },
            ],
        },
    ],
    modelSchema: SpellCheckIgnoredLintModel.schema(),
    models: {
        IgnoredLint: {
            Attributes: {
                build: (context, item) => createSpellCheckIgnoredLintModelFromItem(context, item),
            },
        },
    },
    // TODO: implement
    broadcastEventTransaction: async () => {},
});
