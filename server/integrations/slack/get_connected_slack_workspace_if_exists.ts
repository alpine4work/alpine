import {ServerActionContext} from "~/server/context/server_action_context.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SlackWorkspace} from "~/shared/integrations/slack/slack_space_integration_schema.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";

/**
 * Gets the Slack integration for a space with the workspace details and bot credentials, if one
 * exists.
 *
 * Currently we expect exactly one Slack workspace to be connected to a space and this
 * will throw if there are multiple Slack workspaces connected to the space.
 */
export async function getConnectedSlackWorkspaceIfExists(
    context: ServerActionContext,
    {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId?: string},
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<SlackWorkspace | null> {
    await authorizeSpaceAccess(context, spaceId);

    const slackWorkspaceIntegrationItems = await arrayFromAsyncIterable(
        IntegrationsTable.query(context, {
            partitionKey: {
                partitionType: "SlackSpaceIntegration",
                spaceId,
            },
            startSortKey: {
                sortRangeType: "SlackWorkspace",
                workspaceId: workspaceId ?? minLabelString,
            },
            endSortKey: {
                sortRangeType: "SlackWorkspace",
                workspaceId: workspaceId ?? maxLabelStringForDynamoKeyAttribute,
            },
            limit: "All",
            consistency,
        }),
    );

    assert(
        slackWorkspaceIntegrationItems.length <= 1,
        "Multiple Slack workspaces found for the same space",
    );

    if (slackWorkspaceIntegrationItems.length === 0) {
        return null;
    }

    return slackWorkspaceIntegrationItems[0] ?? null;
}
