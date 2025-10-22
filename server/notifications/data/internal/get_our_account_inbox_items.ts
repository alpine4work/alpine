import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {InboxAttributesItem, InboxTable} from "~/server/notifications/data/internal/inbox_table.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get all of the session actor's raw inbox items for all the spaces they're in.
 * This acts just like `getOurAccountInboxes` but returns the inbox items instead of
 * constructing inbox models. These inbox items should be converted to inbox models using
 * `InboxTable.buildRealtimeItem` before being sent to the client.
 *
 * You must provide a list of the account's `SpaceId`s so we can filter out
 * inboxes for spaces the actor has lost access to.
 */
export async function getOurAccountInboxItems(
    context: ServerSessionActionContext,
    spaceIds: ReadonlySet<SpaceId>,
    options: {consistency?: DynamoReadConsistency} = {consistency: "Eventual"},
): Promise<ReadonlyArray<InboxAttributesItem>> {
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
            // Confirm the account is still a member of this space. If an account is
            // removed from a space we don't clean up their inbox item in case they're
            // re-added.
            if (!spaceIds.has(item.spaceId)) return null;

            return item;
        },
    );

    return inboxes.filter(isNonNullable);
}
