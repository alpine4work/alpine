import {createAccountTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {dangerouslyGetBotWithAvatarWithoutAuthorization} from "~/server/bots/dangerously_get_bot_with_avatar_without_authorization.js";
import {ServerAuthenticatedActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoTransactionCancelledExceptionByConditionCheckError} from "~/server/dynamo/core/is_dynamo_transaction_cancelled_exception_by_condition_check_error.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {authorizeBotOperation} from "~/server/spaces/authorize_bot_operation.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {intoBotOwnerEntityId} from "~/shared/bots/owners/bot_owner_entity.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError} from "~/shared/error/error.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Creates an account for a bot in a space, which "installs" a bot into the space.
 * Each bot can only be installed once per space.
 *
 * See `authorizeBotOperation()` for who may install which bots.
 */
export async function installBotInSpace(
    context: ServerAuthenticatedActionContext,
    {
        spaceId,
        botId,
        accountId = generateId<AccountId>(),
    }: {
        spaceId: SpaceId;
        botId: BotId;
        accountId?: AccountId;
    },
): Promise<AccountModel> {
    await authorizeBotOperation(context, botId, {type: "Install", spaceId});

    const currentTime = new Date();
    let account: AccountModel;

    try {
        let transactionEntries;
        ({account, transactionEntries} =
            await internalDangerouslyCreateInstallBotInSpaceTransactionEntries(context, {
                currentTime,
                spaceId,
                botId,
                accountId,
            }));

        await DynamoTableSchema.executeTransaction(context, transactionEntries);
    } catch (error) {
        if (!isDynamoTransactionCancelledExceptionByConditionCheckError(error, 1)) {
            throw error;
        } else {
            throw new FailedPreconditionError("Bot has already been installed in this space");
        }
    }

    return account;
}

/**
 * Create the transaction entries for installing a bot account in a space. Does not
 * check that you're the owner of the space.
 *
 * IMPORTANT: You must perform authorization yourself.
 *
 * Useful when creating a new space where no permissions are set up yet.
 */
export async function internalDangerouslyCreateInstallBotInSpaceTransactionEntries(
    context: Context<DynamoContextModules & {jobs: JobsContextModule; cache: CacheContextModule}>,
    {
        currentTime,
        spaceId,
        botId,
        accountId,
    }: {
        currentTime: Date;
        spaceId: SpaceId;
        botId: BotId;
        accountId: AccountId;
    },
): Promise<{
    bot: {name: string};
    account: AccountModel;
    transactionEntries: Array<DynamoTransactionEntry>;
}> {
    const bot = await dangerouslyGetBotWithAvatarWithoutAuthorization(context, botId, {
        consistency: "StrongWithinCache",
    });

    const {account: accountWithoutSpace, transactionEntries} = createAccountTransactionEntries({
        currentTime,
        id: accountId,
        name: bot.name,
        dangerouslyInstantiateBot: {
            botId,
            spaceId,
            // Copied onto the account so that reading a bot account tells you who the bot
            // belongs to without reading the bot. See `accounts_table.ts`.
            ownerEntity: intoBotOwnerEntityId(bot.ownerEntity),
            avatar:
                bot.avatar && bot.avatar.avatarId && bot.avatar.content
                    ? {
                          avatarId: bot.avatar.avatarId,
                          content: bot.avatar.content,
                      }
                    : null,
        },
    });

    // It's safe to use create-or-replace because we're creating the account in this
    // transaction so we know there won't be another item for the account.
    const createSpaceAccountTransactionEntry = SpacesTable.transactionCreateOrReplaceItem(
        {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
            role: "Member",
            addedTime: currentTime,
            state: {type: "Active", activatedTime: currentTime},
            // Include the `BotId` in the space account item so we can quickly check if a space
            // account is a bot.
            botId,
        },
        {
            onAfterTransactionExecutedSuccessfully: () => {
                // When an account is added to a space, index the account in the space so it can be
                // searched.
                context.jobs.send({
                    type: "IndexSearchEntity",
                    spaceId,
                    update: {
                        type: "Account",
                        accountId,
                        updatedTraits: {type: "Some", traits: []},
                    },
                });
            },
        },
    );

    const account = createAccountModelFromItem(
        {...createSpaceAccountTransactionEntry.newItem, accountAvatarOverride: null},
        accountWithoutSpace,
    );

    return {
        bot,
        account,
        transactionEntries: [
            ...transactionEntries,

            // Make sure there's only one bot account per space. Also lets us conveniently
            // query for all the spaces a bot is in.
            SpacesTable.transactionCreateItem({
                partitionType: "Bot",
                sortRangeType: "Space",
                botId,
                spaceId,
                accountId,
            }),

            createSpaceAccountTransactionEntry,

            // The bot account should only ever be in this one space. But for completeness we
            // still create the `Spaces` item for the bot account.
            //
            // It's safe to use create-or-replace because we're creating the account in this
            // transaction so we know there won't be another item for the account.
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds: new Set([spaceId]),
                invitePendingSpaceIds: new Set(),
            }),
        ],
    };
}
