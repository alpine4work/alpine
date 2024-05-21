import _Fuse from "fuse.js";
import {
    authorizeInternalAccess,
    checkAccountVersionConditionCheck,
    dangerouslyGetAccountIfExistsWithoutCaching,
    getAccountByIdAsAdmin,
} from "~/server/accounts/accounts_table.js";
import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {ServerProcessContext} from "~/server/context/server_process_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {
    AccountModelWithoutSpace,
    AccountModelWithoutSpaceData,
    AccountModelWithoutSpaceDataSchema,
} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {
    DataLossError,
    DeadlineExceededError,
    FailedPreconditionError,
    NotFoundError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {generateId, getMaxId, getMinId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ContentMentionAccountId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {IdByteSetSchema} from "~/shared/schema/helpers/id_byte_set_schema.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

// Node.js ESM interop (#node-esm-migration)
type Fuse<T> = _Fuse.default<T>;
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const SpacesTable = DynamoTableSchema.new({
    name: "Spaces",
    partitions: [
        /**
         * We organize all content in our product into spaces. Many accounts may be
         * members of a space and our entities must have a parent space.
         *
         * The name "space" is a generalization of the word "workspace". While right
         * now our products are intended to only be used for work, we may one day
         * enable personal use of our products.
         *
         * Spaces provide a means of data isolation.
         *
         * - Crashes in one space should not affect another space.
         *
         * - If spaces need some resource, we should be able to dynamically scale
         *   spaces independently of one another.
         *
         * - Eventually, to comply to EU regulations we will choose a home region for a
         *   space and all data associated with a space will live there.
         */
        {
            name: "Space",
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        name: LabelStringSchema,
                        createdTime: Schema.date,

                        /**
                         * During our alpha phase, you can manually set this property in the database
                         * and it will be used for some navigation elements until we have proper
                         * implementations.
                         */
                        alphaAccessDefaultChannelId: Schema.id<ChannelId>().optional(),
                    }),
                },

                /**
                 * Represents an account that is a member of this space.
                 */
                {
                    name: "Account",
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id<AccountId>(),
                    },
                    attributes: Schema.object({
                        /**
                         * The time at which the account joined the space.
                         */
                        joinedTime: Schema.date,

                        /**
                         * If non-null then the account was removed from the space. Removed accounts no
                         * longer have access to the space but still show up everywhere in the space
                         * they were previously referenced.
                         */
                        removal: Schema.object({
                            /**
                             * When was the account removed from the space?
                             */
                            time: Schema.date,

                            /**
                             * We maintain a copy of the account's data when they're removed from the space
                             * since if the account updates any properties like their `name` or account
                             * avatar we shouldn't update those properties in spaces the account was
                             * removed from.
                             *
                             * This:
                             *
                             * 1. Prevents accounts from having any influence on spaces from which they
                             *    were removed
                             * 2. Preserve history for those who remain in the space
                             */
                            oldAccountData: AccountModelWithoutSpaceDataSchema,
                        })
                            .nullable()
                            .default(null),
                    }),
                },
            ],
        },

        /**
         * The spaces all of our accounts are members of. This is an item we have to
         * manually maintain instead of a DynamoDB index so we can read an account's
         * spaces with strong read consistency or have transaction conditional checks
         * on an account's space memberships.
         */
        {
            name: "Account",
            partitionKeyAttributes: {
                accountId: DynamoKeyAttributeSchema.id<AccountId>(),
            },
            sortRanges: [
                {
                    name: "Spaces",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        spaceIds: IdByteSetSchema.get<SpaceId>(),
                    }),
                },
            ],
        },
    ],
});

type SpaceAccountItem = DynamoTableItemType<typeof SpacesTable, "Space", "Account">;

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
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    assert(process.env.NODE_ENV === "test");

    await dangerouslyAddSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId,
    });
}

