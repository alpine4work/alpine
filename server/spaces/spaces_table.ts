import {dangerouslyGetAccountIfExistsWithoutCaching} from "~/server/accounts/accounts_table.js";
import {DynamoActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {ActorContextModule} from "~/server/helpers/actor_context_module.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {getMaxId, getMinId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ContentMentionAccountId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
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
    ],
});

type SpaceAccountItem = DynamoTableItemType<typeof SpacesTable, "Space", "Account">;

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in test environments.
 */
export function getSpacesTableForTest() {
    assert(process.env.NODE_ENV === "test");
    return SpacesTable;
}

export async function seedTestSpaces(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, adminAccountId} = getDynamoSeedConstants();

    await SpacesTable.createItemIfNoneExists(context, {
        partitionType: "Space",
        sortRangeType: "Attributes",
        spaceId: defaultSpaceId,
        name: "Test",
        createdTime: new Date(),
    });

    await SpacesTable.createItemIfNoneExists(context, {
        partitionType: "Space",
        sortRangeType: "Account",
        spaceId: defaultSpaceId,
        accountId: adminAccountId,
        joinedTime: new Date(),
    });
}

/**
 * Transaction entries that add an account to a space.
 *
 * This is only meant for adding accounts to a space during closed alpha. We
 * will probably get rid of this afterwards.
 */
export function createSpaceAccountForAlphaTransactionEntries({
    spaceId,
    accountId,
}: {
    spaceId: SpaceId;
    accountId: AccountId;
}): Array<DynamoTransactionEntry> {
    return [
        // Fail the transaction if the space does not exist.
        SpacesTable.transactionConditionCheck({
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
        }),
        SpacesTable.transactionCreateItem({
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
            joinedTime: new Date(),
        }),
    ];
}

const SpaceAccountContextCache = new ContextCache<
    `${SpaceId}:${AccountId}`,
    SpaceAccountItem | null
>();

/**
 * Is the `accountId` a member of the provided `spaceId`?
 */
export async function isAccountMemberOfSpace(
    context: Context<{
        tracer: TracerContextModule;
        cache: CacheContextModule;
        dynamo: DynamoContextModule;
    }>,
    spaceId: SpaceId,
    accountId: AccountId,
): Promise<boolean> {
    const item = await SpaceAccountContextCache.get(context, `${spaceId}:${accountId}`, () =>
        SpacesTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
        }),
    );
    return !!item;
}

/**
 * Authorize that the authenticated account has access to the provided
 * `spaceId`. Throws if the account does not have access.
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
): Promise<AccountModel | null> {
    return AccountContextCache.get(context, `${spaceId}:${accountId}`, async () => {
        // Make sure we have access to the space being requested.
        await authorizeSpaceAccess(context, spaceId);

        // If we are requesting the authenticated account then return the account model
        // from our context which may already be cached.
        if (context.actor.type === "Session" && context.actor.getAccountId() === accountId)
            return context.actor.getAccount();

        const [account, isMemberOfSpace] = await runAllPromises([
            dangerouslyGetAccountIfExistsWithoutCaching(context, accountId as AccountId),
            isAccountMemberOfSpace(context, spaceId, accountId as AccountId),
        ]);

        // If the account exists but is not a member of the space provided to this
        // function then you are not allowed to read the account.
        if (!isMemberOfSpace) return null;

        return account;
    });
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
): Promise<AccountModel> {
    const account = await getAccountIfExists(context, spaceId, accountId);
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
            SpaceAccountContextCache.set(context, `${item.spaceId}:${item.accountId}`, item);
            return getAccount(context, item.spaceId, item.accountId);
        },
    );
}
