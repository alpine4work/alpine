import _Fuse from "fuse.js";
import {
    AccountDevice,
    checkAccountVersionConditionCheck,
    createAccountTransactionEntry,
    createAccountWithEmailAddressTransactionEntries,
    dangerouslyGetAccountIfExistsWithoutAuthorization,
    dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization,
    getAccountIdByEmailAddressIfExists,
    internalGetLatestEmailAddressByAccountIdWithoutAuthorization,
    internalGetRegisteredAccountDevicesWithoutAuthorization,
    pickRandomReactionCharacterForAccount,
} from "~/server/accounts/accounts_actions.js";
import {getBot} from "~/server/bots/bots_table.js";
import {SearchInjectionContextModule} from "~/server/context/injection_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSessionActionContextWithEmail,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextCache} from "~/server/dynamo/core/dynamo_context_cache.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {isDynamoTransactionCancelledExceptionByConditionCheckError} from "~/server/dynamo/core/is_dynamo_transaction_cancelled_exception_by_condition_check_error.js";
import {EmailAddress, validateEmailAddress} from "~/server/emails/email_address.js";
import {
    ActorContextModule,
    ImpersonatedAccountActorContextModule,
    SessionActorContextModule,
    SystemActorContextModule,
} from "~/server/helpers/actor_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {unauthenticatedSessionError} from "~/server/helpers/unauthenticated_session_error.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {SpacesTable} from "~/server/spaces/internal/spaces_table.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceAndAvatarData,
    AccountModelWithoutSpaceData,
} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {AvatarModel, AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    DataLossError,
    ErrorBase,
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {okResult} from "~/shared/helpers/control/ok_result.js";
import {Result} from "~/shared/helpers/control/result.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {TestCheckpoint} from "~/shared/helpers/test/test_checkpoint.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {generateId, getMaxId, getMinId} from "~/shared/id/id.js";
import {AccountId, AvatarId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {
    AccountModel,
    AccountModelData,
    AccountModelDataSpaceState,
} from "~/shared/spaces/account_model.js";
import {
    SpaceAccountSettings,
    SpaceAccountSettingsSchema,
} from "~/shared/spaces/space_account_settings.js";
import {SpaceAccountState} from "~/shared/spaces/space_account_state.js";
import {createAuthorizeSpaceAccessPermissionDeniedError} from "~/shared/spaces/space_error_messages.js";
import {SpaceModel, SpaceRole, hasSpaceRole} from "~/shared/spaces/space_model.js";

// Node.js ESM interop (#node-esm-migration)
type Fuse<T> = _Fuse.default<T>;
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

type SpaceAttributesItem = DynamoTableItemType<typeof SpacesTable, "Space", "Attributes">;
type SpaceAvatarDarkThemeItem = DynamoTableItemType<typeof SpacesTable, "Space", "AvatarDarkTheme">;
type SpaceAvatarLightThemeItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "AvatarLightTheme"
>;
type SpaceItem = SpaceAttributesItem & {
    readonly avatars: {
        readonly darkTheme: SpaceAvatarDarkThemeItem | null;
        readonly lightTheme: SpaceAvatarLightThemeItem | null;
    };
};

async function getSpaceItem(
    context: DynamoContext,
    spaceId: SpaceId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<SpaceItem> {
    const item = await getSpaceItemIfExists(context, spaceId, options);
    if (!item) throw createSpaceNotFoundError(spaceId);
    return item;
}

function createSpaceNotFoundError(spaceId: SpaceId) {
    return new NotFoundError("Space not found", {
        aggregateDedupeKey: spaceId,
        displayMessage: errorDisplayMessage`This space doesn’t exist.`,
    });
}

async function getSpaceItemIfExists(
    context: DynamoContext,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<SpaceItem | null> {
    const items = await arrayFromAsyncIterable(
        SpacesTable.query(context, {
            limit: 3,
            partitionKey: {
                partitionType: "Space",
                spaceId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "AvatarDarkTheme"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem) return null;

    const darkTheme = findMapIterable(items, item =>
        item.sortRangeType === "AvatarDarkTheme" ? item : undefined,
    );
    const lightTheme = findMapIterable(items, item =>
        item.sortRangeType === "AvatarLightTheme" ? item : undefined,
    );

    return {
        avatars: {
            darkTheme: darkTheme ?? null,
            lightTheme: lightTheme ?? null,
        },
        ...attributesItem,
    };
}

function createAvatarModelFromItem(
    avatarItem:
        | SpaceAvatarDarkThemeItem
        | SpaceAvatarLightThemeItem
        | SpaceAccountAvatarOverrideItem
        | null,
): AvatarModel | null {
    if (!avatarItem) return null;

    return {
        avatarId: avatarItem.avatarId,
        version: avatarItem.updateLockVersion ?? 0,
        content: avatarItem.content,
    };
}

function createSpaceModelFromItem(spaceItem: SpaceItem): SpaceModel {
    return new SpaceModel({
        id: spaceItem.spaceId,
        version: spaceItem.updateLockVersion ?? 0,
        name: spaceItem.name,
        alphaAccessDefaultChannelId: spaceItem.alphaAccessDefaultChannelId,
        avatars: {
            darkTheme: createAvatarModelFromItem(spaceItem.avatars.darkTheme),
            lightTheme: createAvatarModelFromItem(spaceItem.avatars.lightTheme),
        },
    });
}

type SpaceAccountItem = DynamoTableItemType<typeof SpacesTable, "Space", "Account">;
type SpaceAccountAvatarOverrideItem = DynamoTableItemType<
    typeof SpacesTable,
    "Space",
    "AccountAvatarOverride"
>;
type SpaceAccountItemWithAccountAvatarOverride = SpaceAccountItem & {
    readonly accountAvatarOverride: SpaceAccountAvatarOverrideItem | null;
};

type AccountSpacesItem = DynamoTableItemType<typeof SpacesTable, "Account", "Spaces">;

/**
 * Scan every account by space pair in our database. Use when migrating data.
 */
export async function* expensiveScanEverySpaceAccountForMigration(
    context: DynamoContext,
    {segmentIndex, totalSegmentCount}: {segmentIndex: number; totalSegmentCount: number},
): AsyncIterableIterator<{spaceId: SpaceId; accountId: AccountId}> {
    assert(context.tracer.getRoot().serviceName === "MigrationService");

    for await (const item of SpacesTable.expensiveScan(context, {
        segmentIndex,
        totalSegmentCount,
        filter: {partitionType: "Space", sortRangeType: "Account"},
    })) {
        if (item.partitionType !== "Space" || item.sortRangeType !== "Account") continue;

        yield {spaceId: item.spaceId, accountId: item.accountId};
    }
}

/**
 * Create a space in a test environment.
 */
export async function createSpaceForTest(
    context: DynamoContext,
    {id = generateId<SpaceId>(), name}: {id?: SpaceId; name: string},
) {
    assert(process.env.NODE_ENV === "test");

    await SpacesTable.createItem(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId: id,
        name,
        createdTime: new Date(),
    });
}

/**
 * Add an account to a space in a test environment.
 */
export async function addSpaceAccountForTest(
    context: ServerProcessContext,
    {
        spaceId,
        accountId,
        role,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
    },
) {
    assert(process.env.NODE_ENV === "test");

    await addSpaceAccountWithoutAuthorization(
        context.clone({
            cache: CacheContextModule.new(),
            searchInjection: context.searchInjection.cloneForTest({
                // Don't add `TaskPersonal` favorite search entity in our test environment.
                // That would require all server tests taking a dependency on
                // `//server/search/data`.
                dangerouslyFavoriteSearchEntityWithoutAuthorization: asyncNoop,
            }),
        }),
        {
            spaceId,
            accountId,
            role,
        },
    );
}

/**
 * Get a space account in a test environment.
 */
export async function getSpaceAccountForTest(
    context: ServerActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<SpaceAccountItem | null> {
    assert(process.env.NODE_ENV === "test");

    return internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId);
}

export async function seedTestSpaces(
    context: Context<
        DynamoContextModules & {
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, adminAccountId} = getDynamoSeedConstants();

    await SpacesTable.createItemIfNoneExists(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId: defaultSpaceId,
        name: "Test",
        createdTime: new Date(),
    });

    const spaceAccountItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Space",
        sortRangeType: "Account",
        spaceId: defaultSpaceId,
        accountId: adminAccountId,
    });

    if (!spaceAccountItem || spaceAccountItem.state.type !== "Active") {
        try {
            await addSpaceAccountWithoutAuthorization(
                context.clone({cache: CacheContextModule.new()}),
                {
                    spaceId: defaultSpaceId,
                    accountId: adminAccountId,
                    // make default space account as "Owner" since it is the first account in the space.
                    role: "Owner",
                },
            );
        } catch (error) {
            // Ignore account is already a member of space error. Since this means due to a
            // race condition we tried to add the account to the space twice.
            if (
                error instanceof FailedPreconditionError &&
                error.message.includes("Account is already a member of space")
            ) {
                return;
            }

            throw error;
        }
    }
}

export async function seedTestBotAccounts(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, chatGptBotId, chatGptBotAccountIdForDefaultSpace} =
        getDynamoSeedConstants();

    const currentTime = new Date();

    try {
        // TODO(calebmer): It's pretty annoying that this is duplicated from
        // `instantiateBotSpaceAccount()`. I'd like to get rid of all the data seeding
        // code once we have a proper onboarding flow for the product and run that
        // process instead.
        await DynamoTableSchema.executeTransaction(context, [
            createAccountTransactionEntry({
                id: chatGptBotAccountIdForDefaultSpace,
                currentTime,
                name: "ChatGPT",
                dangerouslyInstantiateBot: {
                    botId: chatGptBotId,
                    spaceId: defaultSpaceId,
                },
            }),
            SpacesTable.transactionCreateItem({
                partitionType: "Bot",
                sortRangeType: "Space",
                botId: chatGptBotId,
                spaceId: defaultSpaceId,
                accountId: chatGptBotAccountIdForDefaultSpace,
            }),
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: defaultSpaceId,
                accountId: chatGptBotAccountIdForDefaultSpace,
                role: "Member",
                addedTime: currentTime,
                state: {type: "Active"},
                botId: chatGptBotId,
            }),
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId: chatGptBotAccountIdForDefaultSpace,
                spaceIds: new Set([defaultSpaceId]),
                invitePendingSpaceIds: new Set(),
            }),
        ]);

        context.jobs.send({
            type: "IndexSearchEntity",
            spaceId: defaultSpaceId,
            update: {
                type: "Account",
                accountId: chatGptBotAccountIdForDefaultSpace,
                updatedTraits: {type: "Some", traits: []},
            },
        });
    } catch (error) {
        // If the data already exists in the database, return without error.
        if (isDynamoConditionCheckError(error)) return;

        throw error;
    }
}

/**
 * Add an account to some space. Only space admins may call this method.
 */
export async function addSpaceAccount(
    context: ServerActionContext,
    {
        spaceId,
        accountId,
        role,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
    },
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return addSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId,
        role,
    });
}

/**
 * Remove an account from some space. Only space admins may call this method.
 */
export async function removeSpaceAccount(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount": {
            if (context.actor.getAccountId() === accountId) {
                throw new InvalidArgumentError("Can’t remove your own account from space");
            }
            break;
        }
        case "System":
        case "Anonymous":
        case "Bot":
            break;
        default:
            throw exhaustive(context.actor);
    }

    return removeSpaceAccountWithoutAuthorization(context, {spaceId, accountId});
}

export const addSpaceAccountBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Validates the the given account can be added to the space.
 */
