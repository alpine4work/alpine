import {CfnOutput, Fn, Stack} from "aws-cdk-lib";
import {AttributeType, BillingMode, ITable, ProjectionType, Table} from "aws-cdk-lib/aws-dynamodb";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {crawlDynamoTableSchemas} from "~/admin/crawl/crawl.js";
import {DynamoClientAction} from "~/server/dynamo/core/dynamo_client_action.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";

const awsDynamoReadPermissionMask = 0b01;
const awsDynamoWritePermissionMask = 0b10;
const awsDynamoReadWritePermissionMask = 0b11;

export class AwsDynamo {
    private readonly _stack: Stack;
    private readonly _tableByName: ReadonlyMap<string, ITable>;

    constructor(stack: Stack, tableByName: ReadonlyMap<string, ITable>) {
        this._stack = stack;
        this._tableByName = tableByName;
    }

    public static async new(parentScope: Stack) {
        const tableByName = new Map<string, ITable>();

        for (const tableSchema of await crawlDynamoTableSchemas()) {
            const tableName = tableSchema.getName();
            const tableDescription = tableSchema.getDescription();

            // NOTE(calebmer, 2023-11-03): This class was initially written before I adopted
            // the pattern of organizing resources into `Construct`s. `Construct`s make it
            // easier to explore CloudFormation resources in a tree view. Now we can't change
            // the logical ID of resources so DynamoDB tables have to be added directly to our
            // stack like this forever.
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
                // Enable point-in-time recovery as insurance against disaster. This effectively
                // doubles our storage costs. As our costs increase we should consider only turning
                // this on for tables that absolutely need it.
                pointInTimeRecoverySpecification: {pointInTimeRecoveryEnabled: true},

                // If we have predictable traffic patterns then provisioned billing mode may be
                // cheaper. If we're consistently utilizing 100% provisioned capacity (very
                // unlikely) then provisioned billing mode is ~7x cheaper.
                //
                // Reconsider billing mode when we have traffic.
                //
                // https://www.serverless.com/blog/dynamodb-on-demand-serverless
                billingMode: BillingMode.PAY_PER_REQUEST,
            });

            tableByName.set(tableName, table);

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

        return new AwsDynamo(parentScope, tableByName);
    }

    /**
     * Grant read/write access to all of our DynamoDB tables.
     */
    public grantReadWriteData(
        grantee: IGrantable,
        options?: {allowExpensiveScan?: boolean; disallowQuery?: boolean},
    ) {
        for (const table of this._tableByName.values()) {
            this._grantData(grantee, table, awsDynamoReadWritePermissionMask, options);
        }
    }

    /**
     * Grant read access to all of our DynamoDB tables.
     */
    public grantReadData(
        grantee: IGrantable,
        options?: {allowExpensiveScan?: boolean; disallowQuery?: boolean},
    ) {
        for (const table of this._tableByName.values()) {
            this._grantData(grantee, table, awsDynamoReadPermissionMask, options);
        }
    }

    /**
     * Grant read/write access to a single DynamoDB table.
     */
    public grantReadWriteDataForTable(
        grantee: IGrantable,
        tableName: string,
        options?: {allowExpensiveScan?: boolean; disallowQuery?: boolean},
    ) {
        const table = assertExists(this._tableByName.get(tableName));
        this._grantData(grantee, table, awsDynamoReadWritePermissionMask, options);
    }

    /**
     * Grant read access to a single DynamoDB table.
     */
    public grantReadDataForTable(
        grantee: IGrantable,
        tableName: string,
        options?: {allowExpensiveScan?: boolean; disallowQuery?: boolean},
    ) {
        const table = assertExists(this._tableByName.get(tableName));
        this._grantData(grantee, table, awsDynamoReadPermissionMask, options);
    }

    private _grantData(
        grantee: IGrantable,
        table: ITable,
        permissionMask: number,
        {
            allowExpensiveScan = false,
            disallowQuery = false,
        }: {
            allowExpensiveScan?: boolean;
            disallowQuery?: boolean;
        } = {},
    ) {
        const allowedDynamoClientActions = filterMapArray(
            Object.entries(
                cast<{
                    [K in
                        | DynamoClientAction
                        // Write transaction entries that aren't top-level DynamoDB actions.
                        | "UpdateItem"
                        | "ConditionCheckItem"]: number | null;
                }>({
                    // Allowed read actions
                    GetItem: awsDynamoReadPermissionMask,
                    BatchGetItem: awsDynamoReadPermissionMask,
                    TransactGetItems: awsDynamoReadPermissionMask,
                    Query: !disallowQuery ? awsDynamoReadPermissionMask : null,
                    ConditionCheckItem: awsDynamoReadPermissionMask,

                    // Allowed write actions
                    PutItem: awsDynamoWritePermissionMask,
                    DeleteItem: awsDynamoWritePermissionMask,
                    BatchWriteItem: awsDynamoWritePermissionMask,
                    TransactWriteItems: awsDynamoWritePermissionMask,
                    UpdateItem: awsDynamoWritePermissionMask,

                    // Not allowed
                    //
                    // Think: If an attacker somehow got access to our container, how could we limit
                    // their damage? Not allowing them to `Scan` to see every item in the table is a
                    // big limitation. They must know item keys or queries to see the relevant data.
                    Scan: allowExpensiveScan ? awsDynamoReadPermissionMask : null,
                    CreateTable: null,
                    DescribeTable: null,
                    DescribeTimeToLive: null,
                    UpdateTimeToLive: null,
                    UpdateTable: null,
                }),
            ),
            ([action, actionPermissionMask]) =>
                actionPermissionMask !== null &&
                (actionPermissionMask & permissionMask) === actionPermissionMask
                    ? action
                    : undefined,
        );

        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                resources: [table.tableArn, `${table.tableArn}/index/*`],
                actions: allowedDynamoClientActions.map(action => `dynamodb:${action}`),
            }),
        );
    }

    public export(tableNames: ReadonlyArray<string>) {
        for (const tableName of tableNames) {
            const table = assertExists(this._tableByName.get(tableName));

            new CfnOutput(this._stack, `${tableName}TableArnExport`, {
                value: table.tableArn,
                exportName: `${this._stack.stackName}:${tableName}TableArn`,
            });
        }

        return (importStack: Stack) => {
            const tableByName = new Map<string, ITable>(
                tableNames.map(tableName => [
                    tableName,
                    Table.fromTableArn(
                        importStack,
                        `${tableName}TableImport`,
                        Fn.importValue(`${this._stack.stackName}:${tableName}TableArn`),
                    ),
                ]),
            );

            return new AwsDynamo(importStack, tableByName);
        };
    }
}
