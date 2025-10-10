import {authorizeInternalAccess} from "~/server/accounts/accounts_actions.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {internalDangerouslyCreateWelcomeChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_welcome_channel_transaction_entries.js";
import {getCreateSpaceTransactionEntries} from "~/server/spaces/internal/get_create_space_transaction_entries.js";
import {
    addSpaceAccountWithoutAuthorization,
    createSpaceModelFromItem,
} from "~/server/spaces/spaces_actions.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types.js";

export async function createSpace(
    context: ServerSessionActionContext,
    {
        name,
    }: {
        name: string;
    },
) {
    const accountId = context.actor.getAccountId();

    return actuallyCreateSpace(context, {
        name,
        ownerAccountId: accountId,
    });
}

export async function internalDangerouslyCreateSpaceForAccountAsAdmin(
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
) {
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
) {
    const name = originalName.trim().replace(/\s+/g, " ");
    if (name.length > 50) {
        throw new InvalidArgumentError("Space name cannot be more than 50 characters", {
            displayMessage: errorDisplayMessage`The space name cannot be more than 50 characters`,
        });
    }

    const spaceId = givenSpaceId || generateId<SpaceId>();
    const welcomeChannelId = givenWelcomeChannelId || generateId<ChannelId>();
    const createdTime = new Date();

    const createWelcomeChannelTransactionEntries =
        internalDangerouslyCreateWelcomeChannelTransactionEntries(context, {
            ownerAccountId,
            spaceId,
            welcomeChannelId,
            createdTime,
        });

    const {newItem: space, transactionEntries: createSpaceTransactionEntries} =
        getCreateSpaceTransactionEntries({
            spaceId,
            name,
            createdTime,
        });

    await DynamoTableSchema.executeTransaction(context, [
        ...createSpaceTransactionEntries,
        ...createWelcomeChannelTransactionEntries,
    ]);

    // NOTE(imjoshin): The "addSpaceAccount" logic is isolated in a single function, and requires
    // existence of a space. We should have this step added to the transaction execution above,
    // but that would require a significant refactor of the "addSpaceAccount" logic. The end
    // result of this could be some memberless spaces. The user will have the same experience
    // when an error occurs.
    await addSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId: ownerAccountId,
        role: "Owner",
    });

    return createSpaceModelFromItem({
        ...space,
        // No need to fetch the avatars, we know they're null on a new space.
        avatars: {
            lightTheme: null,
            darkTheme: null,
        },
    });
}