function validateAccountStateForSpaceAddition({
    spaceId,
    account,
    accountSpacesItem,
    spaceAccountItem,
}: {
    spaceId: SpaceId;
    account: AccountModelWithoutSpace | null;
    accountSpacesItem: AccountSpacesItem | null;
    spaceAccountItem: SpaceAccountItem | null;
}) {
    // Bot accounts can only be a member of one space. Don't allow adding a bot
    // account to a new space but it's ok if the bot account was previously a
    // member of the space that was removed. Then it's ok to add the bot account
    // back to the space.
    if (account?.botId && !spaceAccountItem) {
        throw new FailedPreconditionError(
            "Can’t add existing bot account to space, must use `instantiateBotSpaceAccount()` to create a new bot account for the space",
        );
    }

    const accountSpaceIds: Set<SpaceId> = accountSpacesItem
        ? new Set(accountSpacesItem.spaceIds)
        : new Set();

    const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
        ? new Set(accountSpacesItem.invitePendingSpaceIds)
        : new Set();

    if (accountSpaceIds.has(spaceId) || accountInvitePendingSpaceIds.has(spaceId)) {
        // This is an extra check to make sure our spaceIds on the Account#Spaces isn't
        // drifting apart from the source of the truth.
        throw new FailedPreconditionError("Account is already a member of space");
    }

    if (spaceAccountItem) {
        if (spaceAccountItem.state.type !== "Removed") {
            throw new FailedPreconditionError("Account is already a member of space");
        } else if (spaceAccountItem.state.reason !== "ActionByAdmin") {
            throw new FailedPreconditionError("Account cannot be invited to this space.");
        }
    }
}

/**
 * Get transaction entries necessary to add an account to a space.
 * This does not create an account if it doesn't exist.
 */
async function getAddSpaceAccountTransactionEntries({
    spaceItem,
    account,
    newAccountId,
    role,
    spaceAccountItem,
    accountSpacesItem,
    newSpaceAccountState,
}: {
    spaceItem: SpaceAttributesItem;
    role: SpaceRole;
    spaceAccountItem: SpaceAccountItem | null;
    accountSpacesItem: AccountSpacesItem | null;
    newSpaceAccountState: SpaceAccountState;
} & (
    | {
          account: AccountModelWithoutSpace;
          newAccountId?: never;
      }
    | {
          account?: never;
          newAccountId: AccountId;
      }
)) {
    const currentTime = new Date();
    const accountId = newAccountId ?? account.id;

    const accountSpaceIds: Set<SpaceId> = accountSpacesItem
        ? new Set(accountSpacesItem.spaceIds)
        : new Set();

    const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
        ? new Set(accountSpacesItem.invitePendingSpaceIds)
        : new Set();

    let updateOrCreateSpaceAccountItemTransactionEntry;
    let updateOrCreateAccountAvatarOverrideItemTransactionEntry;

    // If the account was previously removed, we should re-add it
    if (spaceAccountItem) {
        // We've already checked this case above. Let's reassert here to make sure
        // our types are correct.
        // NOTE(imjoshin): We only need to do this because we're trying to early-return
        // from the function if the account is already a member of the space.
        assert(spaceAccountItem.state.type === "Removed");
        assert(spaceAccountItem.state.reason === "ActionByAdmin");

        // If there was already a space account item, we need to update it
        // Make sure we're passing `InvitePending` here unless we're adding a bot which
        // will always be added as active.
        //
        // Bots are added back to spaces as `Active` since a bot won't be accepting
        // invites. That'd be silly.
        const expectedNewAccountStateType = account?.botId ? "Active" : "InvitePending";
        assert(newSpaceAccountState.type === expectedNewAccountStateType);

        updateOrCreateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            role,
            // The account was previously a member of the space and is being added back.
            // We don't use newSpaceAccountState here as it's not a new space account
            state: newSpaceAccountState,
        });

        // If the account was previously removed, we should not update the account avatar override
        // item. Maintain the "removed" avatar UX until they re-accept
        updateOrCreateAccountAvatarOverrideItemTransactionEntry = null;
    } else {
        // Can only add bot to space through `instantiateBotSpaceAccount()`.
        assert(!account?.botId);
        const expectedNewAccountStateType = role === "Owner" ? "Active" : "InvitePending";
        assert(newSpaceAccountState.type === expectedNewAccountStateType);

        updateOrCreateSpaceAccountItemTransactionEntry = SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: spaceItem.spaceId,
            accountId,
            role,
            addedTime: currentTime,
            state: newSpaceAccountState,
        });

        // If the account was not previously a member of the space, we need to create an account
        // avatar override item with null content so that the user's avatar does not show up
        // in the space
        updateOrCreateAccountAvatarOverrideItemTransactionEntry = SpacesTable.transactionCreateItem(
            {
                partitionType: "Space",
                sortRangeType: "AccountAvatarOverride",
                spaceId: spaceItem.spaceId,
                accountId,
                avatarId: null,
                content: null,
            },
        );
    }

    await addSpaceAccountBeforeExecuteTestCheckpoint.waitForTest(
        `${spaceItem.spaceId}:${accountId}`,
    );

    const newAccountStateType = updateOrCreateSpaceAccountItemTransactionEntry.newItem.state.type;

    // Only update the account's spaceIDs if the account is being added to the space as Active.
    if (newAccountStateType === "Active") {
        accountSpaceIds.add(spaceItem.spaceId);
    } else if (newAccountStateType === "InvitePending") {
        accountInvitePendingSpaceIds.add(spaceItem.spaceId);
    }

    // Sanity check: Bot accounts should only ever be in a single space and never
    // invited to a space.
    if (account?.botId) {
        assert(accountSpaceIds.size === 1);
        assert(accountInvitePendingSpaceIds.size === 0);
    }

    const shouldAddAccountAvatarOverride =
        newAccountStateType !== "Active" &&
        updateOrCreateAccountAvatarOverrideItemTransactionEntry !== null;
    return {
        transactionEntries: [
            // Since this transaction is security sensitive, make sure the account and
            // space didn't update when we commit. This also makes sure both the space and
            // account exist.
            //
            // If we're adding an owner, force this transaction to be serialized with other
            // add space account `role: "Owner"` transactions.
            role === "Owner"
                ? SpacesTable.transactionDirectlyUpdateItemLockVersion(
                      spaceItem,
                      spaceItem.updateLockVersion,
                  )
                : SpacesTable.transactionUpdateLockVersionConditionCheck(
                      spaceItem,
                      spaceItem.updateLockVersion,
                  ),
            ...(account ? [checkAccountVersionConditionCheck(account)] : []),
            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
            updateOrCreateSpaceAccountItemTransactionEntry,
            ...(shouldAddAccountAvatarOverride
                ? [assertExists(updateOrCreateAccountAvatarOverrideItemTransactionEntry)]
                : []),
        ],
        newItem: {
            ...updateOrCreateSpaceAccountItemTransactionEntry.newItem,
            accountAvatarOverride: shouldAddAccountAvatarOverride
                ? assertExists(updateOrCreateAccountAvatarOverrideItemTransactionEntry?.newItem)
                : null,
        },
    };
}

/**
 * Adds an account to a space without authorizing the actor has permission to
 * add accounts to the space.
 *
 * The added space account will have a "Member" role by default. But we use
 * this function in the test environment to add the accounts with "Admin" role
 * as well.
 *
 * If role is "Owner" we check that there are no other owners in the space,
 * otherwise we throw an error.
 *
 * This is a very very dangerous function! If arbitrary users got the ability
 * to add any user to any space they could easily compromise the data privacy
 * of spaces. You must authorize the actor is allowed to add accounts when
 * calling this function from an exported function.
 */
export async function addSpaceAccountWithoutAuthorization(
    context: Context<
        DynamoContextModules & {
            cache: CacheContextModule;
            jobs: JobsContextModule;
            searchInjection: SearchInjectionContextModule;
        }
    >,
    {
        spaceId,
        accountId,
        role = "Member",
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        role?: SpaceRole;
    },
): Promise<AccountModel> {
    const createdAccount: AccountModel = await context.dynamo.retryTransaction(async context => {
        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId),
            internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!account) {
            throw new NotFoundError("Account not found");
        }

        validateAccountStateForSpaceAddition({
            spaceId,
            account,
            accountSpacesItem,
            spaceAccountItem,
        });

        // Make sure there aren't any other owners in the space.
        //
        // This is race condition safe because of we use
        // `SpacesTable.transactionUpdateLockVersionConditionCheck()` in our
        // transaction to actually add an account. If two calls are racing then the
        // race winner updates the space `updateLockVersion` causing the race loser to
        // retry which will run this query again.
        if (role === "Owner") {
            for await (const otherSpaceAccountItem of SpacesTable.query(context, {
                consistency: "Strong",
                limit: "All",
                partitionKey: {
                    partitionType: "Space",
                    spaceId,
                },
                startSortKey: {
                    sortRangeType: "Account",
                    accountId: getMinId<AccountId>(),
                },
                endSortKey: {
                    sortRangeType: "Account",
                    accountId: getMaxId<AccountId>(),
                },
            })) {
                if (otherSpaceAccountItem.role === "Owner") {
                    throw new FailedPreconditionError("Space already has an owner account");
                }
            }
        }

        const {newItem, transactionEntries} = await getAddSpaceAccountTransactionEntries({
            spaceItem,
            account,
            role,
            spaceAccountItem,
            accountSpacesItem,
            newSpaceAccountState:
                role === "Owner" || spaceAccountItem?.botId
                    ? {type: "Active"}
                    : {
                          type: "InvitePending",
                          invitedTime: new Date(),
                          pendingAccountData: account.initialData,
                          wasPreviouslyRemoved: spaceAccountItem?.state.type === "Removed",
                      },
        });

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        return createAccountModelFromItem(
            newItem,
            newItem.state.type === "Active" ? account : null,
        );
    });

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

    // After we've successfully created the account, run some additional
    // non-critical initialization logic. If any initialization here fails, the
    // account will still be successfully created, but there may be some small
    // issues.
    await context.searchInjection.dangerouslyFavoriteSearchEntityWithoutAuthorization({
        spaceId,
        accountId,
        entityId: "TaskPersonal",
    });

    return createdAccount;
}

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

    const bot = await getBot(context, botId);

    const currentTime = new Date();

    try {
        await DynamoTableSchema.executeTransaction(context, [
            createAccountTransactionEntry({
                id: accountId,
                currentTime,
                name: bot.name,
                dangerouslyInstantiateBot: {
                    botId,
                    spaceId,
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
            SpacesTable.transactionCreateOrReplaceItem({
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
            }),

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
        ]);
    } catch (error) {
        if (!isDynamoTransactionCancelledExceptionByConditionCheckError(error, 1)) {
            throw error;
        } else {
            throw new FailedPreconditionError("Can’t instantiate bot twice in the same space");
        }
    }

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

    return {accountId, name: bot.name};
}

export const removeSpaceAccountBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Removes an account to a space without authorizing the actor has permission to
 * remove accounts from the space.
 */
function removeSpaceAccountWithoutAuthorization(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
): Promise<AccountModel> {
    return context.dynamo.retryTransaction(async context => {
        const currentTime = new Date();

        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            SpacesTable.getItemIfExists(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId),
            internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!spaceItem) throw createSpaceNotFoundError(spaceId);
        if (!account) throw createSpaceAccountNotFoundError();

        // We don't check accountSpaceIds here because we don't add to spaceIds until the user
        // accepts the invite.
        if (!spaceAccountItem || spaceAccountItem.state.type === "Removed") {
            throw new FailedPreconditionError("Account is not a member of the space");
        }

        if (hasSpaceRole(spaceAccountItem.role, "Owner")) {
            throw new FailedPreconditionError("Can’t remove owner from space");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.invitePendingSpaceIds)
            : new Set();

        accountSpaceIds.delete(spaceId);
        accountInvitePendingSpaceIds.delete(spaceId);

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            role: "Member",
            state: {
                type: "Removed",
                removedTime: currentTime,
                oldAccountData: account?.initialData,
                reason: "ActionByAdmin",
            },
        });

        const updateAccountAvatarOverrideTransactionEntry =
            SpacesTable.transactionCreateOrReplaceItem({
                partitionType: "Space",
                sortRangeType: "AccountAvatarOverride",
                spaceId,
                accountId,
                avatarId: account.initialData.avatar?.avatarId ?? null,
                content: account.initialData.avatar?.content ?? null,
                // NOTE(ifitzsimmons, 2025-08-25): When copying over the avatar content to the
                // account avatar override item, we want to increment the version so that the
                // SpaceAccountItem has the most recent avatar version. On the client, this will
                // ensure that the AccountModel merge will use the override version.
                updateLockVersion: (account.initialData.avatar?.version ?? 0) + 1,
            });

        await removeSpaceAccountBeforeExecuteTestCheckpoint.waitForTest(`${spaceId}:${accountId}`);

        await DynamoTableSchema.executeTransaction(context, [
            // Since this transaction is security sensitive, make sure the account and
            // space didn't update when we commit. This also makes sure both the space and
            // account exist.
            SpacesTable.transactionUpdateLockVersionConditionCheck(
                spaceItem,
                spaceItem.updateLockVersion,
            ),
            checkAccountVersionConditionCheck(account),

            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                // update to new accountSpaceIds after removing the space from the account
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
            updateSpaceAccountItemTransactionEntry,
            updateAccountAvatarOverrideTransactionEntry,
        ]);

        // When an account is removed from a space, index the account in the space so it
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

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                accountAvatarOverride: updateAccountAvatarOverrideTransactionEntry.newItem,
            },
            null,
        );
    });
}

