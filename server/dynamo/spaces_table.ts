import {getAccount} from "~/server/dynamo/accounts_table";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {
    RequestContext,
    RequestContextBase,
    UnauthenticatedSessionRequestContext,
} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {ContextCache} from "~/shared/context/cache_context_module";
import {NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {getMaxId, getMinId} from "~/shared/id/id";
import {AccountId, ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {SpaceModel} from "~/shared/models/space_model";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

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
    context: RequestContextBase,
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
 *
 * We cache the result of this function on a per-request basis.
 */
export async function authorizeSpaceAccess(
    context: RequestContext,
    spaceId: SpaceId,
): Promise<void> {
    if (!(await isAccountMemberOfSpace(context, spaceId, context.auth.getAccountId()))) {
        throw new PermissionDeniedError("Account does not have access to space", {
            // TODO(calebmer): Add link to page that lists all spaces an account has access
            // to in the help part of this error message.
            displayMessage: errorDisplayMessage`You are not a member of this space.`,
        });
    }
}

/**
 * Authorize that the authenticated account has access to the provided
 * `spaceId`. Throws if the account does not have access.
 *
 * We cache the result of this function on a per-request basis.
 *
 * If you know the account ID before authenticating, you may pass it in here.
 * This will increase the parallelization of this function since we can call
 * `context.auth.authenticate()` in parallel with authorizing space access for
 * the session account.
 *
 * If you pass in the wrong account ID an error will be thrown.
 */
export async function authorizeSpaceAccessWithOptimisticSessionAccountId(
    context: UnauthenticatedSessionRequestContext,
    spaceId: SpaceId,
    optimisticSessionAccountId: AccountId | undefined,
): Promise<void> {
    const actualAccountIdPromise = context.auth
        .authenticate()
        .then(context => context.auth.getAccountId());

    const [actualAccountId] = await runAllPromises([
        actualAccountIdPromise,
        (async () => {
            const accountId = optimisticSessionAccountId ?? (await actualAccountIdPromise);

            if (!(await isAccountMemberOfSpace(context, spaceId, accountId))) {
                throw new PermissionDeniedError("Account does not have access to space", {
                    // TODO(calebmer): Add link to page that lists all spaces an account has access
                    // to in the help part of this error message.
                    displayMessage: errorDisplayMessage`You are not a member of this space.`,
                });
            }
        })(),
    ]);

    if (
        typeof optimisticSessionAccountId === "string" &&
        optimisticSessionAccountId !== actualAccountId
    ) {
        throw new PermissionDeniedError(
            "Optimistic session account ID does not match actual session account ID",
        );
    }
}

/**
 * Get the space with the specified ID.
 *
 * As a performance optimization, you provide `optimisticSessionAccountId`
 * which is passed to `authorizeSpaceAccess()`. See the documentation of that
 * function for the purpose of `optimisticSessionAccountId`.
 */
export async function getSpaceWithOptimisticSessionAccountId(
    context: UnauthenticatedSessionRequestContext,
    spaceId: SpaceId,
    optimisticSessionAccountId: AccountId | undefined,
): Promise<SpaceModel> {
    const [spaceItem] = await runAllPromises([
        SpacesTable.getItemIfExists(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId,
        }),
        authorizeSpaceAccessWithOptimisticSessionAccountId(
            context,
            spaceId,
            optimisticSessionAccountId,
        ),
    ]);
    if (!spaceItem) throw new NotFoundError("Space does not exist");

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
    context: RequestContext,
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
