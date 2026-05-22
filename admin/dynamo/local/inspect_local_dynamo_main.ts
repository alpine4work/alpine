import {
    type AttributeValue,
    DeleteItemCommand,
    DynamoDBClient,
    GetItemCommand,
    ListTablesCommand,
    PutItemCommand,
    QueryCommand,
    ScanCommand,
    type ScanCommandInput,
    UpdateItemCommand,
} from "@aws-sdk/client-dynamodb";
import yargs from "yargs";
import {hideBin} from "yargs/helpers";
import {parseDotenv} from "~/admin/helpers/parse_dotenv.js";
import {InternalError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

const env = parseDotenv();

async function main() {
    const client = createLocalDynamoClient();

    await yargs(hideBin(process.argv))
        .scriptName("inspect")
        .command(
            "list-tables",
            "List all local DynamoDB tables",
            yargs => yargs,
            async () => {
                const response = await client.send(new ListTablesCommand({}));

                for (const tableName of response.TableNames ?? []) {
                    // eslint-disable-next-line no-console
                    console.log(tableName);
                }
            },
        )
        .command(
            "count",
            "Count rows in a table, optionally filtering by attributes",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("filter", {
                        array: true,
                        default: [],
                        describe: "Filter in the format key=value",
                        type: "string",
                        coerce: value => parseFilters(value),
                    });
            },
            async args => {
                const count = await countItems(client, {
                    filters: args.filter,
                    table: args.table,
                });

                // eslint-disable-next-line no-console
                console.log(count);
            },
        )
        .command(
            "scan",
            "Scan rows from a table, optionally filtering by attributes",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("filter", {
                        array: true,
                        default: [],
                        describe: "Filter in the format key=value",
                        type: "string",
                        coerce: value => parseFilters(value),
                    })
                    .option("limit", {
                        default: 10,
                        describe: "Maximum number of rows to return",
                        type: "number",
                        coerce: value => parsePositiveIntegerArg(value, "--limit"),
                    });
            },
            async args => {
                const items = await scanItems(client, {
                    filters: args.filter,
                    limit: args.limit,
                    table: args.table,
                });

                printJson(items);
            },
        )
        .command(
            "get-item",
            "Fetch one item by full primary key",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("key-json", {
                        demandOption: true,
                        describe: "Primary key as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--key-json"),
                    });
            },
            async args => {
                const response = await client.send(
                    new GetItemCommand({
                        Key: args.keyJson,
                        TableName: args.table,
                    }),
                );

                printJson(response);
            },
        )
        .command(
            "put-item",
            "Insert or replace one item",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("item-json", {
                        demandOption: true,
                        describe: "Item as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--item-json"),
                    });
            },
            async args => {
                const response = await client.send(
                    new PutItemCommand({
                        Item: args.itemJson,
                        TableName: args.table,
                    }),
                );

                printJson(response);
            },
        )
        .command(
            "query",
            "Query items by key condition expression",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("key-condition-expression", {
                        demandOption: true,
                        describe: "DynamoDB key condition expression",
                        type: "string",
                    })
                    .option("values-json", {
                        demandOption: true,
                        describe: "Expression attribute values as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--values-json"),
                    })
                    .option("names-json", {
                        describe: "Expression attribute names as JSON",
                        coerce: (value: string | undefined) =>
                            parseOptionalStringRecordJson(value, "--names-json"),
                    });
            },
            async args => {
                const response = await client.send(
                    new QueryCommand({
                        ExpressionAttributeNames: args.namesJson,
                        ExpressionAttributeValues: args.valuesJson,
                        KeyConditionExpression: args.keyConditionExpression,
                        TableName: args.table,
                    }),
                );

                printJson(response);
            },
        )
        .command(
            "update-item",
            "Update one item and return the new value",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("key-json", {
                        demandOption: true,
                        describe: "Primary key as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--key-json"),
                    })
                    .option("update-expression", {
                        demandOption: true,
                        describe: "DynamoDB update expression",
                        type: "string",
                    })
                    .option("values-json", {
                        demandOption: true,
                        describe: "Expression attribute values as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--values-json"),
                    })
                    .option("names-json", {
                        describe: "Expression attribute names as JSON",
                        coerce: (value: string | undefined) =>
                            parseOptionalStringRecordJson(value, "--names-json"),
                    });
            },
            async args => {
                const response = await client.send(
                    new UpdateItemCommand({
                        ExpressionAttributeNames: args.namesJson,
                        ExpressionAttributeValues: args.valuesJson,
                        Key: args.keyJson,
                        ReturnValues: "ALL_NEW",
                        TableName: args.table,
                        UpdateExpression: args.updateExpression,
                    }),
                );

                printJson(response);
            },
        )
        .command(
            "delete-item",
            "Delete one item and return the previous value",
            yargs => {
                return yargs
                    .option("table", {
                        demandOption: true,
                        describe: "DynamoDB table name",
                        type: "string",
                    })
                    .option("key-json", {
                        demandOption: true,
                        describe: "Primary key as DynamoDB AttributeValue JSON",
                        coerce: (value: string) => parseAttributeValueJson(value, "--key-json"),
                    });
            },
            async args => {
                const response = await client.send(
                    new DeleteItemCommand({
                        Key: args.keyJson,
                        ReturnValues: "ALL_OLD",
                        TableName: args.table,
                    }),
                );

                printJson(response);
            },
        )
        .strict()
        .version(false)
        .demandCommand(1, "Must provide a command")
        .fail((message, error, yargs) => {
            if (!error) {
                yargs.showHelp();
                // eslint-disable-next-line no-console
                console.error();
                // eslint-disable-next-line no-console
                console.error(message);
            } else {
                // eslint-disable-next-line no-console
                console.error(`${error.name}: ${error.message}`);
            }
            process.exit(1);
        })
        .parse();
}