/**
 * The minimum number of characters that should be identical to a name in our
 * Fuse.js account name index to consider a match valid. If there's a name in
 * the index that's shorter than this length (e.g. the short name "Vu" of "Vu
 * Tran") then an exact match should be considered valid.
 *
 * Setting a minimum matching character length is important since we use the
 * index for natural language parsing. If the user types "by e" we don't want
 * that to be parsed as "by emily". Instead we want to do a keyword search.
 */
export const accountNameIndexFuseMinMatchCharLength = 4;

/**
 * If we have a Fuse.js score below this when parsing a name then we consider
 * the name a match.
 *
 * We maintain a stricter score cutoff than Fuse.js since we use our index for
 * name parsing in natural language instead of in an autocomplete. That means
 * we need to demand a higher level of correctness.
 */
export const accountNameIndexFuseScoreMatchCutoff = 0.35;

function getAccountAvatarModelForAccountModel(
    item: SpaceAccountItemWithAccountAvatarOverride,
    account: AccountModelWithoutSpace | null,
) {
    switch (item.state.type) {
        case "Active": {
            assert(account !== null);

            // TODO(ifitzsimmons, 2025-08-28, #account-override-avatar-coupling): If there is an
            // accountAvatarOverride item on the space account, we should emit a warning.
            return account.initialData.avatar;
        }
        case "InvitePending":
        case "Removed": {
            if (!item.accountAvatarOverride) {
                // TODO(ifitzsimmons, 2025-08-28, #account-override-avatar-coupling): This is an
                // impossible state. We should emit an error without crashing the app. To avoid
                // app crashes, we overwrite the account avatar with a null avatar if we get into
                // this state.
                return {avatarId: null, content: null, version: 0};
            }

            return createAvatarModelFromItem(item.accountAvatarOverride);
        }
        default:
            throw exhaustive(item.state);
    }
}

function createAccountModelFromItem(
    item: SpaceAccountItemWithAccountAvatarOverride,
    account: AccountModelWithoutSpace | null,
): AccountModel {
    let accountData: AccountModelWithoutSpaceData | AccountModelWithoutSpaceAndAvatarData;

    switch (item.state.type) {
        case "Active": {
            assert(account !== null);
            accountData = account.initialData;
            break;
        }
        case "InvitePending": {
            // If the account is pending, we should use the pending account data that was
            // given when the account was invited.
            assert(account === null);
            accountData = item.state.pendingAccountData;
            break;
        }
        case "Removed": {
            // If the account was removed, we should use the old account data that was
            // present when the account was removed.
            assert(account === null);
            accountData = item.state.oldAccountData;
            break;
        }
        default:
            throw exhaustive(item.state);
    }

    return new AccountModel({
        ...accountData,
        avatar: getAccountAvatarModelForAccountModel(item, account),
        space: {
            version: item.updateLockVersion ?? 0,
            addedTime: item.addedTime,
            state: item.state,
            role: item.role,
        },
    });
}

function createAccountModelDataWithoutAvatarFromItem(
    item: SpaceAccountItem,
    activeAccountData: Omit<AccountModelWithoutSpaceData, "avatar"> | null,
): Omit<AccountModelData, "avatar"> {
    let accountData: AccountModelWithoutSpaceData | AccountModelWithoutSpaceAndAvatarData;
    let spaceAccountState: AccountModelDataSpaceState;

    switch (item.state.type) {
        case "Active": {
            assert(activeAccountData !== null);
            accountData = activeAccountData;
            spaceAccountState = {type: "Active"};
            break;
        }
        case "InvitePending": {
            // If the account is pending, we should use the pending account data that was
            // given when the account was invited.
            assert(activeAccountData === null);
            accountData = item.state.pendingAccountData;
            spaceAccountState = item.state;
            break;
        }
        case "Removed": {
            // If the account was removed, we should use the old account data that was
            // present when the account was removed.
            assert(activeAccountData === null);
            accountData = item.state.oldAccountData;
            spaceAccountState = item.state;
            break;
        }
        default:
            throw exhaustive(item.state);
    }

    return {
        ...accountData,
        space: {
            version: item.updateLockVersion ?? 0,
            addedTime: item.addedTime,
            state: spaceAccountState,
            role: item.role,
        },
    };
}

type SpaceAccountsCacheData = {
    readonly accounts: ReadonlyArray<AccountModel>;
    readonly accountById: ReadonlyMap<AccountId, AccountModel>;
    readonly accountNameIndex: Fuse<AccountModel>;
    readonly accountShortNameIndex: Fuse<AccountModel>;
};

/**
 * How long we can used cached space accounts before we need to reload the
 * data. In practice, we reload the data faster due to our revalidation
 * interval `spaceAccountsCacheEntryRevalidateMs`.
 *
 * This timeout can't be too long because we read from the cache to authorize
 * accounts! If an account is removed, it's ok if their requests get blocked a
 * few seconds later but not a few minutes later.
 */
const spaceAccountsCacheEntryInvalidatedMs = 15 * 1000;

/**
 * How long until we should make a background cache revalidation request. We
 * can keep using the old cache data while refreshing our cache.
 */
const spaceAccountsCacheEntryRevalidateMs = spaceAccountsCacheEntryInvalidatedMs - 5 * 1000;

type SpaceAccountsCacheEntry = {
    readTime: number;
    dataPromise: Promise<SpaceAccountsCacheData>;
    next: {
        readTime: number;
        dataPromise: Promise<SpaceAccountsCacheData>;
    } | null;
    timeout: Timeout;
};

/**
 * Maintain a cache of all accounts in a space in-memory. We frequently need to
 * look up the accounts in a space for authorization, mentions, and search.
 * Keeping this data cached allows us to answer these queries efficiently.
 *
 * Reading from a cache is always eventually consistent. Cached space accounts
 * are much slower to update (at most 15 seconds) than reading from DynamoDB.
 */
class SpaceAccountsCache {
    private readonly _entryBySpaceId = new Map<SpaceId, SpaceAccountsCacheEntry>();

    constructor() {
        if (typeof afterEach !== "undefined") {
            assert(import.meta.jest);

            afterEach(() => {
                for (const {timeout} of this._entryBySpaceId.values()) {
                    timeout.clear();
                }

                this._entryBySpaceId.clear();
            });

            // We may have some `afterEach()` callbacks that run after our `afterEach()`
            // above adding back entries to our space accounts cache. So have a backup
            // `afterAll()` that runs after all `afterEach()` callbacks.
            afterAll(() => {
                for (const {timeout} of this._entryBySpaceId.values()) {
                    timeout.clear();
                }

                this._entryBySpaceId.clear();
            });
        }
    }

    public clearForTest() {
        assert(process.env.NODE_ENV === "test");

        for (const {timeout} of this._entryBySpaceId.values()) {
            timeout.clear();
        }

        this._entryBySpaceId.clear();
    }

    /**
     * Get all the accounts in a space from our cache. If the data is not present
     * in our cache we'll add it.
     */
    public async getData(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
            actor: ActorContextModule;
        }>,
        spaceId: SpaceId,
    ): Promise<SpaceAccountsCacheData> {
        // Make sure we're allowed to read data from the space.
        await authorizeSpaceAccess(context, spaceId);

        return this.dangerouslyGetDataWithoutAuthorizing(context, spaceId);
    }

    /**
     * Get all the accounts in a space from our cache. If the data is not present
     * in our cache we'll add it.
     *
     * We don't check that the actor is authorized to read this space! If you call
     * this method, make sure you provide your own authorization mechanisms.
     */
    public dangerouslyGetDataWithoutAuthorizing(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>,
        spaceId: SpaceId,
    ): Promise<SpaceAccountsCacheData> {
        const entry = this._entryBySpaceId.get(spaceId);
        const currentTime = Date.now();

        if (!entry) {
            const dataPromise = this._getData(context, spaceId, {isBlocking: true});

            this._entryBySpaceId.set(spaceId, {
                readTime: currentTime,
                dataPromise,
                next: null,
                timeout: createTimeout(
                    this._runInvalidateTimeout.bind(this, spaceId),
                    spaceAccountsCacheEntryInvalidatedMs,
                ),
            });

            return dataPromise;
        }

        // If we've passed our revalidation interval then start a new data fetch for
        // the space in the background.
        if (
            entry.next !== null &&
            entry.readTime + spaceAccountsCacheEntryRevalidateMs < currentTime
        ) {
            entry.next = {
                readTime: currentTime,
                dataPromise: this._getData(context, spaceId, {isBlocking: false}),
            };

            // Make sure our context lives as long as `dataPromise`. Errors are already
            // reported in a span. `waitUntil()` doesn't need to report them.
            context.process.waitUntil(entry.next.dataPromise.catch(() => {}));

            // Once our background promise has finished, update the cache entry to use the
            // new data.
            void entry.next.dataPromise.finally(() => {
                const currentEntry = this._entryBySpaceId.get(spaceId);
                if (entry !== currentEntry) return;

                assert(entry.next);

                entry.timeout.clear();

                this._entryBySpaceId.set(spaceId, {
                    ...entry.next,
                    next: null,
                    timeout: createTimeout(
                        this._runInvalidateTimeout.bind(this, spaceId),
                        spaceAccountsCacheEntryInvalidatedMs - (Date.now() - entry.next.readTime),
                    ),
                });
            });
        }

        return entry.dataPromise;
    }

    private _runInvalidateTimeout(spaceId: SpaceId) {
        const entry = this._entryBySpaceId.get(spaceId);
        if (!entry) return;

        if (entry.next === null) {
            this._entryBySpaceId.delete(spaceId);
        } else {
            this._entryBySpaceId.set(spaceId, {
                ...entry.next,
                next: null,
                timeout: createTimeout(
                    this._runInvalidateTimeout.bind(this, spaceId),
                    spaceAccountsCacheEntryInvalidatedMs - (Date.now() - entry.next.readTime),
                ),
            });
        }
    }

    private async _getData(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>,
        spaceId: SpaceId,
        {isBlocking}: {isBlocking: boolean},
    ): Promise<SpaceAccountsCacheData> {
        const accounts = await getAllSpaceAccountsWithoutCachingAndWithoutAuthorization(
            context,
            spaceId,
            {isBlocking},
        );

        const accountById = new Map<AccountId, AccountModel>(
            accounts.map(account => [account.id, account]),
        );

        const accountNameIndex = new Fuse<AccountModel>(accounts, {
            includeScore: true,
            minMatchCharLength: accountNameIndexFuseMinMatchCharLength,
            keys: [
                {
                    name: "name",
                    getFn: account => account.initialData.name,
                },
            ],
        });

        const accountShortNameIndex = new Fuse<AccountModel>(accounts, {
            includeScore: true,
            minMatchCharLength: accountNameIndexFuseMinMatchCharLength,
            keys: [
                {
                    name: "name",
                    getFn: account =>
                        getAccountShortNameWithoutFullNameTooltip(account.initialData),
                },
            ],
        });

        return {
            accounts,
            accountById,
            accountNameIndex,
            accountShortNameIndex,
        };
    }

    /**
     * Get all the accounts in a space from our cache. If the data is not present
     * in our cache we return null instead of loading the data.
     */
    public async getDataIfExistsWithoutLoading(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
            actor: ActorContextModule;
        }>,
        spaceId: SpaceId,
    ): Promise<SpaceAccountsCacheData | null> {
        // Make sure we're allowed to read data from the space.
        await authorizeSpaceAccess(context, spaceId);

        const entry = this._entryBySpaceId.get(spaceId);
        if (!entry) return null;

        return entry.dataPromise;
    }

    /**
     * Get all the accounts in a space from our cache. If the data is not present
     * in our cache we return null instead of loading the data.
     *
     * We don't check that the actor is authorized to read this space! If you call
     * this method, make sure you provide your own authorization mechanisms.
     */
    public async dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>,
        spaceId: SpaceId,
    ): Promise<SpaceAccountsCacheData | null> {
        const entry = this._entryBySpaceId.get(spaceId);
        if (!entry) return null;

        return entry.dataPromise;
    }
}

