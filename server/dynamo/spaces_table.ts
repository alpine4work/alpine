import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {RequestContext} from "~/server/dynamo/context/request_context";
import {getDynamoSeedConstants} from "~/server/dynamo/dynamo_seed_constants";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {PermissionDeniedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {assert} from "~/shared/helpers/control/assert";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {Id} from "~/shared/id/id";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const SpacesTable = DynamoTableSchema.new({
    name: "Spaces",
    partitions: {
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
        Space: {
            partitionKeyAttributes: {
                spaceId: DynamoKeyAttributeSchema.id,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        name: LabelStringSchema,
                        createdTime: Schema.date,
                    }),
                },

                /**
                 * Represents an account that is a member of this space.
                 */
                Account: {
                    sortKeyAttributes: {
                        accountId: DynamoKeyAttributeSchema.id,
                    },
                    attributes: Schema.object({
                        /**
                         * The time at which the account joined the space.
                         */
                        joinedTime: Schema.date,
                    }),
                },
            },
        },
    },
});

/**
 * We are not allowed to export our DynamoDB tables so instead export a
 * function that can only be used in Jest tests.
 */
export function getSpacesTableForTest() {
    assert(typeof jest !== "undefined");
    return SpacesTable;
}

export async function seedTestSpaces(context: DynamoContext) {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, adminAccountId} = getDynamoSeedConstants();

    try {
        await SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Attributes",
            spaceId: defaultSpaceId,
            name: "Test",
            createdTime: new Date(),
        });
    } catch (error) {
        // If this item already exists, great! This put is a noop.
        if (isDynamoConditionCheckError(error)) return;

        throw error;
    }

    try {
        await SpacesTable.createItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId: defaultSpaceId,
            accountId: adminAccountId,
            joinedTime: new Date(),
        });
    } catch (error) {
        // If this item already exists, great! This put is a noop.
        if (isDynamoConditionCheckError(error)) return;

        throw error;
    }
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
    spaceId: Id;
    accountId: Id;
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

// Cache of space authorizations performed against a context.
//
// TODO(calebmer): This cache will break with nested context objects! Replace
// this with something that lasts the entire request.
const authorizationPromiseBySpaceIdByContext = new WeakMap<
    RequestContext,
    Map<Id, Promise<void>>
>();

/**
 * Authorize that the authenticated account has access to the provided
 * `spaceId`. Throws if the account does not have access.
 *
 * We cache the result of this function on a per-request basis.
 */
export function authorizeAccountHasSpaceAccess(
    context: RequestContext,
    spaceId: Id,
): Promise<void> {
    const authorizationPromiseBySpaceId = getOrSetDefaultMapValue(
        authorizationPromiseBySpaceIdByContext,
        context,
        () => new Map(),
    );

    return getOrSetDefaultMapValue(authorizationPromiseBySpaceId, spaceId, async () => {
        const accountId = context.auth.getAccountId();

        const spaceAccountItem = await SpacesTable.getItem(context, {
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
        });

        if (!spaceAccountItem)
            throw new PermissionDeniedError("Account does not have access to space", {
                // TODO(calebmer): Add link to page that lists all spaces an account has access
                // to in the help part of this error message.
                displayMessage: errorDisplayMessage`You are not a member of this space.`,
            });
    });
}
