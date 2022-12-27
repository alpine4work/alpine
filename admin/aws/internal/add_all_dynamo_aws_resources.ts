import * as cdk from "aws-cdk-lib";
import {Construct} from "constructs";
import {getAllDynamoTableSchemas} from "~/server/dynamo/get_all_dynamo_table_schemas";

/**
 * Adds all DynamoDB AWS resources to the provided scope.
 *
 * We collect our DynamoDB AWS resources by importing every module in
 * `server/dynamo` and finding all the `DynamoTableSchema`s that were
 * constructed by those imported modules.
 */
export async function addAllDynamoAwsResources(scope: Construct) {
    for (const tableSchema of getAllDynamoTableSchemas()) {
        const tableName = tableSchema.getName();

        new cdk.aws_dynamodb.Table(scope, `${tableName}Table`, {
            tableName,
            partitionKey: {
                name: "partitionKey",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },
            sortKey: {
                name: "sortKey",
                type: cdk.aws_dynamodb.AttributeType.STRING,
            },

            // If we have predictable traffic patterns then provisioned billing mode may be
            // cheaper. If we're consistently utilizing 100% provisioned capacity (very
            // unlikely) then provisioned billing mode is ~7x cheaper.
            //
            // Reconsider billing mode when we have traffic.
            //
            // https://www.serverless.com/blog/dynamodb-on-demand-serverless
            billingMode: cdk.aws_dynamodb.BillingMode.PAY_PER_REQUEST,
        });
    }
}
