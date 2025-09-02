// IMPORTANT: We are only importing `@aws-sdk` for types. Use
// the `aws4fetch` module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import {dynamoClientExecuteActionTestCounter} from "~/server/dynamo/core/dynamo_client_execute_action_test_counter.js";
import {dynamoClientGetItemTestCounter} from "~/server/dynamo/core/dynamo_client_get_item_test_counter.js";
import {classifyDynamoError} from "~/server/dynamo/core/internal/classify_dynamo_error.js";
import {AwsRequestSigner} from "~/server/helpers/node/aws_request_signer.js";
import {tracerEventDataDynamoConsumedCapacityKeys} from "~/server/tracer/tracer_event_data_dynamo.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {InternalError, UnavailableError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";
import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";

/**
 * Actions supported by our DynamoDB client.
 */
export type DynamoClientAction = Exclude<keyof DynamoClientInternal, "isLocal">;

export type DynamoClientDebugItemTypes = Iterable<DynamoClientDebugItemType>;

export type DynamoClientDebugItemType = {
    readonly tableName: string;
    readonly partitionType: string;
    readonly sortRangeType: string;
};

function printDynamoClientDebugItemTypesForErrorMessage(
    debugItemTypes: DynamoClientDebugItemTypes,
) {
    const printedDebugItemTypes = [];

    for (const debugItemType of debugItemTypes) {
        printedDebugItemTypes.push(
            `${quote(`${debugItemType.partitionType}#${debugItemType.sortRangeType}`)} in ${quote(
                debugItemType.tableName,
            )}`,
        );
    }

    if (printedDebugItemTypes.length === 0) {
        return "(empty)";
    }

    return joinPrettyConjunctionList(printedDebugItemTypes);
}

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
    private readonly _url: string;
    private readonly _signer: AwsRequestSigner;

    constructor(url: string, signer: AwsRequestSigner) {
        this._url = url;
        this._signer = signer;
    }

    /**
     * Is running against a local DynamoDB?
     */
    public isLocal(): boolean {
        return /^https?:\/\/localhost(\/|:|$)/.test(this._url);
    }

    private async _execute<Input = never, Output = unknown>(
        // Must pass in a `retry` function since we want to create a new span every
        // retry attempt.
        retry: (error?: unknown) => never,
        span: TracerSpan,
        action: DynamoClientAction,
        input: Input,
    ): Promise<Output> {
        if (import.meta.jest) {
            dynamoClientExecuteActionTestCounter.incrementForTest(action);
        }

        let request = new Request(this._url, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-amz-json-1.0",
                "X-Amz-Target": `DynamoDB_20120810.${action}`,
            },
            body: JSON.stringify(input),
        });

        request = await this._signer.sign(request, span);

        // We create our own spans for DynamoDB actions so don't use
        // `fetchWithTracer()`.
        // eslint-disable-next-line no-global-fetch
        const response = await fetch(request).catch(error => {
            // Classify network errors as the `Unavailable` status code.
            throw new UnavailableError(error instanceof Error ? error.message : String(error));
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

            const error = classifyDynamoError(output);

            // The AWS SDK normally handles error retrying automatically but since we make
            // a direct HTTP request we need to implement retries ourselves.
            //
            // > If you're not using an AWS SDK, you should retry original requests that
            // > receive server errors (5xx). However, client errors (4xx, other than a
            // > `ThrottlingException` or a `ProvisionedThroughputExceededException`)
            // > indicate that you need to revise the request itself to correct the problem
            // > before trying again.
            //
            // ([Source][1])
            //
            // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Programming.Errors.html
            if (
                (response.status >= 500 && response.status < 600) ||
                output.__type === "ProvisionedThroughputExceededException" ||
                output.__type === "ThrottlingException"
            ) {
                throw retry(error);
            }

            throw error;
        }

        return output;
    }

    /**
     * DynamoDB [`GetItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    public GetItem(
        tracer: TracerBase,
        input: types.GetItemInput,
        expectsStrongReadConsistency: boolean,
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.GetItemOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB GetItem";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "GetItem",
                        tableName: input.TableName ?? "",
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        consistentRead: input.ConsistentRead ?? false,
                    },
                });

                if (import.meta.jest) {
                    dynamoClientGetItemTestCounter.incrementForTest("GetItem", 1);
                }

                const output = await this._execute<types.GetItemInput, types.GetItemOutput>(
                    retry,
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

                if (expectsStrongReadConsistency && !input.ConsistentRead) {
                    const error = new InternalError(
                        `Expected DynamoDB strong consistency when reading ${printDynamoClientDebugItemTypesForErrorMessage(
                            debugItemTypes,
                        )}`,
                    );

                    if (process.env.NODE_ENV !== "production") {
                        throw error;
                    } else {
                        // In production, log an error but let the method return like normal. In case a
                        // developer accidentally forgot to make a read strong consistency it's
                        // probably fine to log a warning without breaking the product.
                        span.logException("Expected DynamoDB strong consistency", error);
                    }
                }

                return output;
            });
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
        expectsStrongReadConsistency: boolean,
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.BatchGetItemOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB BatchGetItem";

            const tableNames = [];
            let everyConsistentRead = true;
            let batchSize = 0;

            for (const [tableName, requestItem] of Object.entries(input.RequestItems ?? {})) {
                tableNames.push(tableName);
                everyConsistentRead &&= requestItem.ConsistentRead ?? false;
                batchSize += requestItem.Keys?.length ?? 0;
            }

            const tableNamesString = tableNames.sort().join("+");

            if (tableNamesString.length > 0) {
                spanName += ` ${tableNamesString}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "BatchGetItem",
                        tableName: tableNamesString,
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        consistentRead: everyConsistentRead,
                        batchSize,
                    },
                });

                const linkedTracers = new Set<TracerSpan>();

                if (tracer instanceof TracerSpan) linkedTracers.add(tracer);

                // Link our other tracers to the batch span so we can see they are related.
                for (const otherTracer of otherTracers) {
                    if (!(otherTracer instanceof TracerSpan)) continue;

                    if (!linkedTracers.has(otherTracer)) {
                        linkedTracers.add(otherTracer);
                        otherTracer.link(`Batch execution: ${span.getName()}`, span);
                    }
                }

                if (import.meta.jest) {
                    dynamoClientGetItemTestCounter.incrementForTest("BatchGetItem", batchSize);
                }

                const output = await this._execute<
                    types.BatchGetItemInput,
                    types.BatchGetItemOutput
                >(retry, span, "BatchGetItem", {...input, ReturnConsumedCapacity: "INDEXES"});

                span.addData({
                    dynamodb: {
                        consumedCapacity: getConsumedCapacityTracerEventData(
                            output.ConsumedCapacity,
                            "Read",
                        ),
                    },
                });

                if (expectsStrongReadConsistency && !everyConsistentRead) {
                    const error = new InternalError(
                        `Expected DynamoDB strong consistency when reading ${printDynamoClientDebugItemTypesForErrorMessage(
                            debugItemTypes,
                        )}`,
                    );

                    if (process.env.NODE_ENV !== "production") {
                        throw error;
                    } else {
                        // In production, log an error but let the method return like normal. In case a
                        // developer accidentally forgot to make a read strong consistency it's
                        // probably fine to log a warning without breaking the product.
                        span.logException("Expected DynamoDB strong consistency", error);
                    }
                }

                return output;
            });
        });
    }

    /**
     * DynamoDB [`PutItem`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public PutItem(
        tracer: TracerBase,
        input: types.PutItemInput,
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.PutItemOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB PutItem";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "PutItem",
                        tableName: input.TableName ?? "",
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        conditionExpression: input.ConditionExpression,
                    },
                });

                const output = await this._execute<types.PutItemInput, types.PutItemOutput>(
                    retry,
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
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.DeleteItemOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB DeleteItem";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "DeleteItem",
                        tableName: input.TableName ?? "",
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        conditionExpression: input.ConditionExpression,
                    },
                });

                const output = await this._execute<types.DeleteItemInput, types.DeleteItemOutput>(
                    retry,
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
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.BatchWriteItemOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB BatchWriteItem";

            const tableNames = [];
            let batchSize = 0;

            for (const [tableName, writeRequests] of Object.entries(input.RequestItems ?? {})) {
                tableNames.push(tableName);
                batchSize += writeRequests.length;
            }

            const tableNamesString = tableNames.sort().join("+");

            if (tableNamesString.length > 0) {
                spanName += ` ${tableNamesString}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "BatchWriteItem",
                        tableName: tableNamesString,
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        batchSize,
                    },
                });

                const linkedTracers = new Set<TracerSpan>();

                if (tracer instanceof TracerSpan) linkedTracers.add(tracer);

                // Link our other tracers to the batch span so we can see they are related.
                for (const otherTracer of otherTracers) {
                    if (!(otherTracer instanceof TracerSpan)) continue;

                    if (!linkedTracers.has(otherTracer)) {
                        linkedTracers.add(otherTracer);
                        otherTracer.link(`Batch execution: ${span.getName()}`, span);
                    }
                }

                const output = await this._execute<
                    types.BatchWriteItemInput,
                    types.BatchWriteItemOutput
                >(retry, span, "BatchWriteItem", {...input, ReturnConsumedCapacity: "INDEXES"});

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
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.TransactWriteItemsOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB TransactWriteItems";

            const tableNames = new Set<string>();
            const transactItemsSummary: Array<unknown> = [];

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

            const tableNamesString = Array.from(tableNames).sort().join("+");

            if (tableNamesString.length > 0) {
                spanName += ` ${tableNamesString}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "TransactWriteItems",
                        tableName: tableNamesString,
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
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
                >(retry, span, "TransactWriteItems", {
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
        debugItemTypes: DynamoClientDebugItemTypes,
    ): Promise<types.TransactGetItemsOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB TransactGetItems";

            const tableNames = new Set<string>();
            let size = 0;

            for (const transactItem of input.TransactItems ?? []) {
                if (transactItem.Get) {
                    if (transactItem.Get.TableName) tableNames.add(transactItem.Get.TableName);
                    size++;
                }
            }

            const tableNamesString = Array.from(tableNames).sort().join("+");

            if (tableNamesString.length > 0) {
                spanName += ` ${tableNamesString}`;
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "TransactGetItems",
                        tableName: tableNamesString,
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        transactGet: {size},
                    },
                });

                if (import.meta.jest) {
                    dynamoClientGetItemTestCounter.incrementForTest("TransactGetItems", size);
                }

                const output = await this._execute<
                    types.TransactGetItemsInput,
                    types.TransactGetItemsOutput
                >(retry, span, "TransactGetItems", {...input, ReturnConsumedCapacity: "INDEXES"});

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
        });
    }

    /**
     * DynamoDB [`Query`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     */
    public Query(
        tracer: TracerBase,
        input: types.QueryInput,
        {
            expectsStrongReadConsistency,
            debugIndexName,
            debugItemTypes,
        }: {
            expectsStrongReadConsistency: boolean;
            debugIndexName?: string;
            debugItemTypes: DynamoClientDebugItemTypes;
        },
    ): Promise<types.QueryOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB Query";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;

                if (input.IndexName !== undefined) {
                    spanName += ` (${debugIndexName ?? input.IndexName})`;
                }
            }

            return tracer.withSpan(spanName, async span => {
                // We need to set `ReturnConsumedCapacity` for tracing.
                assert(!input.ReturnConsumedCapacity || input.ReturnConsumedCapacity === "INDEXES");

                span.addData({
                    dynamodb: {
                        action: "Query",
                        tableName: input.TableName ?? "",
                        table: getDebugItemTypesTracerEventData(debugItemTypes),
                        consistentRead: input.ConsistentRead ?? false,
                        query: {
                            keyConditionExpression: input.KeyConditionExpression,
                            indexName:
                                input.IndexName !== undefined
                                    ? debugIndexName ?? input.IndexName
                                    : undefined,
                            scanIndexForward: input.ScanIndexForward ?? true,
                            limit: input.Limit,
                            hasExclusiveStartKey:
                                input.ExclusiveStartKey !== undefined ? true : undefined,
                        },
                    },
                });

                const output = await this._execute<types.QueryInput, types.QueryOutput>(
                    retry,
                    span,
                    "Query",
                    {
                        ...input,
                        ReturnConsumedCapacity: "INDEXES",
                    },
                );

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

                if (expectsStrongReadConsistency && !input.ConsistentRead) {
                    const error = new InternalError(
                        `Expected DynamoDB strong consistency when reading ${printDynamoClientDebugItemTypesForErrorMessage(
                            debugItemTypes,
                        )}`,
                    );

                    if (process.env.NODE_ENV !== "production") {
                        throw error;
                    } else {
                        // In production, log an error but let the method return like normal. In case a
                        // developer accidentally forgot to make a read strong consistency it's
                        // probably fine to log a warning without breaking the product.
                        span.logException("Expected DynamoDB strong consistency", error);
                    }
                }

                return output;
            });
        });
    }

    /**
     * DynamoDB [`Scan`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
     */
    public Scan(tracer: TracerBase, input: types.ScanInput): Promise<types.ScanOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB Scan";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
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

                const output = await this._execute<types.ScanInput, types.ScanOutput>(
                    retry,
                    span,
                    "Scan",
                    {
                        ...input,
                        ReturnConsumedCapacity: "INDEXES",
                    },
                );

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
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB CreateTable";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                span.addData({
                    dynamodb: {
                        action: "CreateTable",
                        tableName: input.TableName ?? "",
                    },
                });

                const output = await this._execute<types.CreateTableInput, types.CreateTableOutput>(
                    retry,
                    span,
                    "CreateTable",
                    input,
                );

                return output;
            });
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
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB DescribeTable";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                span.addData({
                    dynamodb: {
                        action: "DescribeTable",
                        tableName: input.TableName ?? "",
                    },
                });

                const output = await this._execute<
                    types.DescribeTableInput,
                    types.DescribeTableOutput
                >(retry, span, "DescribeTable", input);

                return output;
            });
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
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB DescribeTimeToLive";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                span.addData({
                    dynamodb: {
                        action: "DescribeTimeToLive",
                        tableName: input.TableName ?? "",
                    },
                });

                const output = await this._execute<
                    types.DescribeTimeToLiveCommandInput,
                    types.DescribeTimeToLiveCommandOutput
                >(retry, span, "DescribeTimeToLive", input);

                return output;
            });
        });
    }

    /**
     * DynamoDB [`UpdateTable`][1] action.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_UpdateTable.html
     */
    public UpdateTable(
        tracer: TracerBase,
        input: types.UpdateTableCommandInput,
    ): Promise<types.UpdateTableCommandOutput> {
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB UpdateTable";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                span.addData({
                    dynamodb: {
                        action: "UpdateTable",
                        tableName: input.TableName ?? "",
                    },
                });

                const output = await this._execute<
                    types.UpdateTableCommandInput,
                    types.UpdateTableCommandOutput
                >(retry, span, "UpdateTable", input);

                return output;
            });
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
        return retryWithExponentialBackoff(retry => {
            let spanName = "DynamoDB UpdateTimeToLive";

            if (input.TableName !== undefined) {
                spanName += ` ${input.TableName}`;
            }

            return tracer.withSpan(spanName, async span => {
                span.addData({
                    dynamodb: {
                        action: "UpdateTimeToLive",
                        tableName: input.TableName ?? "",
                    },
                });

                const output = await this._execute<
                    types.UpdateTimeToLiveCommandInput,
                    types.UpdateTimeToLiveCommandOutput
                >(retry, span, "UpdateTimeToLive", input);

                return output;
            });
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
                !tracerEventDataDynamoConsumedCapacityKeys.has(consumedCapacity.TableName)
            ) {
                return;
            }

            if (consumedCapacity.Table) {
                add(consumedCapacity.Table, consumedCapacity.TableName);

                if (consumedCapacity.GlobalSecondaryIndexes) {
                    for (const [indexName, indexConsumedCapacity] of Object.entries(
                        consumedCapacity.GlobalSecondaryIndexes,
                    )) {
                        const tableAndIndexName = `${consumedCapacity.TableName}_${indexName}`;

                        // If this is an unrecognized index name then bail out. Don't add its
                        // consumed capacities.
                        if (!tracerEventDataDynamoConsumedCapacityKeys.has(tableAndIndexName)) {
                            continue;
                        }

                        add(indexConsumedCapacity, tableAndIndexName);
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

function getDebugItemTypesTracerEventData(
    itemTypes: DynamoClientDebugItemTypes,
): NonNullable<NonNullable<TracerEventData["dynamodb"]>["table"]> {
    const sortRangeTypesByPartitionTypeByTableName = new Map<string, Map<string, Set<string>>>();

    for (const itemType of itemTypes) {
        const sortRangeTypesByPartitionType = getOrSetDefaultMapValue(
            sortRangeTypesByPartitionTypeByTableName,
            itemType.tableName,
            () => new Map(),
        );

        const sortRangeTypes = getOrSetDefaultMapValue(
            sortRangeTypesByPartitionType,
            itemType.partitionType,
            () => new Set(),
        );

        sortRangeTypes.add(itemType.sortRangeType);
    }

    const eventData: any = {};

    for (const [
        tableName,
        sortRangeTypesByPartitionType,
    ] of sortRangeTypesByPartitionTypeByTableName) {
        const tableEventData: {
            partitionType: string;
            partition: any;
        } = {
            partitionType: Array.from(sortRangeTypesByPartitionType.keys()).sort().join("+"),
            partition: {},
        };
        eventData[tableName] = tableEventData;

        for (const [partitionType, sortRangeTypes] of sortRangeTypesByPartitionType) {
            tableEventData.partition[partitionType] = {
                sortRangeType: Array.from(sortRangeTypes).sort().join("+"),
            };
        }
    }

    return eventData;
}