export async function seedTestSpaces(
    context: Context<DynamoContextModules & {jobs: JobsContextModule}>,
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

    try {
        await context.dynamo.retryTransaction(async context => {
            const adminAccountSpacesItem = await SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId: adminAccountId,
            });

            const adminAccountSpaceIds: Set<SpaceId> = adminAccountSpacesItem
                ? new Set(adminAccountSpacesItem.spaceIds)
                : new Set();
            const doesAdminAccountAlreadyHaveDefaultSpaceId =
                adminAccountSpaceIds.has(defaultSpaceId);
            adminAccountSpaceIds.add(defaultSpaceId);

            if (doesAdminAccountAlreadyHaveDefaultSpaceId) return;

            await DynamoTableSchema.executeTransaction(context, [
                SpacesTable.transactionCreateItem({
                    partitionType: "Space",
                    sortRangeType: "Account",
                    spaceId: defaultSpaceId,
                    accountId: adminAccountId,
                    joinedTime: new Date(),
                    removal: null,
                }),
                SpacesTable.transactionDirectlyUpdateItem({
                    ...adminAccountSpaceIds,
                    partitionType: "Account",
                    sortRangeType: "Spaces",
                    accountId: adminAccountId,
                    spaceIds: adminAccountSpaceIds,
                }),
            ]);

            // If we add the admin account to our default space we should also index the
            // admin account in our default space.
            context.jobs.send({
                type: "IndexSearchEntity",
                spaceId: defaultSpaceId,
                update: {
                    type: "Account",
                    accountId: adminAccountId,
                    updatedTraits: {type: "Some", traits: []},
                },
            });
        });
    } catch (error) {
        if (isDynamoConditionCheckError(error) && !(error instanceof DeadlineExceededError)) {
            // We can ignore DynamoDB condition check errors since it means the created
            // item already exists.
            //
            // Though don't ignore `DeadlineExceededError` (thrown by `retryTransaction()`
            // if we retry too many times). That's a real bug in seeding.
        } else {
            throw error;
        }
    }
}

/**
 * To implement `createAlphaSpaceAsAdmin()` we need to update `SpacesTable`
 * and `ForumRealtimeTable`. However, `server/spaces` doesn't have access to
 * `ForumRealtimeTable`. So we implement `createAlphaSpaceAsAdmin()` in
 * `server/forum` and export this function which implements the `SpacesTable`
 * updates we need.
 */
export async function internalCreateAlphaSpaceAsAdmin(
    context: ServerActionContext,
    {
        name,
        spaceId,
        createdTime,
        ownerAccountId,
        welcomeChannelId,
        createWelcomeChannelTransactionEntries,
    }: {
        spaceId: SpaceId;
        createdTime: Date;
        name: string;
        ownerAccountId: AccountId;
        welcomeChannelId: ChannelId;
        createWelcomeChannelTransactionEntries: Array<DynamoTransactionEntry>;
    },
): Promise<void> {
    await authorizeInternalAccess(context);

    // Make sure the account exists before adding it to a space...
    await getAccountByIdAsAdmin(context, ownerAccountId);

    await DynamoTableSchema.executeTransaction(context, [
        SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
            name,
            createdTime,
            alphaAccessDefaultChannelId: welcomeChannelId,
        }),
        ...createWelcomeChannelTransactionEntries,
    ]);

    await dangerouslyAddSpaceAccountAsAdmin(context, {
        spaceId,
        accountId: ownerAccountId,
    });
}

/**
 * Add an account to some space. Only administrators may call this method. But
 * administrators beware! Adding an account to a space gives the account access
 * to data within the space. Make sure you've been given permission by the
 * space owner before adding anyone new to their space.
 */
export async function dangerouslyAddSpaceAccountAsAdmin(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await authorizeInternalAccess(context);
    await dangerouslyAddSpaceAccountWithoutAuthorization(context, {spaceId, accountId});
}

/**
 * Remove an account from some space. Only administrators may call this method.
 *
 * Administrators please make sure you've been given permission by the space
 * owner before removing anyone from a space.
 *
 * This function is not as dangerous as `dangerouslyAddSpaceAccountAsAdmin()`
 * which can enable privilege escalation attacks!
 */
export async function removeSpaceAccountAsAdmin(
    context: ServerActionContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await authorizeInternalAccess(context);
    await dangerouslyRemoveSpaceAccountWithoutAuthorization(context, {spaceId, accountId});
}

/**
 * Adds an account to a space without authorizing the actor has permission to
 * add accounts to the space.
 *
 * This is a very very dangerous function! If arbitrary users got the ability
 * to add any user to any space they could easily compromise the data privacy
 * of spaces. You must authorize the actor is allowed to add accounts when
 * calling this function from an exported function.
 */
