// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {AwsClient} from "aws4fetch";
import {classifyDynamoError} from "~/server/dynamo/internal/classify_dynamo_error";
import {isConstructedDynamoTableSchemaName} from "~/server/dynamo/internal/dynamo_table_schema";
import {assert} from "~/shared/helpers/control/assert";
import {TracerBase} from "~/shared/tracer/tracer_base";
import {TracerSpan} from "~/shared/tracer/tracer_span";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data";

/**
 * Type-safe DynamoDB client that can be executed in a Cloudflare Workers
 * environment and traces all actions.
 *
 * This DynamoDB client directly executes DynamoDB actions without
 * modification. The `DynamoClient` class provides a more JavaScript friendly
 * interface to DynamoDB with batching, pagination, and camelCase names instead
 * of PascalCase.
 */
export class DynamoClientInternal {
    private readonly _client: AwsClient;
    private readonly _url: string;

    constructor(client: AwsClient, url: string) {
        this._client = client;
        this._url = url;
    }

    private async _execute<Input = never, Output = unknown>(
        span: TracerSpan,
        command: string,
        input: Input,
    ): Promise<Output> {
        const response = await this._client.fetch(this._url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-amz-json-1.0",
                "X-Amz-Target": `DynamoDB_20120810.${command}`,
            },
            body: JSON.stringify(input),
        });

        const output: any = await response.json();

        if (response.status !== 200) {
            // When talking to production DynamoDB (vs local DynamoDB), error types are of
            // the form `com.amazonaws.dynamodb.v20120810#TransactionCanceledException`
            // instead of `TransactionCanceledException`. Remove the version number so we
            // just have the error type.
            if (typeof output.__type === "string" && output.__type.includes("#")) {
                output.__type = output.__type.split("#")[1];
            }

            if (typeof output.__type === "string") {
                span.addData({
                    dynamodb: {
                        exception: {
                            type: output.__type,
                            cancellationReasons: output.CancellationReasons
                                ? JSON.stringify(output.CancellationReasons)
                                : undefined,
                        },
                    },
                });
            }

            throw classifyDynamoError(output);
        }

        return output;
    }

    /**
     * DynamoDB [`GetItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    public GetItem(tracer: TracerBase, input: types.GetItemInput): Promise<types.GetItemOutput> {
        return tracer.withSpan("DynamoDB GetItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            span.addData({
                dynamodb: {
                    action: "GetItem",
                    tableName: input.TableName ?? "",
                    consistentRead: input.ConsistentRead ?? false,
                },
            });

            const output = await this._execute<types.GetItemInput, types.GetItemOutput>(
                span,
                "GetItem",
                {...input, ReturnConsumedCapacity: "TOTAL"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`BatchGetItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
     */
    public BatchGetItem(
        tracer: TracerBase,
        input: types.BatchGetItemInput,
    ): Promise<types.BatchGetItemOutput> {
        return tracer.withSpan("DynamoDB BatchGetItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            const tableNames = [];
            let anyConsistentRead = false;

            for (const [tableName, requestItem] of Object.entries(input.RequestItems ?? {})) {
                tableNames.push(tableName);
                anyConsistentRead ||= requestItem.ConsistentRead ?? false;
            }

            span.addData({
                dynamodb: {
                    action: "BatchGetItem",
                    tableName: tableNames.sort().join("+"),
                    consistentRead: anyConsistentRead,
                },
            });

            const output = await this._execute<types.BatchGetItemInput, types.BatchGetItemOutput>(
                span,
                "BatchGetItem",
                {...input, ReturnConsumedCapacity: "TOTAL"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`PutItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public PutItem(tracer: TracerBase, input: types.PutItemInput): Promise<types.PutItemOutput> {
        return tracer.withSpan("DynamoDB PutItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            span.addData({
                dynamodb: {
                    action: "PutItem",
                    tableName: input.TableName ?? "",
                    conditionExpression: input.ConditionExpression,
                },
            });

            const output = await this._execute<types.PutItemInput, types.PutItemOutput>(
                span,
                "PutItem",
                {...input, ReturnConsumedCapacity: "TOTAL"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`DeleteItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    public DeleteItem(
        tracer: TracerBase,
        input: types.DeleteItemInput,
    ): Promise<types.DeleteItemOutput> {
        return tracer.withSpan("DynamoDB DeleteItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            span.addData({
                dynamodb: {
                    action: "DeleteItem",
                    tableName: input.TableName ?? "",
                    conditionExpression: input.ConditionExpression,
                },
            });

            const output = await this._execute<types.DeleteItemInput, types.DeleteItemOutput>(
                span,
                "DeleteItem",
                {...input, ReturnConsumedCapacity: "TOTAL"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`BatchWriteItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public BatchWriteItem(
        tracer: TracerBase,
        input: types.BatchWriteItemInput,
    ): Promise<types.BatchWriteItemOutput> {
        return tracer.withSpan("DynamoDB BatchWriteItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            const tableNames = Object.keys(input.RequestItems ?? {});

            span.addData({
                dynamodb: {
                    action: "BatchWriteItem",
                    tableName: tableNames.sort().join("+"),
                },
            });

            const output = await this._execute<
                types.BatchWriteItemInput,
                types.BatchWriteItemOutput
            >(span, "BatchWriteItem", {...input, ReturnConsumedCapacity: "TOTAL"});

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`TransactWriteItems`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public TransactWriteItems(
        tracer: TracerBase,
        input: types.TransactWriteItemsInput,
    ): Promise<types.TransactWriteItemsOutput> {
        return tracer.withSpan("DynamoDB TransactWriteItems", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            const tableNames = new Set<string>();
            const transactItemsSummary = [];

            for (const transactItem of input.TransactItems ?? []) {
                if (transactItem.ConditionCheck) {
                    if (transactItem.ConditionCheck.TableName)
                        tableNames.add(transactItem.ConditionCheck.TableName);

                    transactItemsSummary.push({
                        ConditionCheck: {
                            TableName: transactItem.ConditionCheck.TableName,
                            ConditionExpression: transactItem.ConditionCheck.ConditionExpression,
                        },
                    });
                }

                if (transactItem.Put) {
                    if (transactItem.Put.TableName) tableNames.add(transactItem.Put.TableName);

                    transactItemsSummary.push({
                        Put: {
                            TableName: transactItem.Put.TableName,
                            ConditionExpression: transactItem.Put.ConditionExpression,
                        },
                    });
                }

                if (transactItem.Delete) {
                    if (transactItem.Delete.TableName)
                        tableNames.add(transactItem.Delete.TableName);

                    transactItemsSummary.push({
                        Delete: {
                            TableName: transactItem.Delete.TableName,
                            ConditionExpression: transactItem.Delete.ConditionExpression,
                        },
                    });
                }

                if (transactItem.Update) {
                    if (transactItem.Update.TableName)
                        tableNames.add(transactItem.Update.TableName);

                    transactItemsSummary.push({
                        Update: {
                            TableName: transactItem.Update.TableName,
                            ConditionExpression: transactItem.Update.ConditionExpression,
                            UpdateExpression: transactItem.Update.UpdateExpression,
                        },
                    });
                }
            }

            span.addData({
                dynamodb: {
                    action: "TransactWriteItems",
                    tableName: Array.from(tableNames).sort().join("+"),
                    transactWrite: {
                        items: JSON.stringify(transactItemsSummary),
                        clientRequestToken: input.ClientRequestToken,
                    },
                },
            });

            const output = await this._execute<
                types.TransactWriteItemsInput,
                types.TransactWriteItemsOutput
            >(span, "TransactWriteItems", {...input, ReturnConsumedCapacity: "TOTAL"});

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`Query`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     */
    public Query(tracer: TracerBase, input: types.QueryInput): Promise<types.QueryOutput> {
        return tracer.withSpan("DynamoDB Query", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "TOTAL");

            span.addData({
                dynamodb: {
                    action: "Query",
                    tableName: input.TableName ?? "",
                    consistentRead: input.ConsistentRead ?? false,
                    query: {
                        keyConditionExpression: input.KeyConditionExpression,
                        indexName: input.IndexName,
                        scanIndexForward: input.ScanIndexForward ?? true,
                        limit: input.Limit,
                        hasExclusiveStartKey:
                            input.ExclusiveStartKey !== undefined ? true : undefined,
                    },
                },
            });

            const output = await this._execute<types.QueryInput, types.QueryOutput>(span, "Query", {
                ...input,
                ReturnConsumedCapacity: "TOTAL",
            });

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(output.ConsumedCapacity),
                    query: {
                        scannedCount: output.ScannedCount ?? 0,
                    },
                },
            });

            return output;
        });
    }
}

function getConsumedCapacityTracerEventData(
    consumedCapacities: types.ConsumedCapacity | Array<types.ConsumedCapacity> | undefined,
): NonNullable<TracerEventData["dynamodb"]>["consumedCapacity"] {
    if (!consumedCapacities) return undefined;

    const consumedCapacityEventData: {
        [tableName: string]: NonNullable<
            NonNullable<TracerEventData["dynamodb"]>["consumedCapacity"]
        >[string];
    } = {};

    let hasConsumedCapacityEventData = false;

    const add = (consumedCapacity: types.ConsumedCapacity) => {
        // If our event data schema does not support consumed capacity for this table
        // name then don't return any consumed capacity info.
        if (
            !consumedCapacity.TableName ||
            !isConstructedDynamoTableSchemaName(consumedCapacity.TableName)
        ) {
            return;
        }

        hasConsumedCapacityEventData = true;

        consumedCapacityEventData[consumedCapacity.TableName] = {
            readCapacityUnits: consumedCapacity.ReadCapacityUnits ?? 0,
            writeCapacityUnits: consumedCapacity.WriteCapacityUnits ?? 0,
        };
    };

    if (Array.isArray(consumedCapacities)) {
        for (const consumedCapacity of consumedCapacities) {
            add(consumedCapacity);
        }
    } else {
        add(consumedCapacities);
    }

    if (!hasConsumedCapacityEventData) return undefined;
    return consumedCapacityEventData;
}