/**
 * Load all accounts with the same function `SpaceAccountsCache.getData()` uses.
 * Prefer using
 * `expensivelyGetAllSpaceAccounts(context, spaceId, {consistency: "Strong"})`
 * (which performs authorization) to directly calling this function.
 */
async function getAllSpaceAccountsWithoutCachingAndWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    {
        isBlocking,
        consistency = "Eventual",
    }: {
        isBlocking: boolean;
        consistency?: DynamoReadConsistency;
    },
): Promise<ReadonlyArray<AccountModel>> {
    return context.tracer.withSpan("Load all space accounts", async (context, span) => {
        span.addData({
            common: {isBlocking},
            dynamodb: {consistentRead: consistency === "Strong"},
        });

        const accountAvatarOverrideItemsPromise: Promise<
            Array<[AccountId, SpaceAccountAvatarOverrideItem]>
        > = arrayFromAsyncIterable(
            mapAsyncIterableIterator(
                SpacesTable.query(context, {
                    limit: "All",
                    consistency,
                    partitionKey: {
                        partitionType: "Space",
                        spaceId,
                    },
                    startSortKey: {
                        sortRangeType: "AccountAvatarOverride",
                        accountId: getMinId<AccountId>(),
                    },
                    endSortKey: {
                        sortRangeType: "AccountAvatarOverride",
                        accountId: getMaxId<AccountId>(),
                    },
                }),
                item => {
                    // Optimization: Add item to cache so we can skip loading it later if the item
                    // is requested again.
                    SpaceAccountAvatarOverrideItemContextCache.set(
                        context,
                        consistency,
                        `${spaceId}:${item.accountId}`,
                        item,
                    );

                    return [item.accountId, item];
                },
            ),
        );

        const spaceAccountsPromise = arrayFromAsyncIterable(
            mapAsyncIterableIterator(
                SpacesTable.query(context, {
                    limit: "All",
                    consistency,
                    partitionKey: {
                        partitionType: "Space",
                        spaceId,
                    },
                    startSortKey: {
                        sortRangeType: "Account",
                        accountId: getMinId<AccountId>(),
                    },
                    endSortKey: {
                        sortRangeType: "Account",
                        accountId: getMaxId<AccountId>(),
                    },
                }),
                item => {
                    // Optimization: Add item to cache so we can skip loading it later if the item
                    // is requested again.
                    SpaceAccountItemContextCache.set(
                        context,
                        consistency,
                        `${spaceId}:${item.accountId}`,
                        item,
                    );

                    return item;
                },
            ),
        );

        // NOTE(ifitzsimmons, #space-account-avatar-override-query) We could technically fetch
        // the Space#Account and Space#AccountAvatarOverride items in a single query since the
        // sort ranges are adjacent. However, we'd then have to perform an extra iteration on the
        // result to split up the Space#Account and Space#AccountAvatarOverride items into separate
        // lists. Given that Avatars are relatively large pieces of data (~ 3Kb) and that there
        // may be many accounts in the space, the extra iteration seems not worth it. Splitting the
        // queries into separate calls will incur at most 1 more RCU (because 2 avatars cannot fit
        // within the 4Kb limit). I think that, for now, removing the need for the extra iteration
        // is worth the cost of the extra DDB connection.
        const [spaceAccounts, accountAvatarOverrideItems] = await runAllPromises([
            spaceAccountsPromise,
            accountAvatarOverrideItemsPromise,
        ]);
        const accountOverrideAvatarById = new Map<AccountId, SpaceAccountAvatarOverrideItem>(
            accountAvatarOverrideItems,
        );

        return await runAllPromises(
            spaceAccounts.map(async item => {
                const accountAvatarOverride = accountOverrideAvatarById.get(item.accountId);
                if (item.state.type !== "Active") {
                    return createAccountModelFromItem(
                        {
                            ...item,
                            accountAvatarOverride: accountAvatarOverride ?? null,
                        },
                        null,
                    );
                }

                let account = await dangerouslyGetAccountIfExistsWithoutAuthorization(
                    context,
                    item.accountId,
                    {consistency},
                );

                // If we don't find the account it might be because of DynamoDB eventual
                // consistency lag. Try again with strong consistency.
                if (!account && consistency !== "Strong") {
                    account = await dangerouslyGetAccountIfExistsWithoutAuthorization(
                        context,
                        item.accountId,
                        {consistency: "Strong"},
                    );
                }

                if (!account) {
                    throw new DataLossError("Space account item exists but account item doesn’t");
                }

                return createAccountModelFromItem(
                    {
                        ...item,
                        accountAvatarOverride: accountAvatarOverride ?? null,
                    },
                    account,
                );
            }),
        );
    });
}

const spaceAccountsCache = new SpaceAccountsCache();

export function getSpaceAccountsCacheForTest() {
    assert(process.env.NODE_ENV === "test");
    return spaceAccountsCache;
}

/**
 * Same as `isAccountMemberOfSpace()` except we don't authorize that the actor
 * has access to the space. If an attacker had access to this function they
 * could find out information they're not allowed to see! (e.g. Does account X
 * work for company Y assuming they had the right `Id`s.) Use only when
 * necessary. Prefer `isAccountMemberOfSpace()` wherever possible.
 *
 * This function is mostly strongly consistent so you can safely call it in a
 * strongly consistent environment. It returns `true` with strong consistency
 * but `false` with weak consistency. False positives are acceptable since it's
 * ok if a user's access to a space lingers a bit after they've been removed
 * from the space. But false negatives means the user gets an error when trying
 * to access a space they just got access to which we want to avoid.
 */
export async function isAccountMemberOfSpaceWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    expectedRole: SpaceRole = "Member",
    options?: {allowInvitePending?: boolean},
): Promise<boolean> {
    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );

    const accountFromCache = accountsCacheData?.accountById.get(accountId);
    if (
        accountFromCache &&
        (accountFromCache.initialData.space.state.type === "Active" ||
            (options?.allowInvitePending &&
                accountFromCache.initialData.space.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (accountFromCache.botId && accountFromCache.initialData.space.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(accountFromCache.initialData.space.role, expectedRole)) {
            return true;
        }
    }

    // Read the item with eventual consistency (and context caching). This function
    // needs to return true with strong consistency but if the item exists an
    // eventually consistent read will be cheaper and faster. We'll try again with
    // strong consistency if this fails.
    const item1 = await internalGetSpaceAccountItemIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        {
            consistency: "Eventual",
            // It's ok to call this function when expecting strong read consistency.
            // This authorization check is mostly strongly consistent since we retry with
            // strong consistency below if our eventually consistent read fails.
            allowsEventualReadConsistency: true,
        },
    );
    if (
        item1 &&
        (item1.state.type === "Active" ||
            (options?.allowInvitePending && item1.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (item1.botId && item1.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(item1.role, expectedRole)) {
            return true;
        }
    }

    // If the item wasn't present in any cache and wasn't present when we read with
    // eventual consistency then try finding the item again one last time with
    // strong consistency. Since we want to return `true` from this function with
    // strong consistency.
    const item2 = await internalGetSpaceAccountItemIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        {consistency: "Strong"},
    );
    if (
        item2 &&
        (item2.state.type === "Active" ||
            (options?.allowInvitePending && item2.state.type === "InvitePending"))
    ) {
        // Sanity check: Don't allow bot accounts to have admin roles.
        if (item2.botId && item2.role !== "Member") {
            throw new DataLossError("Bot account should always have a member role");
        }

        if (hasSpaceRole(item2.role, expectedRole)) {
            return true;
        }
    }

    // User is not a member of the space at all
    return false;
}

/**
 * Is the `accountId` a member of the provided `spaceId`?
 *
 * This function caches its result in `CacheContextModule` which is typically
 * scoped to the duration of an action.
 *
 * This function is mostly strongly consistent so you can safely call it in a
 * strongly consistent environment. It returns `true` with strong consistency
 * but `false` with weak consistency. False positives are acceptable since it's
 * ok if a user's access to a space lingers a bit after they've been removed
 * from the space. But false negatives means the user gets an error when trying
 * to access a space they just got access to which we want to avoid.
 */
export async function isAccountMemberOfSpace(
    context: Context<{
        process: ProcessContextModule;
        actor: ActorContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<boolean> {
    await authorizeSpaceAccess(context, spaceId);
    return isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId);
}

/**
 * Authorize that the authenticated account has access to the provided
 * `spaceId`. Throws if the account does not have access.
 *
 * This function is mostly strongly consistent so it's safe to call in a
 * strongly consistent environment. See the documentation on
 * `isAccountMemberOfSpace()` for details about consistency guarantees.
 *
 * This function also checks the role of actor account in the current
 * space(`spaceId`) using optional property`expectedRole`.
 */
export async function authorizeSpaceAccess(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    expectedRole?: SpaceRole,
    options?: {allowInvitePending?: boolean},
): Promise<void> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== spaceId
            ) {
                throw new PermissionDeniedError(
                    "Impersonated account actor doesn’t have access to space",
                    {aggregateDedupeKey: spaceId},
                );
            }

            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getPossiblyBotAccountId(),
                    expectedRole,
                    options,
                ))
            ) {
                throw createAuthorizeSpaceAccessPermissionDeniedError(
                    spaceId,
                    context.actor.getPossiblyBotAccountId(),
                    expectedRole,
                );
            }
            break;
        }
        case "System": {
            if (context.actor.getSpaceId() !== spaceId) {
                throw new PermissionDeniedError("System actor doesn’t have access to space", {
                    aggregateDedupeKey: spaceId,
                });
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Same as `authorizeSpaceAccess()` but instead of throwing an error when the
 * account doesn't have space access, we return a `Result` with the error. So
 * the caller can handle permission denied errors without throwing.
 *
 * The logic should be the exact same between this function and
 * `authorizeSpaceAccess()`.
 */
export async function authorizeSpaceAccessIfPossible(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    expectedRole?: SpaceRole,
    options?: {allowInvitePending?: boolean},
): Promise<Result<void, ErrorBase>> {
    switch (context.actor.type) {
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            const accountId = context.actor.getPossiblyBotAccountId();

            if (
                context.actor.type === "ImpersonatedAccount" &&
                context.actor.getSpaceId() !== spaceId
            ) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= new PermissionDeniedError(
                            "Impersonated account actor doesn’t have access to space",
                            {aggregateDedupeKey: spaceId},
                        );
                        return error;
                    },
                };
            }

            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    accountId,
                    expectedRole,
                    options,
                ))
            ) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= createAuthorizeSpaceAccessPermissionDeniedError(
                            spaceId,
                            accountId,
                        );
                        return error;
                    },
                };
            }
            return okResult;
        }
        case "System": {
            if (context.actor.getSpaceId() !== spaceId) {
                let error: ErrorBase | undefined;

                return {
                    ok: false,
                    get error() {
                        // When this function is called, frequently we only check `ok`. So lazily
                        // create an error only when needed.
                        error ??= new PermissionDeniedError(
                            "System actor doesn’t have access to space",
                            {aggregateDedupeKey: spaceId},
                        );
                        return error;
                    },
                };
            }
            return okResult;
        }
        case "Anonymous": {
            let error: ErrorBase | undefined;

            return {
                ok: false,
                get error() {
                    // When this function is called, frequently we only check `ok`. So lazily
                    // create an error only when needed.
                    error ??= unauthenticatedSessionError();
                    return error;
                },
            };
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * Authorizes that the provided `AccountId` is the same account as the actor.
 * If the actor is a session actor then the `AccountId` must be exactly equal
 * to authenticated session. If the actor is a system actor then the
 * `AccountId` must be a member of the system actor's space.
 */
export async function authorizeOwnSpaceAccountAccess(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    accountId: AccountId,
) {
    switch (context.actor.type) {
        case "System": {
            // System actors can access any account in their space.
            if (!(await isAccountMemberOfSpace(context, context.actor.getSpaceId(), accountId))) {
                throw new PermissionDeniedError(
                    "Can’t access account that’s not in the system actor’s space",
                );
            }
            break;
        }
        case "Session":
        case "ImpersonatedAccount":
        case "Bot": {
            if (context.actor.getPossiblyBotAccountId() !== accountId) {
                throw new PermissionDeniedError("Can’t access account that’s not the actor’s");
            }
            break;
        }
        case "Anonymous": {
            throw unauthenticatedSessionError();
        }
        default:
            throw exhaustive(context.actor);
    }
}

/**
 * If the bot is instantiated in the provided `SpaceId` then return the
 * `AccountId` for the bot in the space.
 *
 * Throws if you don't have access to the space.
 */
export async function getBotAccountIdForSpaceIfExists(
    context: ServerActionContext,
    botId: BotId,
    spaceId: SpaceId,
): Promise<AccountId | null> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await SpacesTable.getItemIfExists(context, {
        partitionType: "Bot",
        sortRangeType: "Space",
        botId,
        spaceId,
    });

    return item?.accountId ?? null;
}

