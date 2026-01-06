import _Fuse from "fuse.js";
import {dangerouslyGetAccountIfExistsWithoutAuthorization} from "~/server/accounts/dangerously_get_account_if_exists_without_authorization.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {authorizeSpaceAccess} from "~/server/spaces/authorize_space_access.js";
import {createAccountModelFromItem} from "~/server/spaces/internal/create_account_model_from_item.js";
import {SpaceAccountAvatarOverrideItemContextCache} from "~/server/spaces/internal/get_account_if_exists_without_authorization.js";
import {SpaceAccountItemContextCache} from "~/server/spaces/internal/get_space_account_item.js";
import {
    SpaceAccountAvatarOverrideItem,
    SpacesTable,
} from "~/server/spaces/internal/spaces_table.js";
import {accountNameIndexFuseMinMatchCharLength} from "~/server/spaces/space_accounts_cache_constants.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DataLossError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {getMaxId, getMinId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

// Node.js ESM interop (#node-esm-migration)
type Fuse<T> = _Fuse.default<T>;
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

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
export class SpaceAccountsCache {
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
                    this._clearEntry.bind(this, spaceId),
                    spaceAccountsCacheEntryInvalidatedMs,
                ),
            });

            // Clear the cache if `dataPromise` rejects so we try loading the data again.
            dataPromise.catch(() => {
                const entry = this._entryBySpaceId.get(spaceId);
                if (entry?.dataPromise !== dataPromise) return;
                this._clearEntry(spaceId);
            });

            return dataPromise;
        }

        // If we've passed our revalidation interval then start a new data fetch for
        // the space in the background.
        if (
            entry.next !== null &&
            entry.readTime + spaceAccountsCacheEntryRevalidateMs < currentTime
        ) {
            const dataPromise = this._getData(context, spaceId, {isBlocking: false});

            entry.next = {
                readTime: currentTime,
                dataPromise,
            };

            // Make sure our context lives as long as `dataPromise`. Errors are already
            // reported in a span. `waitUntil()` doesn't need to report them.
            context.process.waitUntil(entry.next.dataPromise.catch(() => {}));

            // Once our background promise has finished, update the cache entry to use the
            // new data.
            //
            // If there was an error then we need to clear the cache.
            void entry.next.dataPromise.then(
                () => {
                    const entry = this._entryBySpaceId.get(spaceId);

                    // Our `dataPromise` may have been moved from `entry.next.dataPromise` by the
                    // time this code runs if `_clearEntry()` was called (e.g. when
                    // `entry.dataPromise` rejects).
                    if (entry?.next?.dataPromise !== dataPromise) return;

                    assert(entry.next);

                    entry.timeout.clear();

                    entry.readTime = entry.next.readTime;
                    entry.dataPromise = entry.next.dataPromise;

                    entry.timeout = createTimeout(
                        this._clearEntry.bind(this, spaceId),
                        spaceAccountsCacheEntryInvalidatedMs - (Date.now() - entry.next.readTime),
                    );

                    entry.next = null;
                },
                () => {
                    const entry = this._entryBySpaceId.get(spaceId);

                    // Make sure we're not the active `dataPromise`. We may have been upgraded to
                    // the active `dataPromise` if there was an error.
                    if (entry?.dataPromise === dataPromise) {
                        this._clearEntry(spaceId);
                    } else if (entry?.next?.dataPromise === dataPromise) {
                        entry.next = null;
                    }
                },
            );
        }

        return entry.dataPromise;
    }

    private _clearEntry(spaceId: SpaceId) {
        const entry = this._entryBySpaceId.get(spaceId);
        if (!entry) return;

        entry.timeout.clear();

        if (entry.next === null) {
            this._entryBySpaceId.delete(spaceId);
        } else {
            entry.readTime = entry.next.readTime;
            entry.dataPromise = entry.next.dataPromise;

            entry.timeout = createTimeout(
                this._clearEntry.bind(this, spaceId),
                spaceAccountsCacheEntryInvalidatedMs - (Date.now() - entry.next.readTime),
            );

            entry.next = null;
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
export async function getAllSpaceAccountsWithoutCachingAndWithoutAuthorization(
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

export const spaceAccountsCache = new SpaceAccountsCache();
