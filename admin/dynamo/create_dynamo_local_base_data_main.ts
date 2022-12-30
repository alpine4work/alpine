// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {AwsClient} from "aws4fetch";
import crypto from "crypto";
import getPort from "get-port";
import {startDynamoLocal} from "~/admin/dynamo/start_dynamo_local";
import {getAllDynamoTableSchemas} from "~/server/dynamo/get_all_dynamo_table_schemas";
// eslint-disable-next-line no-internal-imports
import {executeDynamoCommand} from "~/server/dynamo/internal/execute_dynamo_command";
import {InvalidArgumentError} from "~/shared/error/error";

// Set the Node.js `webcrypto` implementation to the `crypto` global so that
// client code which runs in a browser has access to the web Crypto API.
(globalThis as any).crypto = crypto.webcrypto;

async function main() {
    const dataPath = process.argv[2];
    if (typeof dataPath !== "string")
        throw new InvalidArgumentError("Expected path to an empty data directory");

    const port = await getPort();

    const dynamoLocal = await startDynamoLocal({
        dataPath,
        port,
    });

    try {
        const client = new AwsClient({
            accessKeyId: "local",
            secretAccessKey: "local",
        });

        for (const tableSchema of getAllDynamoTableSchemas()) {
            const tableName = tableSchema.getName();

            await executeDynamoCommand<types.CreateTableInput>(
                null,
                client,
                `http://localhost:${port}`,
                "CreateTable",
                {
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
                    BillingMode: "PAY_PER_REQUEST",
                },
            );
        }
    } finally {
        await dynamoLocal.stop();
    }
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