/**
 * Authorize that the provided space account isn't a bot. Throws an error if
 * either the provided space account is a bot or the space account doesn't
 * exist.
 *
 * If you called `authorizeSpaceAccess()` before this function (as a session
 * actor for the `AccountId` you're passing into this function) then we don't
 * make any database requests. The information we need os be available in
 * cache.
 */
export async function authorizeNotBotSpaceAccount(
    context: Context<{
        process: ProcessContextModule;
        actor: ActorContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
) {
    if (await isBotSpaceAccount(context, spaceId, accountId)) {
        throw permissionDeniedBotError();
    }
}

/**
 * Is the space account a bot? Same as if you checked
 * `await getSpaceAccountBotIdIfExists() !== null`.
 *
 * Throws an error if the space account isn't found.
 *
 * If you called `authorizeSpaceAccess()` before this function (as a session
 * actor for the `AccountId` you're passing into this function) then we don't
 * make any database requests. The information we need os be available in
 * cache.
 *
 * This function is strongly consistent. It makes an eventually consistent read
 * to our action cache but since whether an account is or is not a bot is an
 * immutable fact an eventually consistent read is fine.
 */
export async function isBotSpaceAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<boolean> {
    const botId = await getSpaceAccountBotIdIfExists(context, spaceId, accountId);
    return botId !== null;
}

/**
 * Is the space account a bot? If so what's the `BotId`?
 *
 * Throws an error if the space account isn't found.
 *
 * If you called `authorizeSpaceAccess()` before this function (as a session
 * actor for the `AccountId` you're passing into this function) then we don't
 * make any database requests. The information we need os be available in
 * cache.
 *
 * This function is strongly consistent. It makes an eventually consistent read
 * to our action cache but since whether an account is or is not a bot is an
 * immutable fact an eventually consistent read is fine.
 */
export async function getSpaceAccountBotIdIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<BotId | null> {
    const [, botId] = await runAllPromises([
        authorizeSpaceAccess(context, spaceId),
        getSpaceAccountBotIdIfExistsWithoutAuthorization(context, spaceId, accountId),
    ]);
    return botId;
}

/**
 * Same as `getSpaceAccountBotIdIfExists()` but doesn't authorize that the
 * actor has access to the space. Use only when necessary. Prefer
 * `getSpaceAccountBotIdIfExists()` wherever possible.
 *
 * This function is strongly consistent. It makes an eventually consistent read
 * to our action cache but since whether an account is or is not a bot is an
 * immutable fact an eventually consistent read is fine.
 */
export async function getSpaceAccountBotIdIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<BotId | null> {
    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );

    const accountFromCache = accountsCacheData?.accountById.get(accountId);
    if (accountFromCache) return accountFromCache.botId ?? null;

    // Read the item with eventual consistency (and context caching). The `botId`
    // property is immutable so if we find an item then we'll know if it's a bot or
    // not. If we can't find a space account item then we try again with strong
    // consistency.
    const item1 = await internalGetSpaceAccountItemIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        {
            consistency: "Eventual",
            // It's ok to call this function when expecting strong read consistency.
            // This authorization check is mostly strongly consistent since we retry with
            // strong consistency below if our eventually consistent read fails.
            allowsEventualReadConsistency: true,
        },
    );
    if (item1) return item1.botId ?? null;

    // If the item wasn't present in any cache and wasn't present when we read with
    // eventual consistency then try finding the item again one last time with
    // strong consistency.
    const item2 = await internalGetSpaceAccountItemIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        {consistency: "Strong"},
    );
    if (item2) return item2.botId ?? null;

    throw createAuthorizeSpaceAccessPermissionDeniedError(spaceId, accountId);
}

/**
 * As a system actor, impersonate any account in the system actor's space.
 * Throws an error if the provided account isn't a member of the space.
 *
 * You may only access the account's data in the system actor's space. You
 * can't use this function to read an account's data in another space. (If
 * authorization checks for impersonated accounts are implemented properly.)
 *
 * A system actor should have access to all data in a space. So impersonating
 * an account means you end up with a subset of data your system actor has
 * access to.
 *
 * This function is useful for performing an action with the permissions of an
 * account from a system action.
 */
export async function impersonateAccountAsSystemContext<
    Modules extends {
        process: ProcessContextModule;
        actor: SystemActorContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
    },
    Value,
>(
    context: Context<Modules>,
    accountId: AccountId,
    action: (
        context: Context<
            Replace<
                Modules,
                {
                    cache: CacheContextModule;
                    batch: BatchContextModule;
                    actor: ImpersonatedAccountActorContextModule;
                }
            >
        >,
    ) => Promise<Value>,
): Promise<Value> {
    // Double check that this is a system actor.
    context.actor.authorizeSystem();

    // Make sure the account exists and its a member of our space before we can
    // impersonate it.
    if (!(await isAccountMemberOfSpace(context, context.actor.getSpaceId(), accountId))) {
        throw new PermissionDeniedError(
            "Can’t impersonate account that’s not a member of system actor’s space",
        );
    }

    // Bot accounts can't be impersonated. Bot accounts only get access to content
    // through "scopes". When a bot is mentioned we give them a token with limited
    // access but they may have access to content that wasn't directly shared with
    // the bot. Therefore there's not much stuff a bot can do on its own so it
    // doesn't make sense to impersonate a bot.
    if (await isBotSpaceAccount(context, context.actor.getSpaceId(), accountId)) {
        throw new PermissionDeniedError("Can’t impersonate bot account");
    }

    return context.with(
        {
            cache: context.cache.forkForChangedActor(),
            batch: context.batch.forkForChangedActor(),
            actor: ImpersonatedAccountActorContextModule.dangerouslyNew(context.actor, accountId),
        },
        action,
    );
}

const SpaceAccountItemContextCache = new DynamoContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a
 * context cache.
 *
 * Does not authorize the actor has access! Which is why the function is called
 * "dangerous". You must do that yourself.
 */
export async function internalGetSpaceAccountItemIfExistsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    spaceId: SpaceId,
    accountId: AccountId,
    {
        consistency = "Eventual",
        allowsEventualReadConsistency = false,
    }: {
        consistency?: DynamoCacheReadConsistency;
        allowsEventualReadConsistency?: boolean;
    } = {},
): Promise<SpaceAccountItem | null> {
    return SpaceAccountItemContextCache.get(
        context,
        allowsEventualReadConsistency ? {consistency, allowsEventualReadConsistency} : consistency,
        `${spaceId}:${accountId}`,
        consistency =>
            SpacesTable.getItemIfExists(
                context,
                {partitionType: "Space", sortRangeType: "Account", spaceId, accountId},
                {consistency, allowsEventualReadConsistency},
            ),
    );
}

/**
 * Get an account through a provided space. We can only authorize whether you
 * have access to read an account by checking that both you and the account you
 * are trying to read are members of the same space.
 *
 * If the account does not exist, we return null. If the account does exist but
 * is not a member of the provided space we don't return null! Instead we
 * return an `AccountModel` with `AccountModel.initialData.space.state.type"`
 * as Removed
 *
 * Do not use this method for authorization purposes. Since we return an
 * `AccountModel` even if the account is removed. Instead use
 * `isAccountMemberOfSpace()` which returns false for removed accounts.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModel | null> {
    await authorizeSpaceAccess(context, spaceId);
    return getAccountIfExistsWithoutAuthorization(context, spaceId, accountId, options);
}

/**
 * Same as `getAccountIfExists()` but doesn't load the account's avatar.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountWithoutAvatarIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelData, "avatar"> | null> {
    await authorizeSpaceAccess(context, spaceId);
    return getAccountWithoutAvatarIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        options,
    );
}

/**
 * You're allowed to read your own account even if you don't have access to the
 * space yet. Maybe you have an `InvitePending` account state.
 */
export async function getOwnAccountIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        batch: BatchContextModule;
        dynamo: DynamoContextModule;
        actor: SessionActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    return getAccountIfExistsWithoutAuthorization(context, spaceId, accountId, options);
}

/**
 * Get an account through a provided space without authorizing the actor has
 * access to the space the account is in. This is dangerous and should only be
 * called if you know the actor is authorized to see a stub for the account
 * through some other means. For example, if a document is shared by URL and
 * the actor is not a member of the space the document is in, then the actor is
 * allowed to see the names of any mentioned accounts and nothing else.
 *
 * This function returns an `AccountModel` stub. A stub only contains the
 * account's name and nothing else. We return dummy data for all other required
 * properties like the time the account joined the space and whether the
 * account was removed from the space. The version of the `AccountModel` stub
 * is also a negative number. This way if merging a stub `AccountModel` with a
 * non-stub `AccountModel` the non-stub `AccountModel` will always override.
 */
export async function dangerouslyGetAccountStubIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<AccountModel | null> {
    const account = await getAccountIfExistsWithoutAuthorization(
        context,
        spaceId,
        accountId,
        options,
    );
    if (!account) return null;

    const accountData = account.initialData;

    // The minimum value for a V8 SMI on 32-bit platforms ([source][1],
    // [source][2]). Small integers in V8 aren't stored on the heap.
    //
    // We add this to version numbers so the version of our stub `AccountModel`
    // will always be smaller of non-stub `AccountModel`s. If the client has a
    // non-stub `AccountModel` for the account then when merging `AccountModel`s
    // the non-stub will always win.
    //
    // It's technically possible for the account to update so many times that the
    // account's stub version will be a positive number. We don't mind since it
    // should be wildly unlikely for a client to have the first version of the
    // `AccountModel` loaded locally and try to merge it with a stub version of the
    // same `AccountModel` more than one billion updates later. Even if this
    // happens the resulting bugs should be very tame.
    //
    // [1]: https://medium.com/fhinkel/v8-internals-how-small-is-a-small-integer-e0badc18b6da
    // [2]: https://github.com/v8/v8/blob/a9e3d9c7ec1345085c861af76e508d9591634530/include/v8.h#L253
    const smiMinValue = -(2 ** 30);

    return new AccountModel({
        id: account.id,
        version: accountData.version + smiMinValue,
        name: accountData.name,
        nameVersion: accountData.nameVersion + smiMinValue,
        botId: accountData.botId,
        // The account's reaction character is available publicly via entities shared by
        // URL when there's no avatar set. Since the character is used to determine the
        // avatar.
        reactionCharacter: !accountData.avatar ? accountData.reactionCharacter : null,
        space: {
            version: accountData.space.version + smiMinValue,
            addedTime: new Date(0),
            state: {type: "Active"},
            role: "Member",
        },
        avatar: accountData.avatar
            ? {
                  avatarId: accountData.avatar.avatarId,
                  version: accountData.avatar.version + smiMinValue,
                  content: accountData.avatar.content,
              }
            : null,
    });
}

