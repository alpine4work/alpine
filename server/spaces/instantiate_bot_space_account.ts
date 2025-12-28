import {createAccountTransactionEntries} from "~/server/accounts/create_account_transaction_entries.js";
import {getBotWithAvatar} from "~/server/bots/bots_table.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoTransactionCancelledExceptionByConditionCheckError} from "~/server/dynamo/core/is_dynamo_transaction_cancelled_exception_by_condition_check_error.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Creates an account for a bot in a space. You must be an admin in the space
 * to instantiate a bot account in a space. Each bot can only be instantiated
 * once per space.
 */
export async function instantiateBotSpaceAccount(
    context: ServerActionContext,
    {
        spaceId,
        botId,
        accountId = generateId<AccountId>(),
    }: {
        spaceId: SpaceId;
        botId: BotId;
        accountId?: AccountId;
    },
): Promise<{accountId: AccountId; name: string}> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    const currentTime = new Date();
    let bot;

    try {
        let transactionEntries;
        ({bot, transactionEntries} =
            await internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries(context, {
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
            throw new FailedPreconditionError("Can’t instantiate bot twice in the same space");
        }
    }

    return {accountId, name: bot.name};
}

/**
 * Create the transaction entries for instantiating a bot account in a space.
 * Does not check that you’re the owner of the space. You must perform
 * authorization yourself.
 *
 * Useful when creating a new space where no permissions are set up yet.
 */
export async function internalDangerouslyCreateInstantiateBotSpaceAccountTransactionEntries(
    context: ServerActionContext,
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
): Promise<{bot: {name: string}; transactionEntries: Array<DynamoTransactionEntry>}> {
    const bot = await getBotWithAvatar(context, botId, {consistency: "Strong"});

    return {
        bot,
        transactionEntries: [
            ...createAccountTransactionEntries({
                currentTime,
                id: accountId,
                name: bot.name,
                dangerouslyInstantiateBot: {
                    botId,
                    spaceId,
                    avatar:
                        bot.avatar && bot.avatar.avatarId && bot.avatar.content
                            ? {
                                  avatarId: bot.avatar.avatarId,
                                  content: bot.avatar.content,
                              }
                            : null,
                },
            }),

            // Make sure there's only one bot account per space. Also lets us conveniently
            // query for all the spaces a bot is in.
            SpacesTable.transactionCreateItem({
                partitionType: "Bot",
                sortRangeType: "Space",
                botId,
                spaceId,
                accountId,
            }),

            // It's safe to use create-or-replace because we're creating the account in
            // this transaction so we know there won't be another item for the account.
            SpacesTable.transactionCreateOrReplaceItem(
                {
                    partitionType: "Space",
                    sortRangeType: "Account",
                    spaceId,
                    accountId,
                    role: "Member",
                    addedTime: currentTime,
                    state: {type: "Active"},
                    // Include the `BotId` in the space account item so we can quickly check if a
                    // space account is a bot.
                    botId,
                },
                {
                    onAfterTransactionExecutedSuccessfully: () => {
                        // When an account is added to a space, index the account in the space so it
                        // can be searched.
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
            ),

            // The bot account should only ever be in this one space. But for completeness
            // we still create the `Spaces` item for the bot account.
            //
            // It's safe to use create-or-replace because we're creating the account in
            // this transaction so we know there won't be another item for the account.
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