async function dangerouslyAddSpaceAccountWithoutAuthorization(
    context: ServerProcessContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await context.dynamo.retryTransaction(async () => {
        const currentTime = new Date();

        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            SpacesTable.getItemIfExists(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            dangerouslyGetAccountIfExistsWithoutCaching(context, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId,
            }),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!spaceItem) {
            throw new NotFoundError("Space not found");
        }
        if (!account) {
            throw new NotFoundError("Account not found");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        if (accountSpaceIds.has(spaceId) || (spaceAccountItem && !spaceAccountItem.removal)) {
            throw new FailedPreconditionError("Account is already a member of space");
        }

        accountSpaceIds.add(spaceId);

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
                spaceIds: accountSpaceIds,
            }),
            !spaceAccountItem
                ? SpacesTable.transactionCreateItem({
                      partitionType: "Space",
                      sortRangeType: "Account",
                      spaceId,
                      accountId,
                      joinedTime: currentTime,
                      removal: null,
                  })
                : SpacesTable.transactionDirectlyUpdateItem({
                      ...spaceAccountItem,
                      // The account was previously a member of the space and is being added back.
                      removal: null,
                  }),
        ]);
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
}

/**
 * Removes an account to a space without authorizing the actor has permission to
 * remove accounts from the space.
 */
async function dangerouslyRemoveSpaceAccountWithoutAuthorization(
    context: ServerProcessContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    await context.dynamo.retryTransaction(async () => {
        const currentTime = new Date();

        const [spaceItem, account, spaceAccountItem, accountSpacesItem] = await runAllPromises([
            SpacesTable.getItemIfExists(context, {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            }),
            dangerouslyGetAccountIfExistsWithoutCaching(context, accountId),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId,
            }),
            SpacesTable.getItemIfExists(context, {
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
            }),
        ]);

        if (!spaceItem) {
            throw new NotFoundError("Space not found");
        }
        if (!account) {
            throw new NotFoundError("Account not found");
        }

        const accountSpaceIds: Set<SpaceId> = accountSpacesItem
            ? new Set(accountSpacesItem.spaceIds)
            : new Set();

        if (!accountSpaceIds.has(spaceId) || !spaceAccountItem || spaceAccountItem.removal) {
            throw new FailedPreconditionError("Account is not a member of the space");
        }

        accountSpaceIds.delete(spaceId);

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
                spaceIds: accountSpaceIds,
            }),
            SpacesTable.transactionDirectlyUpdateItem({
                ...spaceAccountItem,
                removal: {
                    time: currentTime,
                    oldAccountData: account?.initialData,
                },
            }),
        ]);
    });

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

