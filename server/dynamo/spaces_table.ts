import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {getSeedConstants} from "~/server/dynamo/seed_constants";
import {assert} from "~/shared/helpers/control/assert";
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

export async function seedTestSpaces() {
    assert(process.env.NODE_ENV !== "production");
    const {defaultSpaceId, adminAccountId} = getSeedConstants();

    try {
        await SpacesTable.putItem(
            {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId: defaultSpaceId,
                name: "Test",
                createdTime: new Date(),
            },
            {
                condition: {
                    name: DynamoConditionExpression.exists().not(),
                },
            },
        );
    } catch (error) {
        // If this item already exists, great! This put is a noop.
        if (isDynamoConditionCheckError(error)) return;

        throw error;
    }

    try {
        await SpacesTable.putItem(
            {
                partitionType: "Space",
                sortRangeType: "Account",
                spaceId: defaultSpaceId,
                accountId: adminAccountId,
                joinedTime: new Date(),
            },
            {
                condition: {
                    joinedTime: DynamoConditionExpression.exists().not(),
                },
            },
        );
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
        SpacesTable.transactionConditionCheck(
            {
                partitionType: "Space",
                sortRangeType: "Attributes",
                spaceId,
            },
            {
                name: DynamoConditionExpression.exists(),
            },
        ),
        SpacesTable.transactionPutItem({
            partitionType: "Space",
            sortRangeType: "Account",
            spaceId,
            accountId,
            joinedTime: new Date(),
        }),
    ];
}
