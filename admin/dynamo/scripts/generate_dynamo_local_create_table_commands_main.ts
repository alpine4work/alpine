// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {getAllDynamoTableSchemas} from "~/server/dynamo/get_all_dynamo_table_schemas";

/**
 * Generate a JSON array containing all of the [`CreateTable` command][1]
 * inputs we need to initialize our local DynamoDB database.
 *
 * We generate this intermediate JSON file so that Bazel can short-circuit
 * recreating an empty local DynamoDB database if the file hasn't changed.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
 */
async function main() {
    const commands: Array<types.CreateTableInput> = [];

    for (const tableSchema of getAllDynamoTableSchemas()) {
        const tableName = tableSchema.getName();

        commands.push({
            TableName: tableName,
            AttributeDefinitions: [
                {
                    AttributeName: "partitionKey",
                    AttributeType: "S",
                },
                {
                    AttributeName: "sortKey",
                    AttributeType: "S",
                },
            ],
            KeySchema: [
                {
                    AttributeName: "partitionKey",
                    KeyType: "HASH",
                },
                {
                    AttributeName: "sortKey",
                    KeyType: "RANGE",
                },
            ],
        });
    }

    process.stdout.write(JSON.stringify(commands, null, 2) + "\n");
}

main().then(
    () => {
        process.exitCode = 0;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