/**
 * Create a raw DynamoDB client for the local development database.
 *
 * We intentionally reuse the same credentials as the development environment
 * because DynamoDB Local persists separate databases per credential set.
 */
function createLocalDynamoClient(): DynamoDBClient {
    return new DynamoDBClient({
        credentials: {
            accessKeyId: assertExists(env.AWS_ACCESS_KEY_ID),
            secretAccessKey: assertExists(env.AWS_SECRET_ACCESS_KEY),
        },
        endpoint: `http://localhost:${parseInt(assertExists(env.DYNAMO_LOCAL_PORT), 10)}`,
        region: "us-east-1",
    });
}

async function countItems(
    client: DynamoDBClient,
    {
        filters,
        table,
    }: {
        filters: Array<{name: string; value: string}>;
        table: string;
    },
): Promise<number> {
    let count = 0;
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;

    do {
        const response = await client.send(
            new ScanCommand({
                ...createFilterExpressionInput(filters),
                ExclusiveStartKey: exclusiveStartKey,
                Select: "COUNT",
                TableName: table,
            }),
        );

        count += response.Count ?? 0;
        exclusiveStartKey = response.LastEvaluatedKey;
    } while (exclusiveStartKey);

    return count;
}

async function scanItems(
    client: DynamoDBClient,
    {
        filters,
        limit,
        table,
    }: {
        filters: Array<{name: string; value: string}>;
        limit: number;
        table: string;
    },
): Promise<Array<Record<string, AttributeValue>>> {
    const items: Array<Record<string, AttributeValue>> = [];
    let exclusiveStartKey: Record<string, AttributeValue> | undefined;

    while (items.length < limit) {
        const response = await client.send(
            new ScanCommand({
                ...createFilterExpressionInput(filters),
                ExclusiveStartKey: exclusiveStartKey,
                Limit: Math.max(1, limit - items.length),
                TableName: table,
            }),
        );

        items.push(...(response.Items ?? []));
        exclusiveStartKey = response.LastEvaluatedKey;

        if (!exclusiveStartKey) break;
    }

    return items;
}

function createFilterExpressionInput(
    filters: Array<{name: string; value: string}>,
): Pick<
    ScanCommandInput,
    "ExpressionAttributeNames" | "ExpressionAttributeValues" | "FilterExpression"
> {
    if (filters.length === 0) {
        return {};
    }

    const expressionAttributeNames: NonNullable<ScanCommandInput["ExpressionAttributeNames"]> = {};
    const expressionAttributeValues: NonNullable<ScanCommandInput["ExpressionAttributeValues"]> =
        {};

    const filterExpression = filters
        .map((filter, index) => {
            const nameKey = `#name${index}`;
            const valueKey = `:value${index}`;

            expressionAttributeNames[nameKey] = filter.name;
            expressionAttributeValues[valueKey] = {S: filter.value};

            return `${nameKey} = ${valueKey}`;
        })
        .join(" AND ");

    return {
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        FilterExpression: filterExpression,
    };
}

function parseFilters(
    rawFilters: Array<string> | string | undefined,
): Array<{name: string; value: string}> {
    const filterValues =
        rawFilters === undefined ? [] : Array.isArray(rawFilters) ? rawFilters : [rawFilters];

    return filterValues.map(rawFilter => parseFilter(rawFilter));
}

function parseAttributeValueJson(rawJson: string, argName: string): Record<string, AttributeValue> {
    try {
        return JSON.parse(rawJson) as Record<string, AttributeValue>;
    } catch (error) {
        throw InternalError.from(error, `Invalid JSON for \`${argName}\``);
    }
}

function parseOptionalStringRecordJson(
    rawJson: string | undefined,
    argName: string,
): Record<string, string> | undefined {
    if (rawJson === undefined) return undefined;
    try {
        return JSON.parse(rawJson) as Record<string, string>;
    } catch (error) {
        throw InternalError.from(error, `Invalid JSON for \`${argName}\``);
    }
}

function parseFilter(rawFilter: string): {name: string; value: string} {
    const equalsIndex = rawFilter.indexOf("=");

    if (equalsIndex <= 0 || equalsIndex === rawFilter.length - 1) {
        throw new InternalError("Filters must use the format `--filter key=value`");
    }

    return {
        name: rawFilter.slice(0, equalsIndex),
        value: rawFilter.slice(equalsIndex + 1),
    };
}

function parsePositiveIntegerArg(value: number, argName: string): number {
    if (!Number.isInteger(value) || value < 1) {
        throw new InternalError(`Argument \`${argName}\` must be a positive integer`);
    }

    return value;
}

function printJson(value: unknown) {
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(value, null, 2));
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
