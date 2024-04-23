import {Stack} from "aws-cdk-lib";
import {AttributeType, BillingMode, ProjectionType, Table} from "aws-cdk-lib/aws-dynamodb";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {getAllDynamoTableSchemas} from "~/admin/dynamo/get_all_dynamo_table_schemas.js";
import {DynamoClientAction} from "~/server/dynamo/core/dynamo_client_action.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {cast} from "~/shared/helpers/control/cast.js";

export class AwsDynamo {
    private readonly _tables: ReadonlyArray<Table>;

    constructor(tables: ReadonlyArray<Table>) {
        this._tables = tables;
    }

    public static async new(parentScope: Stack) {
        const tables: Array<Table> = [];

        for (const tableSchema of await getAllDynamoTableSchemas()) {
            const tableName = tableSchema.getName();
            const tableDescription = tableSchema.getDescription();

            // NOTE(calebmer, 2023-11-03): This class was initially written before I
            // adopted the pattern of organizing resources into `Construct`s. `Construct`s
            // make it easier to explore CloudFormation resources in a tree view. Now we
            // can't change the logical ID of resources so DynamoDB tables have to be
            // added directly to our stack like this forever.
            const table = new Table(parentScope, `${tableName}Table`, {
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
                        name:
                            indexDescription.partitionKeyBehavior.type === "Reused"
                                ? "partitionKey"
                                : `index${indexNumber}PartitionKey`,
                        type: AttributeType.STRING,
                    },
                    sortKey: {
                        name: `index${indexNumber}SortKey`,
                        type: AttributeType.STRING,
                    },
                });
            }
        }

        return new AwsDynamo(tables);
    }

    /**
     * Grant read/write access to all of our DynamoDB tables.
     */
    public grantReadWriteData(
        grantee: IGrantable,
        {allowExpensiveScan = false}: {allowExpensiveScan?: boolean} = {},
    ) {
        const allowedDynamoClientActions = filterMapArray(
            Object.entries(
                cast<{[K in DynamoClientAction]: boolean}>({
                    // Allowed
                    GetItem: true,
                    BatchGetItem: true,
                    PutItem: true,
                    DeleteItem: true,
                    BatchWriteItem: true,
                    TransactWriteItems: true,
                    TransactGetItems: true,
                    Query: true,

                    // Not allowed
                    //
                    // Think: If an attacker somehow got access to our container, how could we limit
                    // their damage? Not allowing them to `Scan` to see every item in the table is a
                    // big limitation. They must know item keys or queries to see the relevant data.
                    Scan: allowExpensiveScan,
                    CreateTable: false,
                    DescribeTable: false,
                    DescribeTimeToLive: false,
                    UpdateTimeToLive: false,
                    UpdateTable: false,
                }),
            ),
            ([action, isAllowed]) => (isAllowed ? action : null),
        );

        for (const table of this._tables) {
            grantee.grantPrincipal.addToPrincipalPolicy(
                new PolicyStatement({
                    resources: [table.tableArn, `${table.tableArn}/index/*`],
                    actions: [
                        ...allowedDynamoClientActions,
                        // Write transaction entries that aren't top-level DynamoDB actions.
                        "UpdateItem",
                        "ConditionCheckItem",
                    ].map(action => `dynamodb:${action}`),
                }),
            );
        }
    }
}