function createAccountModelFromItem(
    item: SpaceAccountItem,
    account: AccountModelWithoutSpace | null,
) {
    // Shouldn't pass in an `AccountModel` if the space account member was removed.
    // Instead we'll use the account data from the space account object.
    let accountData: AccountModelWithoutSpaceData;
    if (item.removal) {
        assert(account === null);
        accountData = item.removal.oldAccountData;
    } else {
        assert(account !== null);
        accountData = account.initialData;
    }

    return new AccountModel({
        ...accountData,
        space: {
            version: item.updateLockVersion ?? 0,
            joinedTime: item.joinedTime,
            wasRemoved: !!item.removal,
        },
    });
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
        if (import.meta.jest) {
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

    public cleanForTest() {
        assert(import.meta.jest);

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
            actor: DynamoActorContextModule;
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
            entry.next.dataPromise.finally(() => {
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

    private _getData(
        context: Context<{
            process: ProcessContextModule;
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>,
        spaceId: SpaceId,
        {isBlocking}: {isBlocking: boolean},
    ): Promise<SpaceAccountsCacheData> {
        return context.tracer.withSpan("Load all space accounts", async (context, span) => {
            span.addData({common: {isBlocking}});

            const accounts = await parallelMapAsyncIterableToArray(
                SpacesTable.query(context, {
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
                    limit: "All",
                }),
                async item => {
                    if (item.removal) {
                        return createAccountModelFromItem(item, null);
                    }

                    let account = await dangerouslyGetAccountIfExistsWithoutCaching(
                        context,
                        item.accountId,
                    );

                    // If we don't find the account it might be because of DynamoDB eventual
                    // consistency lag. Try again with strong consistency.
                    if (!account) {
                        account = await dangerouslyGetAccountIfExistsWithoutCaching(
                            context,
                            item.accountId,
                            {consistency: "Strong"},
                        );
                    }

                    if (!account) {
                        throw new DataLossError(
                            "Space account item exists but account item doesn't",
                        );
                    }

                    return createAccountModelFromItem(item, account);
                },
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
        });
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

const spaceAccountsCache = new SpaceAccountsCache();

export function getSpaceAccountsCacheForTest() {
    assert(import.meta.jest);
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
    accountId: AccountId | ContentMentionAccountId,
): Promise<boolean> {
    // Check if all accounts in the space are cached...
    const accountsCacheData =
        await spaceAccountsCache.dangerouslyGetDataIfExistsWithoutLoadingOrAuthorizing(
            context,
            spaceId,
        );
    const accountFromCache1 = accountsCacheData?.accountById.get(accountId as AccountId);
    if (accountFromCache1 && !accountFromCache1.initialData.space.wasRemoved) return true;

    // Check if `getAccountIfExists()` has loaded the account...
    const accountFromCache2 = await AccountModelContextCache.getIfExists(
        context,
        `${spaceId}:${accountId}`,
    );
    if (accountFromCache2 && !accountFromCache2.initialData.space.wasRemoved) return true;

    // Read the item with eventual consistency (and context caching). This function
    // needs to return true with strong consistency but if the item exists an
    // eventually consistent read will be cheaper and faster. We'll try again with
    // strong consistency if this fails.
    const item1 = await dangerouslyGetSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Eventual",
    });
    if (item1 && !item1.removal) return true;

    // If the item wasn't present in any cache and wasn't present when we read with
    // eventual consistency then trying finding the item again one last time with
    // strong consistency. Since we want to return `true` from this function with
    // strong consistency.
    const item2 = await dangerouslyGetSpaceAccountItemIfExists(context, spaceId, accountId, {
        consistency: "Strong",
    });
    if (item2 && !item2.removal) return true;

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
    accountId: AccountId | ContentMentionAccountId,
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
): Promise<void> {
    switch (context.actor.type) {
        case "Session": {
            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getAccountId(),
                ))
            ) {
                throw new PermissionDeniedError("Account does not have access to space", {
                    // TODO(calebmer): Add link to page that lists all spaces an account has access
                    // to in the help part of this error message.
                    displayMessage: errorDisplayMessage`You are not a member of this space.`,
                });
            }
            break;
        }
        case "System": {
            if (context.actor.getSpaceId() !== spaceId) {
                throw new PermissionDeniedError("System does not have access to space");
            }
            break;
        }
        default:
            throw exhaustive(context.actor);
    }
}

const SpaceAccountItemContextCache = new ContextCache<
    `${SpaceId}:${AccountId | ContentMentionAccountId}`,
    SpaceAccountItem | null
>({
    // Allow sharing this cache because the results do not depend on anything in
    // the context (like the `actor`). Whether we're using a session actor or a
    // system actor does not affect wither an account is a member of a space.
    dangerouslyAllowSharing: true,
});

/**
 * Internal function to get a `SpaceAccountItem`. Caches the result in a
 * context cache.
 *
 * Does not authorize the actor has access! Which is why the function is called
 * "dangerous". You must do that yourself.
 */
async function dangerouslyGetSpaceAccountItemIfExists(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    // You may call this function `ContentMentionAccountId` since it does not throw
    // when the account does not exist in the space.
    accountId: AccountId | ContentMentionAccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<SpaceAccountItem | null> {
    switch (consistency) {
        case "Eventual": {
            return SpaceAccountItemContextCache.get(context, `${spaceId}:${accountId}`, () =>
                SpacesTable.getItemIfExists(
                    context,
                    {
                        partitionType: "Space",
                        sortRangeType: "Account",
                        spaceId,
                        accountId: accountId as AccountId,
                    },
                    {consistency: "Eventual"},
                ),
            );
        }
        case "Strong": {
            const item = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "Account",
                    spaceId,
                    accountId: accountId as AccountId,
                },
                {consistency: "Strong"},
            );

            // We can't read from the cache when using strong consistency, but we can add
            // the item we read to the cache for future eventually consistent reads.
            SpaceAccountItemContextCache.set(context, `${spaceId}:${accountId}`, item);

            return item;
        }
        default:
            throw exhaustive(consistency);
    }
}

const AccountModelContextCache = new ContextCache<
    `${SpaceId}:${ContentMentionAccountId}`,
    AccountModel | null
>();

/**
 * Get an account through a provided space. We can only authorize whether you
 * have access to read an account by checking that both you and the account you
 * are trying to read are members of the same space.
 *
 * If the account does not exist, we return null. If the account does exist but
 * is not a member of the provided space we don't return null! Instead we
 * return an `AccountModel` with `AccountModel.initialData.space.wasRemoved`
 * set to true.
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
        actor: DynamoActorContextModule;
    }>,
    spaceId: SpaceId,
    // You may call this function `ContentMentionAccountId` since it does not throw
    // when the account does not exist in the space.
    accountId: AccountId | ContentMentionAccountId,
    {consistency = "Eventual"}: {consistency?: DynamoReadConsistency} = {},
): Promise<AccountModel | null> {
    // Make sure we have access to the space being requested.
    await authorizeSpaceAccess(context, spaceId);

    const get = async (): Promise<AccountModel | null> => {
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
                return accountsCacheData.accountById.get(accountId as AccountId) ?? null;
            }
        }

        // Otherwise load account data and space account data. If this is the current
        // account, we may have already cached the account item.
        const [account, spaceAccountItem] = await runAllPromises([
            consistency === "Eventual" &&
            context.actor.type === "Session" &&
            context.actor.getAccountId() === accountId
                ? context.actor.getAccount()
                : dangerouslyGetAccountIfExistsWithoutCaching(context, accountId as AccountId, {
                      consistency,
                  }),
            dangerouslyGetSpaceAccountItemIfExists(context, spaceId, accountId, {consistency}),
        ]);

        if (!spaceAccountItem) return null;

        if (spaceAccountItem.removal) {
            return createAccountModelFromItem(spaceAccountItem, null);
        } else {
            // If we have a `SpaceAccountItem` then we must also have an `AccountItem` in
            // our account table.
            if (!account) {
                throw new DataLossError("Space account item exists but account item doesn't");
            }

            return createAccountModelFromItem(spaceAccountItem, account);
        }
    };

    // If we are reading with a strong DynamoDB read consistency then always
    // execute the read, don't consult the cache. Future reads with eventual
    // consistency may use the cached account from a strong read.
    if (consistency === "Strong") {
        const getPromise = get();
        AccountModelContextCache.set(context, `${spaceId}:${accountId}`, getPromise);
        return getPromise;
    }

    return AccountModelContextCache.get(context, `${spaceId}:${accountId}`, get);
}

/**
 * Throw an error if the account can not be found.
 *
 * You should not call this function with `ContentMentionAccountId`! Instead
 * you should call `getAccountIfExists()` since `ContentMentionAccountId` may
 * reference an account in a different space you don't have access to. You
 * should get a type error if you try to call this function
 * with `ContentMentionAccountId`.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export async function getAccount(
    context: Context<{
        process: ProcessContextModule;
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: DynamoActorContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
    options?: {consistency?: DynamoReadConsistency},
): Promise<AccountModel> {
    const account = await getAccountIfExists(context, spaceId, accountId, options);
    if (!account) throw new NotFoundError("Can not find account in space");
    return account;
}

/**
 * Get the space with the specified ID.
 *
 * As a performance optimization, you may provide `optimisticSessionAccountId`
 * which is passed to `authorizeSpaceAccess()`. See the documentation of that
 * function for the purpose of `optimisticSessionAccountId`.
 */
export async function getSpace(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<SpaceModel> {
    await authorizeSpaceAccess(context, spaceId);

    const spaceItem = await SpacesTable.getItem(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId,
    });

    return new SpaceModel({
        id: spaceItem.spaceId,
        name: spaceItem.name,
        alphaAccessDefaultChannelId: spaceItem.alphaAccessDefaultChannelId,
    });
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
): Promise<ReadonlyArray<AccountModel>> {
    const {accounts} = await spaceAccountsCache.getData(context, spaceId);
    return accounts;
}

/**
 * Get the `SpaceId`s our actor is a part of.
 *
 * Also allows you to get a condition check transaction entry that fails if our
 * actor was added to or removed from a space.
 */
export async function getSessionActorAccountSpaces(context: ServerSessionActionContext): Promise<{
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
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return null;
                return match.item;
            });
        },
        searchShortNames: queryText => {
            return filterMapArray(accountShortNameIndex.search(queryText), match => {
                if (match.score! >= accountNameIndexFuseScoreMatchCutoff) return null;
                return match.item;
            });
        },
    };
}