const SpaceAccountAvatarOverrideItemContextCache = new DynamoContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountAvatarOverrideItem | null
>({
    // Allow sharing this cache because the results do not depend on who the
    // actor is.
    whenActorChanges: "DangerouslyShare",
});

async function getAccountIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<AccountModel | null> {
    // If we have cached account data and we're loading with eventual consistency
    // then we can use the cached data.
    if (consistency === "Eventual") {
        // We can't use `getDataIfExistsWithoutLoading()` because it calls
        // `authorizeSpaceAccess()` which might get us stuck in a deadlock. Since
        // `authorizeSpaceAccess()` looks at the cache result of this function.
        //
        // It's safe to skip authorization for this function, though, because we
        // authorize space access above.
        const accountsCacheData =
            await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
                context,
                spaceId,
            );
        if (accountsCacheData) {
            return accountsCacheData.accountById.get(accountId) ?? null;
        }
    }

    // Otherwise load account data and space account data. If this is the current
    // account, we may have already cached the account item.
    const [account, spaceAccountItem] = await runAllPromises([
        dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {consistency}),
        internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId, {
            consistency,
        }),
    ]);

    if (!spaceAccountItem) return null;

    if (spaceAccountItem.state.type !== "Active") {
        // NOTE(ifitzsimmons, #account-override-avatar-consistency):
        // “We know there’s a potential eventual consistency race condition here where
        // Space#Account has a non-Active state but we don’t find a
        // Space#AccountAvatarOverride item due to eventual consistency lag. We’re not
        // fixing this since we expect it to be quite rare in practice and the impact to be
        // a pretty minor glitch (removed account appears as if they didn’t have an avatar
        // set).
        const spaceAccountAvatarOverride = await SpaceAccountAvatarOverrideItemContextCache.get(
            context,
            consistency,
            `${spaceId}:${accountId}`,
            consistency =>
                SpacesTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Space",
                        sortRangeType: "AccountAvatarOverride",
                        spaceId,
                        accountId,
                    },
                    {consistency},
                ),
        );

        return createAccountModelFromItem(
            {
                ...spaceAccountItem,
                accountAvatarOverride: spaceAccountAvatarOverride ?? null,
            },
            null,
        );
    } else {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in
        // our account table.
        if (!account) {
            throw new DataLossError("Space account item exists but account item doesn’t");
        }

        return createAccountModelFromItem(
            {
                ...spaceAccountItem,
                // Active accounts should not have an avatar override
                accountAvatarOverride: null,
            },
            account,
        );
    }
}

async function getAccountWithoutAvatarIfExistsWithoutAuthorization(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<Omit<AccountModelData, "avatar"> | null> {
    // If we have cached account data and we're loading with eventual consistency
    // then we can use the cached data.
    if (consistency === "Eventual") {
        // We can't use `getDataIfExistsWithoutLoading()` because it calls
        // `authorizeSpaceAccess()` which might get us stuck in a deadlock. Since
        // `authorizeSpaceAccess()` looks at the cache result of this function.
        //
        // It's safe to skip authorization for this function, though, because we
        // authorize space access above.
        const accountsCacheData =
            await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
                context,
                spaceId,
            );
        if (accountsCacheData) {
            return accountsCacheData.accountById.get(accountId)?.initialData ?? null;
        }
    }

    // Otherwise load account data and space account data. If this is the current
    // account, we may have already cached the account item.
    const [account, spaceAccountItem] = await runAllPromises([
        dangerouslyGetAccountWithoutAvatarIfExistsWithoutAuthorization(context, accountId, {
            consistency,
        }),
        internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId, {
            consistency,
        }),
    ]);

    if (!spaceAccountItem) return null;

    if (spaceAccountItem.state.type !== "Active") {
        return createAccountModelDataWithoutAvatarFromItem(spaceAccountItem, null);
    } else {
        // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in
        // our account table.
        if (!account) {
            throw new DataLossError("Space account item exists but account item doesn’t");
        }

        return createAccountModelDataWithoutAvatarFromItem(spaceAccountItem, account);
    }
}

/**
 * Same as `getAccountIfExists()` but throws an error if the account can not
 * be found.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccountModel> {
    const account = await getAccountIfExists(context, spaceId, accountId, options);
    if (!account) throw createSpaceAccountNotFoundError();
    return account;
}

/**
 * Same as `getAccount()` but doesn't load the account's avatar.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccountWithoutAvatar(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<Omit<AccountModelData, "avatar">> {
    const account = await getAccountWithoutAvatarIfExists(context, spaceId, accountId, options);
    if (!account) throw createSpaceAccountNotFoundError();
    return account;
}

function createSpaceAccountNotFoundError() {
    return new NotFoundError("Can’t find account in space", {
        displayMessage: errorDisplayMessage`This person doesn’t exist. Try searching “all people” to see who else is here.`,
    });
}

/**
 * Get the space account settings for the actor in the provided space.
 */
export async function getSpaceAccountSettings(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<SpaceAccountSettings> {
    await authorizeSpaceAccess(context, spaceId);

    const item = await SpacesTable.getItemIfExists(context, {
        partitionType: "Space",
        sortRangeType: "AccountSettings",
        spaceId,
        accountId: context.actor.getAccountId(),
    });

    return item ?? SpaceAccountSettingsSchema.deserialize({});
}

/**
 * Update some space account settings for the actor in the provided space.
 */
export async function updateSpaceAccountSettings(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    update: Partial<SpaceAccountSettings>,
) {
    await authorizeSpaceAccess(context, spaceId);

    await SpacesTable.updateItem(
        context,
        {
            partitionType: "Space",
            sortRangeType: "AccountSettings",
            spaceId,
            accountId: context.actor.getAccountId(),
        },
        item => {
            item ??= {
                partitionType: "Space",
                sortRangeType: "AccountSettings",
                spaceId,
                accountId: context.actor.getAccountId(),
                ...SpaceAccountSettingsSchema.deserialize({}),
            };

            return {...item, ...update};
        },
    );
}

export async function updateSpaceName(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    name: string,
): Promise<SpaceModel> {
    await authorizeSpaceAccess(context, spaceId);

    LabelStringSchema.validate?.(name, {
        errorDisplayMessagePrefix: errorDisplayMessage`The name you typed`,
    });

    return context.dynamo.retryTransaction(async context => {
        const spaceItem = await getSpaceItem(context, spaceId);

        const newSpaceAttributesItem = {
            ...spaceItem,
            name,
        };

        const updatedSpaceItem = await SpacesTable.directlyUpdateItem(
            context,
            newSpaceAttributesItem,
        );

        return createSpaceModelFromItem({
            ...updatedSpaceItem,
            avatars: spaceItem.avatars,
        });
    });
}

/**
 * Get the space with the specified `SpaceId`. Returns a null if the space
 * doesn't exist and returns a `Result` if the actor doesn't have access to
 * the space.
 */
export async function getSpaceIfPossible(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<Result<SpaceModel, ErrorBase> | null> {
    const [authorizationResult, spaceItem] = await runAllPromises([
        authorizeSpaceAccessIfPossible(context, spaceId),
        getSpaceItemIfExists(context, spaceId),
    ]);

    if (!spaceItem) return null;
    if (!authorizationResult.ok) return authorizationResult;

    return {
        ok: true,
        value: createSpaceModelFromItem(spaceItem),
    };
}

/**
 * Invites a user to join a space by their email address. Only space administrators
 * can invite users. The invited user will be invited as a "Member" role.
 *
 * The function ensures proper authorization and maintains the space membership state
 * in the database.
 */
async function inviteEmailAddressToSpaceWithoutRetryTransaction(
    context: ServerSessionActionContextWithEmail,
    {
        emailAddress,
        existingAccountId,
        spaceId,
    }: {
        spaceId: SpaceId;
        emailAddress: EmailAddress;
        existingAccountId: AccountId | undefined;
    },
): Promise<AccountModel> {
    return context.tracer.withSpan("Invite email address to space", async (context, span) => {
        await authorizeSpaceAccess(context, spaceId, "Admin");

        const accountId = existingAccountId ?? generateId<AccountId>();
        span.addData({
            space: {
                members: {
                    invite: {
                        send: existingAccountId
                            ? {
                                  existingAccountId,
                              }
                            : {
                                  newAccountId: accountId,
                              },
                    },
                },
            },
        });

        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId),
            internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        validateAccountStateForSpaceAddition({
            spaceId,
            account,
            accountSpacesItem,
            spaceAccountItem,
        });

        const currentTime = new Date();

        const newSpaceAccountState: SpaceAccountState = {
            type: "InvitePending",
            invitedTime: currentTime,
            pendingAccountData: {
                id: accountId,
                version: 0,
                // Names are labelStrings and can only support 50 characters
                // Just do a hard truncate here
                name: emailAddress.substring(0, 50),
                nameVersion: 0,
                // Pick a random character for the account since we don't want to reveal the
                // character selected by the account (which is private information along with
                // the rest of the account's data).
                reactionCharacter: pickRandomReactionCharacterForAccount(),
            },
            wasPreviouslyRemoved: spaceAccountItem?.state.type === "Removed",
        };
        let addSpaceAccountTransactionEntries;

        if (existingAccountId) {
            addSpaceAccountTransactionEntries = await getAddSpaceAccountTransactionEntries({
                spaceItem,
                role: "Member",
                spaceAccountItem,
                accountSpacesItem,
                newSpaceAccountState,
                account: assertExists(account),
            });
        } else {
            addSpaceAccountTransactionEntries = await getAddSpaceAccountTransactionEntries({
                spaceItem,
                role: "Member",
                spaceAccountItem,
                accountSpacesItem,
                newSpaceAccountState,
                newAccountId: accountId,
            });
        }

        const {transactionEntries, newItem} = addSpaceAccountTransactionEntries;

        await DynamoTableSchema.executeTransaction(context, [
            ...(!existingAccountId
                ? createAccountWithEmailAddressTransactionEntries({
                      id: accountId,
                      // Use email as name for new account so they can be mentioned
                      // in the space before they join.
                      name: emailAddress,
                      emailAddress,
                      currentTime,
                  })
                : []),
            ...transactionEntries,
        ]);

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

        // After we've successfully created the account, run some additional
        // non-critical initialization logic. If any initialization here fails, the
        // account will still be successfully created, but there may be some small
        // issues.
        await context.searchInjection.dangerouslyFavoriteSearchEntityWithoutAuthorization({
            spaceId,
            accountId,
            entityId: "TaskPersonal",
        });

        const spaceUrl = `${context.constants.edgeServiceUrl}/s/${spaceId}`;

        if (process.env.NODE_ENV === "development" || process.env.PLAYWRIGHT_TEST_PATH) {
            // eslint-disable-next-line no-console
            console.log(
                quote`Accept the invite for ${emailAddress} in ${
                    spaceItem.name
                } here: ${`${spaceUrl}/invite`}`,
            );
        }

        await context.email.send({
            fromEmailAddressAlias: "Invitation",
            toEmailAddress: emailAddress,
            templateName: "SpaceInvite",
            templateProps: {
                spaceUrl,
                spaceName: spaceItem.name,
            },
        });

        return createAccountModelFromItem(newItem, null);
    });
}

async function validateEmailAddressForInviteInSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
    emailAddress: string,
): Promise<
    | {
          ok: false;
          reason: "Invalid" | "InviteRejectedAsSpam" | "AlreadyMember";
      }
    | {
          ok: true;
          accountId: AccountId | null;
          validatedEmailAddress: EmailAddress;
      }
