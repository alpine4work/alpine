// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {AwsClient} from "aws4fetch";
import {
    isConstructedDynamoTableSchemaIndexName,
    isConstructedDynamoTableSchemaName,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {classifyDynamoError} from "~/server/dynamo/core/internal/classify_dynamo_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Actions supported by our DynamoDB client.
 */
export type DynamoClientAction = Exclude<keyof DynamoClientInternal, "isLocal">;

/**
 * Type-safe DynamoDB client. We initially created this abstraction when our
 * app server ran in Cloudflare Workers so couldn't use the AWS SDK. Now we
 * probably still need this class (because it implements tracing) but we can
 * call the AWS SDK directly.
 *
 * This DynamoDB client directly executes DynamoDB actions without
 * modification. The `DynamoClient` class provides a more JavaScript friendly
 * interface to DynamoDB with batching, pagination, and camelCase names instead
 * of PascalCase.
 */
// NOTE(calebmer): Originally, all our server code ran on Cloudflare Workers
// which could not use the AWS SDK. That means we had to use `aws4fetch` to
// make requests to DynamoDB. Now that all our code that runs against DynamoDB
// is in Node.js we could use the AWS SDK for DynamoDB but a migration doesn't
// make sense for now.
//
// This class abstraction is still useful because it adds tracing. Maybe it's
// also slightly more efficient since it's so low level?
//
// If/when we migrate there may be some retries we've had to manually implement
// that the SDK does automatically we'd have to sus out.
export class DynamoClientInternal {
    private readonly _getAwsHttpClient: (tracer: TracerBase) => Promise<AwsClient>;
    private readonly _awsDynamoUrl: string;

    constructor({
        getAwsHttpClient,
        awsDynamoUrl,
    }: {
        getAwsHttpClient: (tracer: TracerBase) => Promise<AwsClient>;
        awsDynamoUrl: string;
    }) {
        this._getAwsHttpClient = getAwsHttpClient;
        this._awsDynamoUrl = awsDynamoUrl;
    }

    /**
     * Is running against a local DynamoDB?
     */
    public isLocal(): boolean {
        return /^https?:\/\/localhost(\/|:|$)/.test(this._awsDynamoUrl);
    }

    private async _execute<Input = never, Output = unknown>(
        span: TracerSpan,
        action: DynamoClientAction,
        input: Input,
    ): Promise<Output> {
        const client = await this._getAwsHttpClient(span);
        const response = await client.fetch(this._awsDynamoUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-amz-json-1.0",
                "X-Amz-Target": `DynamoDB_20120810.${action}`,
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
                span?.addData({
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
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

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
                {...input, ReturnConsumedCapacity: "INDEXES"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
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
        otherTracers: Iterable<TracerBase>,
        input: types.BatchGetItemInput,
    ): Promise<types.BatchGetItemOutput> {
        return tracer.withSpan("DynamoDB BatchGetItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

            const tableNames = [];
            let anyConsistentRead = false;
            let batchSize = 0;

            for (const [tableName, requestItem] of Object.entries(input.RequestItems ?? {})) {
                tableNames.push(tableName);
                anyConsistentRead ||= requestItem.ConsistentRead ?? false;
                batchSize += requestItem.Keys?.length ?? 0;
            }

            span.addData({
                dynamodb: {
                    action: "BatchGetItem",
                    tableName: tableNames.sort().join("+"),
                    consistentRead: anyConsistentRead,
                    batchSize,
                },
            });

            const linkedTracerKeys = new Set<`${TraceId}:${TraceSpanId}`>();

            if (tracer instanceof TracerSpan)
                linkedTracerKeys.add(`${tracer.traceId}:${tracer.spanId}`);

            // Link our other tracers to the batch span so we can see they are related.
            for (const otherTracer of otherTracers) {
                if (!(otherTracer instanceof TracerSpan)) continue;
                const otherTracerKey: `${TraceId}:${TraceSpanId}` = `${otherTracer.traceId}:${otherTracer.spanId}`;
                if (!linkedTracerKeys.has(otherTracerKey)) {
                    linkedTracerKeys.add(otherTracerKey);
                    otherTracer.link(span);
                }
            }

            const output = await this._execute<types.BatchGetItemInput, types.BatchGetItemOutput>(
                span,
                "BatchGetItem",
                {...input, ReturnConsumedCapacity: "INDEXES"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
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
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

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
                {...input, ReturnConsumedCapacity: "INDEXES"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Write",
                    ),
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
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

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
                {...input, ReturnConsumedCapacity: "INDEXES"},
            );

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Write",
                    ),
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
        otherTracers: Iterable<TracerBase>,
        input: types.BatchWriteItemInput,
    ): Promise<types.BatchWriteItemOutput> {
        return tracer.withSpan("DynamoDB BatchWriteItem", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

            const tableNames = [];
            let batchSize = 0;

            for (const [tableName, writeRequests] of Object.entries(input.RequestItems ?? {})) {
                tableNames.push(tableName);
                batchSize += writeRequests.length;
            }

            span.addData({
                dynamodb: {
                    action: "BatchWriteItem",
                    tableName: tableNames.sort().join("+"),
                    batchSize,
                },
            });

            const linkedTracerKeys = new Set<`${TraceId}:${TraceSpanId}`>();

            if (tracer instanceof TracerSpan)
                linkedTracerKeys.add(`${tracer.traceId}:${tracer.spanId}`);

            // Link our other tracers to the batch span so we can see they are related.
            for (const otherTracer of otherTracers) {
                if (!(otherTracer instanceof TracerSpan)) continue;
                const otherTracerKey: `${TraceId}:${TraceSpanId}` = `${otherTracer.traceId}:${otherTracer.spanId}`;
                if (!linkedTracerKeys.has(otherTracerKey)) {
                    linkedTracerKeys.add(otherTracerKey);
                    otherTracer.link(span);
                }
            }

            const output = await this._execute<
                types.BatchWriteItemInput,
                types.BatchWriteItemOutput
            >(span, "BatchWriteItem", {...input, ReturnConsumedCapacity: "INDEXES"});

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Write",
                    ),
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
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

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
                        itemCount: input.TransactItems?.length,
                        clientRequestToken: input.ClientRequestToken,
                    },
                },
            });

            const output = await this._execute<
                types.TransactWriteItemsInput,
                types.TransactWriteItemsOutput
            >(span, "TransactWriteItems", {
                ...input,
                // Make sure to include a `ClientRequestToken` in case the underlying
                // `aws4fetch` module retries the transaction. If we were using the AWS SDK
                // this would be handled for us. See:
                // https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-best-practices
                ClientRequestToken: input.ClientRequestToken ?? generateId(),
                ReturnConsumedCapacity: "INDEXES",
            });

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`TransactGetItems`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactGetItems.html
     */
    public TransactGetItems(
        tracer: TracerBase,
        input: types.TransactGetItemsInput,
    ): Promise<types.TransactGetItemsOutput> {
        return tracer.withSpan("DynamoDB TransactGetItems", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

            const tableNames = new Set<string>();
            let size = 0;

            for (const transactItem of input.TransactItems ?? []) {
                if (transactItem.Get) {
                    if (transactItem.Get.TableName) tableNames.add(transactItem.Get.TableName);
                    size++;
                }
            }

            span.addData({
                dynamodb: {
                    action: "TransactGetItems",
                    tableName: Array.from(tableNames).sort().join("+"),
                    transactGet: {size},
                },
            });

            const output = await this._execute<
                types.TransactGetItemsInput,
                types.TransactGetItemsOutput
            >(span, "TransactGetItems", {...input, ReturnConsumedCapacity: "INDEXES"});

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
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
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

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
                ReturnConsumedCapacity: "INDEXES",
            });

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
                    query: {
                        scannedCount: output.ScannedCount ?? 0,
                    },
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`Scan`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
     */
    public Scan(tracer: TracerBase, input: types.ScanInput): Promise<types.ScanOutput> {
        return tracer.withSpan("DynamoDB Scan", async span => {
            // We need to set `ReturnConsumedCapacity` for tracing.
            assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

            span.addData({
                dynamodb: {
                    action: "Scan",
                    tableName: input.TableName ?? "",
                    consistentRead: input.ConsistentRead ?? false,
                    scan: {
                        indexName: input.IndexName,
                        limit: input.Limit,
                        hasExclusiveStartKey:
                            input.ExclusiveStartKey !== undefined ? true : undefined,
                    },
                },
            });

            const output = await this._execute<types.ScanInput, types.ScanOutput>(span, "Scan", {
                ...input,
                ReturnConsumedCapacity: "INDEXES",
            });

            span.addData({
                dynamodb: {
                    consumedCapacity: getConsumedCapacityTracerEventData(
                        output.ConsumedCapacity,
                        "Read",
                    ),
                    scan: {
                        scannedCount: output.ScannedCount ?? 0,
                    },
                },
            });

            return output;
        });
    }

    /**
     * DynamoDB [`CreateTable`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_CreateTable.html
     */
    public CreateTable(
        tracer: TracerBase,
        input: types.CreateTableInput,
    ): Promise<types.CreateTableOutput> {
        return tracer.withSpan("DynamoDB CreateTable", async span => {
            span.addData({
                dynamodb: {
                    action: "CreateTable",
                    tableName: input.TableName ?? "",
                },
            });

            const output = await this._execute<types.CreateTableInput, types.CreateTableOutput>(
                span,
                "CreateTable",
                input,
            );

            return output;
        });
    }

    /**
     * DynamoDB [`DescribeTable`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTable.html
     */
    public DescribeTable(
        tracer: TracerBase,
        input: types.DescribeTableInput,
    ): Promise<types.DescribeTableOutput> {
        return tracer.withSpan("DynamoDB DescribeTable", async span => {
            span.addData({
                dynamodb: {
                    action: "DescribeTable",
                    tableName: input.TableName ?? "",
                },
            });

            const output = await this._execute<types.DescribeTableInput, types.DescribeTableOutput>(
                span,
                "DescribeTable",
                input,
            );

            return output;
        });
    }

    /**
     * DynamoDB [`DescribeTimeToLive`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DescribeTimeToLive.html
     */
    public DescribeTimeToLive(
        tracer: TracerBase,
        input: types.DescribeTimeToLiveCommandInput,
    ): Promise<types.DescribeTimeToLiveCommandOutput> {
        return tracer.withSpan("DynamoDB DescribeTimeToLive", async span => {
            span.addData({
                dynamodb: {
                    action: "DescribeTimeToLive",
                    tableName: input.TableName ?? "",
                },
            });

            const output = await this._execute<
                types.DescribeTimeToLiveCommandInput,
                types.DescribeTimeToLiveCommandOutput
            >(span, "DescribeTimeToLive", input);

            return output;
        });
    }

    /**
     * DynamoDB [`UpdateTimeToLive`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTimeToLive.html
     */
    public UpdateTimeToLive(
        tracer: TracerBase,
        input: types.UpdateTimeToLiveCommandInput,
    ): Promise<types.UpdateTimeToLiveCommandOutput> {
        return tracer.withSpan("DynamoDB UpdateTimeToLive", async span => {
            span.addData({
                dynamodb: {
                    action: "UpdateTimeToLive",
                    tableName: input.TableName ?? "",
                },
            });

            const output = await this._execute<
                types.UpdateTimeToLiveCommandInput,
                types.UpdateTimeToLiveCommandOutput
            >(span, "UpdateTimeToLive", input);

            return output;
        });
    }
}

function getConsumedCapacityTracerEventData(
    consumedCapacities: types.ConsumedCapacity | Array<types.ConsumedCapacity> | undefined,
    capacityUnitsHint: "Read" | "Write",
): NonNullable<TracerEventData["dynamodb"]>["consumedCapacity"] {
    if (!consumedCapacities) return undefined;

    const consumedCapacityEventData: {
        [tableName: string]: NonNullable<
            NonNullable<TracerEventData["dynamodb"]>["consumedCapacity"]
        >[string];
    } = {};

    let totalReadCapacityUnits = 0;
    let totalWriteCapacityUnits = 0;

    const add = (consumedCapacity: types.ConsumedCapacity, key: string | null) => {
        if (key === null) {
            // If our event data schema does not support consumed capacity for this table
            // name then don't return any consumed capacity info.
            if (
                !consumedCapacity.TableName ||
                !isConstructedDynamoTableSchemaName(consumedCapacity.TableName)
            ) {
                return;
            }

            if (consumedCapacity.Table) {
                add(consumedCapacity.Table, consumedCapacity.TableName);

                if (consumedCapacity.GlobalSecondaryIndexes) {
                    for (const [indexName, indexConsumedCapacity] of Object.entries(
                        consumedCapacity.GlobalSecondaryIndexes,
                    )) {
                        // If this is an unrecognized index name then bail out. Don't add its
                        // consumed capacities.
                        if (
                            !isConstructedDynamoTableSchemaIndexName(
                                consumedCapacity.TableName,
                                indexName,
                            )
                        ) {
                            continue;
                        }

                        add(indexConsumedCapacity, `${consumedCapacity.TableName}_${indexName}`);
                    }
                }
                return;
            }

            key = consumedCapacity.TableName;
        }

        // DynamoDB appears to use `CapacityUnits` to mean something different
        // depending on the action. So we depend on the action giving us a hint on how
        // to interpret an unqualified `CapacityUnits`.
        const readCapacityUnits =
            consumedCapacity.ReadCapacityUnits ??
            (capacityUnitsHint === "Read" ? consumedCapacity.CapacityUnits : undefined) ??
            0;
        const writeCapacityUnits =
            consumedCapacity.WriteCapacityUnits ??
            (capacityUnitsHint === "Write" ? consumedCapacity.CapacityUnits : undefined) ??
            0;

        totalReadCapacityUnits += readCapacityUnits;
        totalWriteCapacityUnits += writeCapacityUnits;

        consumedCapacityEventData[key] = {
            readCapacityUnits,
            writeCapacityUnits,
        };
    };

    if (Array.isArray(consumedCapacities)) {
        if (consumedCapacities.length === 0) return undefined;

        for (const consumedCapacity of consumedCapacities) {
            add(consumedCapacity, null);
        }
    } else {
        add(consumedCapacities, null);
    }

    consumedCapacityEventData.totalReadCapacityUnits = totalReadCapacityUnits;
    consumedCapacityEventData.totalWriteCapacityUnits = totalWriteCapacityUnits;

    return consumedCapacityEventData;
}
