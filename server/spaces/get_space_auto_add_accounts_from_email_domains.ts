import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Get the email domains we auto-add accounts to this space from.
 */
export async function getSpaceAutoAddAccountsFromEmailDomains(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Array<{emailDomain: string; isEnabled: boolean}>> {
    await authorizeSpaceAccess(context, spaceId);

    const items = await parallelMapAsyncIterableToArray(
        SpacesTable.query(context, {
            limit: "All",
            consistency,
            partitionKey: {
                partitionType: "Space",
                spaceId,
            },
            startSortKey: {
                sortRangeType: "AutoAddAccountsFromEmailDomain",
                emailDomain: minLabelString,
            },
            endSortKey: {
                sortRangeType: "AutoAddAccountsFromEmailDomain",
                emailDomain: maxLabelStringForDynamoKeyAttribute,
            },
        }),
        async item => {
            const actualItem = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "AutoAddAccountsFromEmailDomain",
                    sortRangeType: "Space",
                    emailDomain: item.emailDomain,
                },
                {consistency},
            );

            if (!actualItem) return null;

            return {
                emailDomain: actualItem.emailDomain,
                isEnabled: actualItem.isEnabled,
            };
        },
    );

    return items.filter(isNonNullable);
}