> {
    let validatedEmailAddress: EmailAddress;
    try {
        validatedEmailAddress = await validateEmailAddress(context, emailAddress);
    } catch {
        return {ok: false, reason: "Invalid"};
    }

    const accountId = await getAccountIdByEmailAddressIfExists(context, validatedEmailAddress);

    const spaceAccountItem = accountId
        ? await internalGetSpaceAccountItemIfExistsWithoutAuthorization(
              context,
              spaceId,
              accountId,
              {
                  consistency: "Strong",
              },
          )
        : null;

    if (spaceAccountItem) {
        if (spaceAccountItem.state.type !== "Removed") {
            return {ok: false, reason: "AlreadyMember"};
        } else if (spaceAccountItem.state.reason === "InviteRejectedAsSpam") {
            return {ok: false, reason: "InviteRejectedAsSpam"};
        }
    }

    return {ok: true, accountId, validatedEmailAddress};
}

/**
 * Should only be called by `inviteEmailAddressesToSpace()`.
 */
export async function internalValidateInviteEmailAddressToSpace(
    context: ServerSessionActionContextWithEmail,
    {
        spaceId,
        emailAddress,
    }: {
        spaceId: SpaceId;
        emailAddress: string;
    },
): Promise<
    | {
          ok: false;
          emailAddress: string;
          reason: "Invalid" | "InviteRejectedAsSpam" | "AlreadyMember";
      }
    | {
          ok: true;
          emailAddress: string;
          inviteEmailAddressToSpace: (
              context: ServerSessionActionContextWithEmail,
          ) => Promise<AccountModel>;
      }
> {
    const result = await validateEmailAddressForInviteInSpace(context, spaceId, emailAddress);

    if (!result.ok) {
        return {
            ok: false,
            emailAddress: emailAddress,
            reason: result.reason,
        };
    }

    const {accountId: initialAccountId, validatedEmailAddress} = result;

    return {
        ok: true,
        emailAddress: emailAddress,
        inviteEmailAddressToSpace: async context => {
            let hasAlreadyAttempted = false;

            return context.dynamo.retryTransaction(async context => {
                const isInitialAttempt = !hasAlreadyAttempted;
                hasAlreadyAttempted = true;

                let accountId = initialAccountId;

                if (!isInitialAttempt) {
                    // Run the EXACT SAME validations as a sanity check. This time we'll throw.
                    const result = await validateEmailAddressForInviteInSpace(
                        context,
                        spaceId,
                        emailAddress,
                    );

                    if (!result.ok) {
                        throw new FailedPreconditionError("Can’t invite email address to space");
                    }

                    accountId = result.accountId;
                }

                const account = await inviteEmailAddressToSpaceWithoutRetryTransaction(context, {
                    spaceId,
                    emailAddress: validatedEmailAddress,
                    existingAccountId: accountId ?? undefined,
                });

                return account;
            });
        },
    };
}

/**
 * Get the space with the specified `SpaceId`. Throws an error if the actor
 * doesn't have access to the space or if the space doesn't exist.
 */
export async function getSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
    options?: {consistency?: DynamoCacheReadConsistency; allowInvitePending?: boolean},
): Promise<SpaceModel> {
    const [authorizationResult, spaceItem] = await runAllPromises([
        captureResultPromise(authorizeSpaceAccess(context, spaceId, "Member", options)),
        getSpaceItem(context, spaceId, {consistency: options?.consistency}),
    ]);

    // Prioritize the `NotFoundError` over the `PermissionDeniedError`.
    unwrapResult(authorizationResult);

    return createSpaceModelFromItem(spaceItem);
}

/**
 * Gets all the accounts in our space.
 *
 * Expensive since there is no pagination to this method. Can get quite slow
 * for spaces with many accounts. We may cache this list to improve
 * performance. However, since right now this is used primarily to search for
 * accounts the real solution is to setup ElasticSearch and use that for
 * searching accounts.
 *
 * Returns in `AccountId` order.
 */
// TODO(calebmer): Should eventually migrate this to the search system. Or it
// should use fuse server side? At some point downloading all accounts to the
// client won't make sense.
//
// When you initially open an account picker it should show affinitive accounts
// first (based on search entity affinity points). Then you search that list.
// Though if a space has <100 accounts we probably still want to load the
// entire list of accounts to the client instead of searching in OpenSearch.
export async function expensivelyGetAllSpaceAccounts(
    context: ServerActionContext,
    spaceId: SpaceId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<ReadonlyArray<AccountModel>> {
    // Skip the cache, load all space accounts with strong consistency.
    if (consistency === "Strong") {
        // `spaceAccountsCache.getData` already check the `authorizeSpaceAccess`
        // internally, so only check for strong consistency block.
        await authorizeSpaceAccess(context, spaceId);

        return getAllSpaceAccountsWithoutCachingAndWithoutAuthorization(context, spaceId, {
            isBlocking: true,
            consistency: "Strong",
        });
    }

    const {accounts} = await spaceAccountsCache.getData(context, spaceId);
    return accounts;
}

/**
 * Get the `SpaceId`s for the provided `AccountId`.
 */
export async function internalGetAccountSpaceIdsWithoutAuthorization(
    context: Context<DynamoContextModules & {cache: CacheContextModule}>,
    accountId: AccountId,
): Promise<ReadonlySet<SpaceId>> {
    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId,
    });

    const spaceIds: ReadonlySet<SpaceId> = spacesItem?.spaceIds ?? new Set();
    return spaceIds;
}

/**
 * Get the `SpaceId`s our actor is a part of.
 *
 * Also allows you to get a condition check transaction entry that fails if our
 * actor was added to or removed from a space.
 */
export async function getOurAccountSpaceIds(context: ServerSessionActionContext): Promise<{
    spaceIds: ReadonlySet<SpaceId>;
    getConditionCheckTransactionEntry: () => DynamoTransactionEntry;
}> {
    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId: context.actor.getAccountId(),
    });

    const spaceIds: ReadonlySet<SpaceId> = spacesItem?.spaceIds ?? new Set();

    return {
        spaceIds,
        getConditionCheckTransactionEntry: () =>
            spacesItem
                ? SpacesTable.transactionUpdateLockVersionConditionCheck(
                      {
                          partitionType: "Account",
                          sortRangeType: "Spaces",
                          accountId: context.actor.getAccountId(),
                      },
                      spacesItem.updateLockVersion,
                  )
                : SpacesTable.transactionDoesNotExistConditionCheck(
                      {
                          partitionType: "Account",
                          sortRangeType: "Spaces",
                          accountId: context.actor.getAccountId(),
                      },
                      {isConditionCheckErrorRetriable: true},
                  ),
    };
}

/**
 * Get the `SpaceId`s our actor has pending invites for.
 */
export async function getOurAccountInvitePendingSpaceIds(
    context: ServerSessionActionContext,
): Promise<{
    invitePendingSpaceIds: ReadonlySet<SpaceId>;
}> {
    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId: context.actor.getAccountId(),
    });

    const invitePendingSpaceIds: ReadonlySet<SpaceId> =
        spacesItem?.invitePendingSpaceIds ?? new Set();

    return {
        invitePendingSpaceIds,
    };
}

export type SpaceAccountNameSearchIndex = {
    searchNames(queryText: string): Array<AccountModel>;
    searchShortNames(queryText: string): Array<AccountModel>;
};

/**
 * Get a server-side in-memory search index for accounts in the provided
 * `SpaceId`. The search index is powered by Fuse.js. The search index is
 * cached in memory. So if space accounts have already been loaded for this
 * space, calling this function is instant.
 */
export async function getSpaceAccountNameSearchIndex(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<SpaceAccountNameSearchIndex> {
    const {accountNameIndex, accountShortNameIndex} = await spaceAccountsCache.getData(
        context,
        spaceId,
    );

    return {
        searchNames: queryText => {
            return filterMapArray(accountNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
        searchShortNames: queryText => {
            return filterMapArray(accountShortNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return;
                return match.item;
            });
        },
    };
}

/**
 * Get all devices registered for the provided `AccountId`. System actors can
 * see the registered devices for any account since we need to send push
 * notifications to the account's devices as the system actor.
 */
export async function getRegisteredAccountDevices(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<ReadonlyArray<AccountDevice>> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    return internalGetRegisteredAccountDevicesWithoutAuthorization(context, accountId);
}

/**
 * Get the most recently added email address for the provided `AccountId`.
 * System actors can see the most recently added email address for any account in their space.
 */
export async function getLatestEmailAddress(
    context: ServerActionContext,
    accountId: AccountId,
): Promise<EmailAddress> {
    await authorizeOwnSpaceAccountAccess(context, accountId);
    const emailAddress = await internalGetLatestEmailAddressByAccountIdWithoutAuthorization(
        context,
        accountId,
    );
    if (!emailAddress) {
        throw new NotFoundError("No email address found for `accountId`");
    }
    return emailAddress;
}

/**
 * Update the role of an account in a space.
 *
 * Only space owners and admins can update roles.
 *
 * Cannot modify the owner's role.
 */
export async function updateSpaceAccountRole(
    context: ServerActionContext,
    {spaceId, accountId, role}: {spaceId: SpaceId; accountId: AccountId; role: SpaceRole},
): Promise<AccountModel> {
    await authorizeSpaceAccess(context, spaceId, "Admin");

    if (role === "Owner") {
        throw new FailedPreconditionError(
            "Can’t update a space account’s role to owner (maybe you want `moveSpaceAccountOwnerRole()` instead)",
        );
    }

    return context.dynamo.retryTransaction(async context => {
        const [spaceItem, spaceAccountItem, account] = await runAllPromises([
            SpacesTable.getItem(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {
                consistency: "Strong",
            }),
        ]);

        if (!spaceAccountItem || spaceAccountItem.state.type !== "Active") {
            throw new NotFoundError("Account is not an active member of the space");
        }

        // Should exist since we've checked that `spaceAccountItem` exists.
        assert(account);

        if (hasSpaceRole(spaceAccountItem.role, "Owner")) {
            throw new PermissionDeniedError("Can’t modify space owner account’s role");
        }

        if (account.botId) {
            throw new FailedPreconditionError("Can’t modify bot account’s role");
        }

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            role,
        });

        await DynamoTableSchema.executeTransaction(context, [
            // Since this transaction is security sensitive, make sure the account and
            // space didn't update when we commit. This also makes sure both the space and
            // account exist.
            SpacesTable.transactionUpdateLockVersionConditionCheck(
                spaceItem,
                spaceItem.updateLockVersion,
            ),
            updateSpaceAccountItemTransactionEntry,
        ]);

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                // Active accounts should not have an avatar override
                accountAvatarOverride: null,
            },
            spaceAccountItem.state.type === "Active" ? account : null,
        );
    });
}

export const moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint =
    new TestCheckpoint<`${SpaceId}:${AccountId}`>();

/**
 * Move the ownership of a space to a new account and make previous `Owner` as `Admin`
 *
 * Each space should have only one `Owner` by default which is made during the creation of
 * space using `createAlphaSpaceAsAdmin`. After creation of space you can only edit `Owner`
 * role using this function.
 *
 * We make sure only `Owner` can transfer the ownership to other accounts in client as well as
 * server using `authorizeSpaceAccess(context, spaceId, "Owner")`
 *
 * Be careful while dealing with `Owner` of the space as you cannot enforce single owner using
 * Schema library so we need to do that in code manually.
 */
