import {authorizeInternalAccess} from "~/server/accounts/accounts_actions.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {internalDangerouslyCreateWelcomeChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_welcome_channel_transaction_entries.js";
import {createSpaceModelFromItem} from "~/server/spaces/internal/create_space_model_from_item.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {getCreateSpaceTransactionEntries} from "~/server/spaces/internal/get_create_space_transaction_entries.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export async function createSpace(
    context: ServerSessionActionContext,
    {
        name,
    }: {
        name: string;
    },
): Promise<SpaceModel> {
    const accountId = context.actor.getAccountId();

    return actuallyCreateSpace(context, {
        name,
        ownerAccountId: accountId,
    });
}

export async function createSpaceForAccountAsAdmin(
    context: ServerSessionActionContext,
    {
        name,
        ownerAccountId,
        spaceId,
        welcomeChannelId,
    }: {
        name: string;
        ownerAccountId: AccountId;
        spaceId?: SpaceId;
        welcomeChannelId?: ChannelId;
    },
): Promise<SpaceModel> {
    await authorizeInternalAccess(context);

    return actuallyCreateSpace(context, {
        name,
        ownerAccountId,
        spaceId,
        welcomeChannelId,
    });
}

/**
 * Creates a space and adds the given user as the `Owner` of the space.
 * This creates all resources associated with a new account, including:
 *
 * - A Welcome channel
 * - Starter tasks for the user
 */
async function actuallyCreateSpace(
    context: ServerSessionActionContext,
    {
        name: originalName,
        ownerAccountId,
        spaceId: givenSpaceId,
        welcomeChannelId: givenWelcomeChannelId,
    }: {
        name: string;
        ownerAccountId: AccountId;
        spaceId?: SpaceId;
        welcomeChannelId?: ChannelId;
    },
): Promise<SpaceModel> {
    const name = originalName.trim().replace(/\s+/g, " ");
    if (name.length > 50) {
        throw new InvalidArgumentError("Space name cannot be more than 50 characters", {
            displayMessage: errorDisplayMessage`Name is too long. Try a name that’s less than 50 characters.`,
        });
    }

    const spaceId = givenSpaceId ?? generateId<SpaceId>();
    const welcomeChannelId = givenWelcomeChannelId ?? generateId<ChannelId>();

    const spaceItem = await context.dynamo.retryTransaction(async context => {
        const {currentTime, transactionEntries: addSpaceAccountTransactionEntries} =
            await getAddSpaceAccountTransactionEntries(context, {
                space: {type: "New", id: spaceId},
                account: {type: "Existing", id: ownerAccountId},
                role: "Owner",
            });

        const createWelcomeChannelTransactionEntries =
            internalDangerouslyCreateWelcomeChannelTransactionEntries(context, {
                ownerAccountId,
                spaceId,
                welcomeChannelId,
                createdTime: currentTime,
            });

        const {newItem: spaceItem, transactionEntries: createSpaceTransactionEntries} =
            getCreateSpaceTransactionEntries({
                spaceId,
                name,
                createdTime: currentTime,
            });

        await DynamoTableSchema.executeTransaction(context, [
            ...createSpaceTransactionEntries,
            ...addSpaceAccountTransactionEntries,
            ...createWelcomeChannelTransactionEntries,
        ]);

        return spaceItem;
    });

    return createSpaceModelFromItem(spaceItem);
}
