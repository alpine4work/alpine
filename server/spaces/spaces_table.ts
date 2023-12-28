import {
    authorizeInternalAccess,
    dangerouslyGetAccountIfExistsWithoutCaching,
} from "~/server/accounts/accounts_table.js";
import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {DeadlineExceededError, NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
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
import {SpaceModel} from "~/shared/spaces/space_model.js";

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
export async function createSpaceAccountForTest(
    context: DynamoContext,
    {spaceId, accountId}: {spaceId: SpaceId; accountId: AccountId},
) {
    assert(process.env.NODE_ENV === "test");

    // This is a test. We assume the `SpaceId` and `AccountId` exist.

    await context.dynamo.retryTransaction(async context => {
        const spacesItem = await SpacesTable.getItemIfExists(context, {
            partitionType: "Account",
            sortRangeType: "Spaces",
            accountId,
        });

        const spaceIds: Set<SpaceId> = spacesItem ? new Set(spacesItem.spaceIds) : new Set();
        spaceIds.add(spaceId);

        await DynamoTableSchema.executeTransaction(context, [
            SpacesTable.transactionCreateItem({
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId,
                joinedTime: new Date(),
            }),
            SpacesTable.transactionDirectlyUpdateItem({
                ...spacesItem,
                partitionType: "Account",
                sortRangeType: "Spaces",
                accountId,
                spaceIds,
            }),
        ]);
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
                    updatedTraits: {type: "Any"},
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
 * Transaction entries that add an account to a space.
 *
 * This is only meant for adding accounts to a space during closed alpha. We
 * will probably get rid of this afterwards.
 */
export async function createSpaceAccountForAlphaTransactionEntries(
    context: ServerSessionActionContext,
    {
        spaceId,
        accountId,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
    },
): Promise<Array<DynamoTransactionEntry>> {
    // Only accounts with internal access can create alpha accounts. This adds an
    // `AccountId` to an arbitrary `SpaceId`! Pretty dangerous.
    await authorizeInternalAccess(context);

    const spacesItem = await SpacesTable.getItemIfExists(context, {
        partitionType: "Account",
        sortRangeType: "Spaces",
        accountId,
    });

    const spaceIds: Set<SpaceId> = spacesItem ? new Set(spacesItem.spaceIds) : new Set();
    spaceIds.add(spaceId);

    return [
        // Fail the transaction if the space does not exist.
        SpacesTable.transactionConditionCheck({
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
        }),
        SpacesTable.transactionDirectlyUpdateItem({
            ...spacesItem,
            partitionType: "Account",
            sortRangeType: "Spaces",
            accountId,
            spaceIds,
        }),
        SpacesTable.transactionCreateItem(
            {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId,
                accountId,
                joinedTime: new Date(),
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
                            updatedTraits: {type: "Any"},
                        },
                    });
                },
            },
        ),
    ];
}

const SpaceAccountContextCache = new ContextCache<
    `${SpaceId}:${AccountId | ContentMentionAccountId}`,
    boolean
>({
    // Allow sharing this cache because the results do not depend on anything in
    // the context (like the `actor`). Whether we're using a session actor or a
    // system actor does not affect wither an account is a member of a space.
    dangerouslyAllowSharing: true,
});

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
export function isAccountMemberOfSpace(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId | ContentMentionAccountId,
): Promise<boolean> {
    return SpaceAccountContextCache.get(context, `${spaceId}:${accountId}`, async () => {
        let item = await SpacesTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId: accountId as AccountId,
        });

        if (!item) {
            item = await SpacesTable.getItemIfExists(
                context,
                {
                    partitionType: "Space",
                    sortRangeType: "Account",
                    spaceId,
                    accountId: accountId as AccountId,
                },
                {consistency: "Strong"},
            );
        }

        return !!item;
    });
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
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
        actor: ActorContextModule;
    }>,
    spaceId: SpaceId,
): Promise<void> {
    switch (context.actor.type) {
        case "Session": {
            if (!(await isAccountMemberOfSpace(context, spaceId, context.actor.getAccountId()))) {
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

const AccountContextCache = new ContextCache<
    `${SpaceId}:${ContentMentionAccountId}`,
    AccountModel | null
>();

/**
 * Get an account through a provided space. We can only authorize whether you
 * have access to read an account by checking that both you and the account you
 * are trying to read are members of the same space.
 *
 * If the account does not exist, we return null. If the account does exist but
 * is not a member of the provided space then we also return null.
 */
// This lives in `server/spaces` because it needs access to both the account
// table and the space table.
export function getAccountIfExists(
    context: Context<{
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
    const get = async () => {
        // Make sure we have access to the space being requested.
        await authorizeSpaceAccess(context, spaceId);

        // If we are requesting the authenticated account then return the account model
        // from our context which may already be cached.
        if (
            context.actor.type === "Session" &&
            context.actor.getAccountId() === accountId &&
            // If are reading with strong consistency then always read a new `AccountModel`
            // instead of returning the initial, cached, version.
            consistency !== "Strong"
        ) {
            return context.actor.getAccount();
        }

        const [account, isMemberOfSpace] = await runAllPromises([
            dangerouslyGetAccountIfExistsWithoutCaching(context, accountId as AccountId, {
                consistency,
            }),
            isAccountMemberOfSpace(context, spaceId, accountId as AccountId),
        ]);

        // If the account exists but is not a member of the space provided to this
        // function then you are not allowed to read the account.
        if (!isMemberOfSpace) return null;

        return account;
    };

    // If we are reading with a strong DynamoDB read consistency then always
    // execute the read, don't consult the cache. Future reads with eventual
    // consistency may use the cached account from a strong read.
    if (consistency === "Strong") {
        const getPromise = get();
        AccountContextCache.set(context, `${spaceId}:${accountId}`, getPromise);
        return getPromise;
    }

    return AccountContextCache.get(context, `${spaceId}:${accountId}`, get);
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
// TODO(calebmer): Should eventually migrate this to the search system. When
// you initially open an account picker it should show affinitive accounts
// first (based on search entity affinity points). Then you search that list.
// Though if a space has <100 accounts we probably still want to load the
// entire list of accounts to the client instead of searching in OpenSearch.
export async function expensivelyGetAllSpaceAccounts(
    context: ServerActionContext,
    spaceId: SpaceId,
): Promise<Array<AccountModel>> {
    await authorizeSpaceAccess(context, spaceId);

    return parallelMapAsyncIterableToArray(
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
        item => {
            // Future calls to `isAccountMemberOfSpace()` should not need to load a space
            // account item and should instead see the one we've already loaded here.
            SpaceAccountContextCache.set(context, `${item.spaceId}:${item.accountId}`, !!item);
            return getAccount(context, item.spaceId, item.accountId);
        },
    );
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
                ? SpacesTable.transactionItemUpdateLockVersionConditionCheck(
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
