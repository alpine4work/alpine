import {authorizeInternalAccess} from "~/server/accounts/authorize_internal_access.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {createSpaceWelcomePackageTransactionEntries} from "~/server/spaces/create/internal/create_space_welcome_package_transaction_entries.js";
import {createSpaceModelFromItem} from "~/server/spaces/internal/create_space_model_from_item.js";
import {dangerouslyApplySpaceWelcomePackage} from "~/server/spaces/internal/dangerously_apply_space_welcome_package.js";
import {getAddSpaceAccountTransactionEntries} from "~/server/spaces/internal/get_add_space_account_transaction_entries.js";
import {SpaceItem, SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
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
    }: {
        name: string;
        ownerAccountId: AccountId;
        spaceId?: SpaceId;
    },
): Promise<SpaceModel> {
    await authorizeInternalAccess(context);

    return actuallyCreateSpace(context, {
        name,
        ownerAccountId,
        spaceId,
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
    context: ServerActionContext,
    {
        name: originalName,
        ownerAccountId,
        spaceId: givenSpaceId,
    }: {
        name: string;
        ownerAccountId: AccountId;
        spaceId?: SpaceId;
    },
): Promise<SpaceModel> {
    const name = originalName.trim().replace(/\s+/g, " ");
    if (name.length > 50) {
        throw new InvalidArgumentError("Space name cannot be more than 50 characters", {
            displayMessage: errorDisplayMessage`Name is too long. Try a name that’s less than 50 characters.`,
        });
    }

    const spaceId = givenSpaceId ?? generateId<SpaceId>();

    const spaceItem = await context.dynamo.retryTransaction(async context => {
        const currentTime = new Date();

        const [
            {transactionEntries: addSpaceAccountTransactionEntries},
            {welcomePackageItem, transactionEntries: welcomePackageTransactionEntries},
        ] = await runAllPromises([
            getAddSpaceAccountTransactionEntries(context, {
                currentTime,
                space: {type: "New", id: spaceId},
                account: {type: "Existing", id: ownerAccountId},
                role: "Owner",
            }),
            createSpaceWelcomePackageTransactionEntries(context, {
                currentTime,
                ownerAccountId,
                spaceId,
            }),
        ]);

        const createSpaceTransactionEntry = SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
            name,
            createdTime: currentTime,
        });

        const spaceItem: SpaceItem = {
            ...createSpaceTransactionEntry.newItem,
            avatars: {darkTheme: null, lightTheme: null},
        };

        await runAllPromises([
            DynamoTableSchema.executeTransaction(context, [
                createSpaceTransactionEntry,
                ...addSpaceAccountTransactionEntries,
                ...welcomePackageTransactionEntries,
            ]),

            // Faster to add affinity points separately from our create space transaction.
            // We don't care if there are some affinity point items floating around for a
            // space that doesn't exist.
            dangerouslyApplySpaceWelcomePackage(context, {
                accountId: ownerAccountId,
                welcomePackageItem,
                // New space so there are no suggested accounts.
                suggestedAccountIds: [],
            }),
        ]);

        return spaceItem;
    });

    return createSpaceModelFromItem(spaceItem);
}
