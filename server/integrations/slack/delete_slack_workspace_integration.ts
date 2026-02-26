import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {IntegrationsTable} from "~/server/integrations/internal/integrations_table.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {parallelProcessAsyncIterable} from "~/shared/helpers/iterable/parallel_process_async_iterable.js";
import {getMaxId, getMinId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Deletes the Slack integration for a space along with the associated bot and users previously
 * connected to the Slack workspace. This function will throw an error if the space does not have a
 * Slack workspace connected or the actor does not have admin access to the space.
 *
 * This function only removes the integration from our database and does not uninstall the Alpine
 * Slack app from the linked workspace. Ensure you call `uninstallSlackAppFromWorkspace` if this
 * is not being called in response to a user manually uninstalling the app.
 */
export async function deleteSlackWorkspaceIntegration(
    context: ServerAccountActionContext,
    {spaceId, workspaceId}: {spaceId: SpaceId; workspaceId: string},
): Promise<void> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    // Delete the workspace integration item and bot credentials first so additional users can't
    // connect to the workspace after we delete the user links.
    const transactionEntries = [
        IntegrationsTable.transactionDeleteItemWithKey({
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackWorkspace",
            spaceId,
            workspaceId,
        }),
        IntegrationsTable.transactionDeleteItemWithKey({
            partitionType: "SlackSpaceIntegration",
            sortRangeType: "SlackWorkspaceBot",
            spaceId,
            workspaceId,
        }),
    ];

    await DynamoTableSchema.executeTransaction(context, transactionEntries);

    // Delete all of the linked Slack accounts. This is not a part of the transaction above because
    // we may have more than 25 linked accounts, and DynamoDB has a transaction action limit of 25.
    // It is possible we could end up with an orphaned Slack user record if a delete fails, but
    // this should be rare and shouldn't affect the user.
    await parallelProcessAsyncIterable(
        IntegrationsTable.query(context, {
            partitionKey: {partitionType: "SlackSpaceIntegration", spaceId},
            startSortKey: {
                sortRangeType: "SlackUser",
                workspaceId,
                accountId: getMinId<AccountId>(),
            },
            endSortKey: {
                sortRangeType: "SlackUser",
                workspaceId,
                accountId: getMaxId<AccountId>(),
            },
            limit: "All",
            consistency: "Strong",
        }),
        async user => {
            // We expect the key to exist since we just read it from the database with strong
            // consistency, but if it was deleted for some reason between reading it and now,
            // that's ok. We can just continue since we wanted to delete it anyway.
            await IntegrationsTable.deleteItemWithKeyIfExists(context, {
                partitionType: "SlackSpaceIntegration",
                sortRangeType: "SlackUser",
                spaceId,
                workspaceId,
                accountId: user.accountId,
            });
            await context.notificationsInjection.notifyInboxOfSlackIntegrationChange({
                eventType: "disconnectSlackAccount",
                spaceId,
                workspaceId,
                accountId: user.accountId,
            });
        },
    );
}