export async function moveSpaceAccountOwnerRole(
    context: ServerSessionActionContext,
    {
        spaceId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        newOwnerAccountId: AccountId;
    },
): Promise<{
    newOwnerAccount: AccountModel;
    oldOwnerAccount: AccountModel;
}> {
    // Make sure a session actor is moving the owner role and a system actor isn't
    // doing it on a session actor's behalf.
    context.actor.authorizeSession();

    await authorizeSpaceAccess(context, spaceId, "Owner");

    return moveSpaceAccountOwnerRoleWithoutAuthorization(context, {
        spaceId,
        oldOwnerAccountId: context.actor.getAccountId(),
        newOwnerAccountId,
    });
}

export async function moveSpaceAccountOwnerRoleForTest(
    context: ServerActionContext,
    {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        oldOwnerAccountId: AccountId;
        newOwnerAccountId: AccountId;
    },
) {
    assert(import.meta.jest);

    await authorizeSpaceAccess(context, spaceId, "Owner");

    return moveSpaceAccountOwnerRoleWithoutAuthorization(context, {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    });
}

function moveSpaceAccountOwnerRoleWithoutAuthorization(
    context: ServerActionContext,
    {
        spaceId,
        oldOwnerAccountId,
        newOwnerAccountId,
    }: {
        spaceId: SpaceId;
        oldOwnerAccountId: AccountId;
        newOwnerAccountId: AccountId;
    },
): Promise<{
    newOwnerAccount: AccountModel;
    oldOwnerAccount: AccountModel;
}> {
    return context.dynamo.retryTransaction(async context => {
        const [oldSpaceAccountItem, newSpaceAccountItem, oldOwnerAccount, newOwnerAccount] =
            await runAllPromises([
                internalGetSpaceAccountItemIfExistsWithoutAuthorization(
                    context,
                    spaceId,
                    oldOwnerAccountId,
                ),
                internalGetSpaceAccountItemIfExistsWithoutAuthorization(
                    context,
                    spaceId,
                    newOwnerAccountId,
                ),
                dangerouslyGetAccountIfExistsWithoutAuthorization(context, oldOwnerAccountId),
                dangerouslyGetAccountIfExistsWithoutAuthorization(context, newOwnerAccountId),
            ]);

        // These should exist since the corresponding space items exist.
        assert(oldOwnerAccount);
        assert(newOwnerAccount);
        assert(oldSpaceAccountItem);
        assert(newSpaceAccountItem);

        // Double check the old account is an owner. This is important if we need to
        // retry the transaction.
        if (oldSpaceAccountItem.role !== "Owner") {
            throw createAuthorizeSpaceAccessPermissionDeniedError(
                spaceId,
                oldOwnerAccountId,
                "Owner",
            );
        }

        if (newSpaceAccountItem.state.type !== "Active") {
            throw new FailedPreconditionError("Can’t move space owner role to an inactive account");
        }

        if (newSpaceAccountItem.botId) {
            throw new FailedPreconditionError("Can’t move space owner role to bot account");
        }

        // when `oldOwnerAccountId === newOwnerAccountId`, we don't need to update
        // anything although this is impossible to do from Alpine UI.
        if (oldOwnerAccountId === newOwnerAccountId) {
            const account = createAccountModelFromItem(
                {
                    ...oldSpaceAccountItem,
                    // Active accounts should not have an avatar override
                    accountAvatarOverride: null,
                },
                oldOwnerAccount,
            );
            return {
                newOwnerAccount: account,
                oldOwnerAccount: account,
            };
        }

        const oldSpaceAccountItemUpdateEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...oldSpaceAccountItem,
            role: "Admin",
        });
        const newSpaceAccountItemUpdateEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...newSpaceAccountItem,
            role: "Owner",
        });

        await moveSpaceAccountOwnerRoleBeforeExecuteTestCheckpoint.waitForTest(
            `${spaceId}:${newOwnerAccountId}`,
        );

        await DynamoTableSchema.executeTransaction(context, [
            oldSpaceAccountItemUpdateEntry,
            newSpaceAccountItemUpdateEntry,
        ]);

        return {
            newOwnerAccount: createAccountModelFromItem(
                {...newSpaceAccountItemUpdateEntry.newItem, accountAvatarOverride: null},
                newOwnerAccount,
            ),
            oldOwnerAccount: createAccountModelFromItem(
                {...oldSpaceAccountItemUpdateEntry.newItem, accountAvatarOverride: null},
                oldOwnerAccount,
            ),
        };
    });
}

/**
 * Update the account space state with the decision made by the account
 * regarding the invitation to the space. If the account rejects the invitation,
 * the account is marked as "Removed" with a reason of "InviteRejectedAsSpam".
 * If the account accepts the invitation, the account is marked as "Active".
 */
async function updateSpaceAccountWithInviteDecision(
    context: ServerSessionActionContext,
    {spaceId, newAccountStateType}: {spaceId: SpaceId; newAccountStateType: "Active" | "Removed"},
): Promise<AccountModel> {
    context.actor.authorizeSession();
    const accountId = context.actor.getAccountId();
    await authorizeOwnSpaceAccountAccess(context, accountId);

    return context.dynamo.retryTransaction(async context => {
        const [spaceAccountItem, account, accountSpacesItem] = await runAllPromises([
            internalGetSpaceAccountItemIfExistsWithoutAuthorization(context, spaceId, accountId, {
                consistency: "Strong",
            }),
            dangerouslyGetAccountIfExistsWithoutAuthorization(context, accountId, {
                consistency: "Strong",
            }),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!spaceAccountItem) {
            throw new NotFoundError("Account not found in space");
        }

        if (!account) {
            throw new NotFoundError("Account not found");
        }

        if (spaceAccountItem.state?.type !== "InvitePending") {
            throw new FailedPreconditionError("Account invitation is not in pending state");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        const accountInvitePendingSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.invitePendingSpaceIds)
            : new Set();

        accountInvitePendingSpaceIds.delete(spaceId);

        let state: AccountModelDataSpaceState = {type: "Active"};
        if (newAccountStateType === "Active") {
            accountSpaceIds.add(spaceId);
        } else {
            state = {
                type: "Removed",
                removedTime: new Date(),
                oldAccountData: account.initialData,
                reason: "InviteRejectedAsSpam",
            };
        }

        const updateSpaceAccountItemTransactionEntry = SpacesTable.transactionDirectlyUpdateItem({
            ...spaceAccountItem,
            state,
        });
        const deleteAccountAvatarOverrideTransactionEntry =
            newAccountStateType === "Active"
                ? SpacesTable.transactionDeleteItemIfExists({
                      partitionType: "Space",
                      sortRangeType: "AccountAvatarOverride",
                      spaceId,
                      accountId,
                  })
                : undefined;

        await DynamoTableSchema.executeTransaction(context, [
            SpacesTable.transactionDirectlyUpdateItem({
                ...accountSpacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds: accountSpaceIds,
                invitePendingSpaceIds: accountInvitePendingSpaceIds,
            }),
            updateSpaceAccountItemTransactionEntry,
            ...(deleteAccountAvatarOverrideTransactionEntry
                ? [deleteAccountAvatarOverrideTransactionEntry]
                : []),
        ]);

        let accountAvatarOverride = null;
        if (newAccountStateType !== "Active") {
            // NOTE(ifitzsimmons, #account-override-avatar-consistency):
            // “We know there’s a potential eventual consistency race condition here where
            // Space#Account has a non-Active state but we don’t find a
            // Space#AccountAvatarOverride item due to eventual consistency lag. We’re not
            // fixing this since we expect it to be quite rare in practice and the impact to be
            // a pretty minor glitch (removed account appears as if they didn’t have an avatar
            // set).
            accountAvatarOverride = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "AccountAvatarOverride",
                    spaceId,
                    accountId,
                },
                {consistency: "Strong"},
            );
        }

        if (newAccountStateType === "Active") {
            // Reindex the account in all space search indexes where it appears. This may
            // recursively update any search entities where the account is mentioned.
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId,
                update: {
                    type: "Account",
                    accountId,
                    updatedTraits: {type: "Some", traits: ["WithoutSpace"]},
                },
            });
        }

        return createAccountModelFromItem(
            {
                ...updateSpaceAccountItemTransactionEntry.newItem,
                accountAvatarOverride,
            },
            updateSpaceAccountItemTransactionEntry.newItem.state.type === "Active" ? account : null,
        );
    });
}

/**
 * Accept a space account invite by marking the account as "Active".
 */
export async function acceptSpaceAccountInvite(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<AccountModel> {
    return updateSpaceAccountWithInviteDecision(context, {
        spaceId,
        newAccountStateType: "Active",
    });
}

/**
 * Reject a space account invite by marking the account as "Removed" with a reason
 * of "InviteRejectedAsSpam".
 *
 * This function is used when the account decides to reject the invitation to
 * the space, marking it as spam or unwanted.
 */
export async function rejectSpaceAccountInviteAsSpam(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
): Promise<AccountModel> {
    return updateSpaceAccountWithInviteDecision(context, {
        spaceId,
        newAccountStateType: "Removed",
    });
}

export async function finishUploadingSpaceAvatar(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        avatarTheme,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        avatarTheme: AvatarTheme;
    },
): Promise<SpaceModel> {
    context.actor.authorizeSession();
    await authorizeSpaceAccess(context, spaceId, "Admin");

    return context.dynamo.retryTransaction(async context => {
        const oldSpaceItem = await getSpaceItem(context, spaceId);
        const commonUpdateOptions = {
            spaceId,
            avatarContent,
            avatarId,
            oldSpaceItem,
        };

        switch (avatarTheme) {
            case "dark":
                return dangerouslyFinishUploadingSpaceAvatarDarkTheme(context, commonUpdateOptions);
            case "light":
                return dangerouslyFinishUploadingSpaceAvatarLightTheme(
                    context,
                    commonUpdateOptions,
                );
            default:
                throw exhaustive(avatarTheme);
        }
    });
}

/**
 * Updates the space's Dark Theme Avatar WITHOUT ENSURING THE ACTOR IS AN ADMIN..
 *
 * Use `finishUploadingSpaceAvatar()` instead.
 */
async function dangerouslyFinishUploadingSpaceAvatarDarkTheme(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        oldSpaceItem,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        oldSpaceItem: SpaceItem;
    },
): Promise<SpaceModel> {
    const oldAvatarItem = oldSpaceItem.avatars.darkTheme;

    const newAvatarItem: SpaceAvatarDarkThemeItem = {
        ...oldAvatarItem,
        partitionType: "Space",
        sortRangeType: "AvatarDarkTheme",
        spaceId,
        avatarId,
        content: avatarContent,
    };

    const updatedAvatarItem = await SpacesTable.directlyUpdateItem(context, newAvatarItem);

    return createSpaceModelFromItem({
        ...oldSpaceItem,
        avatars: {
            ...oldSpaceItem.avatars,
            darkTheme: updatedAvatarItem,
        },
    });
}

/**
 * Updates the space's Light Theme Avatar WITHOUT ENSURING THE ACTOR IS AN ADMIN.
 *
 * Use `finishUploadingSpaceAvatar()` instead.
 */
async function dangerouslyFinishUploadingSpaceAvatarLightTheme(
    context: ServerSessionActionContext,
    {
        spaceId,
        avatarContent,
        avatarId,
        oldSpaceItem,
    }: {
        spaceId: SpaceId;
        avatarContent: Uint8Array;
        avatarId: AvatarId;
        oldSpaceItem: SpaceItem;
    },
): Promise<SpaceModel> {
    const oldAvatarItem = oldSpaceItem.avatars.lightTheme;

    const newAvatarItem: SpaceAvatarLightThemeItem = {
        ...oldAvatarItem,
        partitionType: "Space",
        sortRangeType: "AvatarLightTheme",
        spaceId,
        avatarId,
        content: avatarContent,
    };

    const updatedAvatarItem = await SpacesTable.directlyUpdateItem(context, newAvatarItem);

    return createSpaceModelFromItem({
        ...oldSpaceItem,
        avatars: {
            ...oldSpaceItem.avatars,
            lightTheme: updatedAvatarItem,
        },
    });
}
