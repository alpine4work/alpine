import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {RynamoTableSchema} from "~/server/dynamo/core/rynamo/rynamo_table_schema.js";
import {TokenServiceName} from "~/server/tokens/token_service_name.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {
    SpellCheckEntityId,
    parseSpellCheckEntityId,
} from "~/shared/spell_check/spell_check_entity_id.js";
import {
    SpellCheckIgnoredLintModel,
    SpellCheckIgnoredLintRealtimeTransactionSchema,
} from "~/shared/spell_check/spell_check_model.js";
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

export const SpellCheckTable = RynamoTableSchema.new({
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
    broadcastEventTransaction: async (context, eventTransaction) => {
        const eventTransactionBySpellCheckEntityId = new Map<
            SpellCheckEntityId,
            Array<RynamoEvent<SpellCheckIgnoredLintModel>>
        >();

        await runAllPromises(
            mapIterable(eventTransaction, async ({itemKey, getEvent}) => {
                const event = await getEvent(context);

                getOrSetDefaultMapValue(
                    eventTransactionBySpellCheckEntityId,
                    itemKey.spellCheckEntityId,
                    () => [],
                ).push(event);
            }),
        );

        await runAllPromises(
            Array.from(
                eventTransactionBySpellCheckEntityId,
                async ([spellCheckEntityId, eventTransaction]) => {
                    const parsedSpellCheckEntityId = parseSpellCheckEntityId(spellCheckEntityId);
                    const type = parsedSpellCheckEntityId.type;
                    let serviceName: TokenServiceName | null = null;
                    let url: `/api/durable-objects/${string}` | null = null;
                    let route: `/api/durable-objects/${string}` | null = null;

                    switch (type) {
                        case "Document": {
                            serviceName = "DocumentCollaborationService";
                            url = `/api/durable-objects/documents/${parsedSpellCheckEntityId.documentId}/broadcast-spell-check-realtime-event-transaction`;
                            route =
                                "/api/durable-objects/documents/:documentId/broadcast-spell-check-realtime-event-transaction";
                            break;
                        }
                        case "Task": {
                            serviceName = "TaskNotesCollaborationService";
                            // TODO(#ignore-lints) create new endpoint
                            url = `/api/durable-objects/task-notes/${parsedSpellCheckEntityId.taskId}`;
                            route = "/api/durable-objects/task-notes/:taskId";
                            break;
                        }
                        default:
                            exhaustive(type);
                    }

                    await context.edge.broadcastToDurableObject(assertExists(url), {
                        serviceName: assertExists(serviceName),
                        route: assertExists(route),
                        body: SpellCheckIgnoredLintRealtimeTransactionSchema.serialize({
                            eventTransaction,
                        }),
                    });
                },
            ),
        );
    },
});
