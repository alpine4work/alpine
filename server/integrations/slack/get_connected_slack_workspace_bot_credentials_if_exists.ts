import {ServerActionContext} from "~/server/context/server_action_context.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Gets the bot credentials for the Slack workspace connected to the space, if one
 * exists. Will throw if there are multiple Slack workspace bot credentials for the
 * same space, as currently we expect only one workspace per space.
 *
 * Does not get the workspace details, use `getConnectedSlackWorkspaceIfExists` to
 * get both.
 */
export async function getConnectedSlackWorkspaceBotCredentialsIfExists(
    context: ServerActionContext,
    {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId?: string},
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
) {
    await authorizeSpaceAccess(context, spaceId);

    const items = await parallelMapAsyncIterableToArray(
        IntegrationsTable.query(context, {
            partitionKey: {
                partitionType: "SlackSpaceIntegration",
                spaceId,
            },
            startSortKey: {
                sortRangeType: "SlackWorkspaceBot",
                workspaceId: workspaceId ?? minLabelString,
            },
            endSortKey: {
                sortRangeType: "SlackWorkspaceBot",
                workspaceId: workspaceId ?? maxLabelStringForDynamoKeyAttribute,
            },
            limit: "All",
            consistency,
        }),
        async item => ({
            workspaceId: item.workspaceId,
            botToken: item.botToken,
            botUserId: item.botUserId,
        }),
    );

    assert(items.length <= 1, "Multiple Slack workspace bot credentials found for the same space");

    return items[0] ?? null;
}
