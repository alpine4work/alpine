import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";

/**
 * Get all of the session actor's inboxes for all the spaces they're in. Inboxes
 * are stored in the same DynamoDB partition so it's one DynamoDB query to load
 * them all.
 *
 * You must provide a list of the account's `SpaceId`s so we can filter out inboxes
 * for spaces the actor has lost access to.
 */
export async function getOurAccountInboxes(
    context: ServerSessionActionContext,
    spaceIds: ReadonlySet<SpaceId>,
    options: {consistency?: DynamoReadConsistency} = {consistency: "Eventual"},
): Promise<ReadonlyArray<RynamoItem<InboxModel>>> {
    const inboxes = await parallelMapAsyncIterableToArray(
        InboxTable.query(context, {
            partitionKey: {partitionType: "Account", accountId: context.actor.getAccountId()},
            startSortKey: {
                sortRangeType: "InboxAttributes",
                spaceId: DynamoKeyAttributeSchema.id.getMinValue<SpaceId>(),
            },
            endSortKey: {
                sortRangeType: "InboxAttributes",
                spaceId: DynamoKeyAttributeSchema.id.getMaxValue<SpaceId>(),
            },
            limit: "All",
            consistency: options.consistency,
        }),
        async item => {
            // Confirm the account is still a member of this space. If an account is removed
            // from a space we don't clean up their inbox item in case they're re-added.
            if (!spaceIds.has(item.spaceId)) return null;

            return InboxTable.buildRealtimeItem(context, item);
        },
    );

    return inboxes.filter(isNonNullable);
}
