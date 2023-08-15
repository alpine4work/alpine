import {Stack} from "aws-cdk-lib";
import {AttributeType, BillingMode, ProjectionType, Table} from "aws-cdk-lib/aws-dynamodb";
import {getAllDynamoTableSchemas} from "~/admin/dynamo/get_all_dynamo_table_schemas.js";

/**
 * Adds all DynamoDB AWS resources to the provided scope.
 *
 * We collect our DynamoDB AWS resources by importing every module in
 * `server/dynamo` and finding all the `DynamoTableSchema`s that were
 * constructed by those imported modules.
 */
export async function addAllDynamoAwsResources(
    stack: Stack,
): Promise<{dynamoTables: ReadonlyArray<Table>}> {
    const tables: Array<Table> = [];

    for (const tableSchema of await getAllDynamoTableSchemas()) {
        const tableName = tableSchema.getName();
        const tableDescription = tableSchema.getDescription();

        const table = new Table(stack, `${tableName}Table`, {
            tableName,
            partitionKey: {
                name: "partitionKey",
                type: AttributeType.STRING,
            },
            sortKey: {
                name: "sortKey",
                type: AttributeType.STRING,
            },
            timeToLiveAttribute: "expirationTime",
            // Don't allow our tables to be deleted. They contain critical data!
            deletionProtection: true,
            // Enable point-in-time recovery as insurance against disaster. This
            // effectively doubles our storage costs. As our costs increase we should
            // consider only turning this on when we absolutely need it.
            pointInTimeRecovery: true,

            // If we have predictable traffic patterns then provisioned billing mode may be
            // cheaper. If we're consistently utilizing 100% provisioned capacity (very
            // unlikely) then provisioned billing mode is ~7x cheaper.
            //
            // Reconsider billing mode when we have traffic.
            //
            // https://www.serverless.com/blog/dynamodb-on-demand-serverless
            billingMode: BillingMode.PAY_PER_REQUEST,
        });

        tables.push(table);

        for (const [i, indexDescription] of tableDescription.indexes.entries()) {
            const indexNumber = i + 1;

            table.addGlobalSecondaryIndex({
                indexName: `Index${indexNumber}`,
                projectionType: {
                    KeysOnly: ProjectionType.KEYS_ONLY,
                    All: ProjectionType.ALL,
                }[indexDescription.projection],
                partitionKey: {
                    name: `index${indexNumber}PartitionKey`,
                    type: AttributeType.STRING,
                },
                sortKey: {
                    name: `index${indexNumber}SortKey`,
                    type: AttributeType.STRING,
                },
            });
        }
    }

    return {dynamoTables: tables};
}
