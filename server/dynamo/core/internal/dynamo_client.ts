// IMPORTANT: We are only importing `@aws-sdk` for types. Use the `aws4fetch`
// module for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import jsonStableStringify from "json-stable-stringify";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    fromDynamoAttributeValueObject,
    intoDynamoAttributeValue,
    intoDynamoAttributeValueObject,
} from "~/server/dynamo/core/internal/dynamo_attribute_value.js";
import {
    DynamoClientDebugItemType,
    DynamoClientDebugItemTypes,
    DynamoClientInternal,
} from "~/server/dynamo/core/internal/dynamo_client_internal.js";
import {DynamoTransactionEntryInternal} from "~/server/dynamo/core/internal/dynamo_transaction_entry_internal.js";
import {AwsRequestSigner} from "~/server/helpers/aws_request_signer.js";
import {BatchContextModule, ContextBatcherBase} from "~/shared/context/batch_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {DeadlineExceededError, InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {isPromiseLike} from "~/shared/helpers/async/is_promise_like.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {flatMapIterable} from "~/shared/helpers/iterable/flat_map_iterable.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {SchemaSerializedObjectValue, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

/**
 * Our client interface to DynamoDB.
 *
 * Wraps the low-level `DynamoClientInternal` class with some extra functionality
 * like action batching.
 */
export class DynamoClient {
    private readonly _client: DynamoClientInternal;

    /**
     * Batchers for the [`GetItem`][1] command.
     *
     * We have a separate batcher for our different read consistency levels. If the
     * code tries to do eventual and strong reads simultaneously, we don't want the
     * strong reads to increase the latency of eventual reads.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    private readonly _getItemBatcherByConsistency: {
        [Key in DynamoReadConsistency]: DynamoClientGetItemBatcher;
    };

    /**
     * Batcher for the [`PutItem`][1] and [`DeleteItem`][2] commands.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    private readonly _writeItemBatcher: DynamoClientWriteItemBatcher;

    /**
     * Path to a cache where we keep track of the last version of each table we ensured
     * exists. We've found operations like `DescribeTable` can take a full second in
     * local DynamoDB so avoiding a `DescribeTable` can really speed things up in
     * development.
     */
    public readonly ensureLocalCachePath: string | null;

    constructor({
        url,
        signer,
        ensureLocalCachePath,
    }: {
        url: string;
        signer: AwsRequestSigner;
        ensureLocalCachePath: string | null;
    }) {
        this._client = new DynamoClientInternal(url, signer);
        this._getItemBatcherByConsistency = {
            Eventual: new DynamoClientGetItemBatcher(this._client, "Eventual"),
            Strong: new DynamoClientGetItemBatcher(this._client, "Strong"),
        };
        this._writeItemBatcher = new DynamoClientWriteItemBatcher(this._client);
        this.ensureLocalCachePath = ensureLocalCachePath;
    }

    /**
     * Expose the internal client if we need to do any low-level operations.
     */
    public getInternalClient() {
        return this._client;
    }

    /**
     * Get a single item from DynamoDB. Corresponds to the [`GetItem`][1] command.
     *
     * For `getItemIfExists()` calls made in a short window of time, we will batch them
     * together into a [`BatchGetItem`][2] command.
     *
     * If a `projectionExpression` is provided then we will not batch and send a plain
     * `GetItem` command at this time.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
     */
    public async getItemIfExists(
        context: Context<{batch?: BatchContextModule; tracer: TracerContextModule}>,
        {
            tableName,
            key,
            consistency = "Eventual",
            projectionExpression,
            expressionAttributeNames,
            expectsStrongReadConsistency,
            debugItemType,
        }: {
            tableName: string;
            key: SchemaSerializedObjectValue;
            consistency?: DynamoReadConsistency;
            projectionExpression?: string;
            expressionAttributeNames?: ReadonlyMap<string, string>;
            expectsStrongReadConsistency: boolean;
            debugItemType: DynamoClientDebugItemType;
        },
    ): Promise<SchemaSerializedObjectValue | null> {
        if (context.batch) {
            const batcher = this._getItemBatcherByConsistency[consistency];
            return await batcher.getItem(
                context as Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
                tableName,
                key,
                {projectionExpression, expressionAttributeNames},
                expectsStrongReadConsistency,
                debugItemType,
            );
        }

        const output = await this._client.GetItem(
            context.tracer.getTracer(),
            {
                TableName: tableName,
                Key: intoDynamoAttributeValueObject(key),
                ConsistentRead: consistency === "Strong",
                ProjectionExpression: projectionExpression,
                ExpressionAttributeNames:
                    projectionExpression &&
                    expressionAttributeNames &&
                    expressionAttributeNames.size > 0
                        ? Object.fromEntries(expressionAttributeNames)
                        : undefined,
            },
            expectsStrongReadConsistency,
            [debugItemType],
        );

        if (!output.Item) return null;
        return fromDynamoAttributeValueObject(output.Item);
    }

    /**
     * Put a single item into DynamoDB. Corresponds to the [`PutItem`][1] command.
     *
     * Our DynamoDB class doesn't know which attributes in an item correspond to the
     * key, so we need the caller to give us the `key` object for the item separately.
     *
     * For `putItem()` calls made in a short window of time that don't have conditions,
     * we will batch them together into a [`BatchWriteItem`][2] command.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async putItem(
        context: Context<{batch?: BatchContextModule; tracer: TracerContextModule}>,
        {
            tableName,
            key,
            item,
            conditionExpression,
            expressionAttributeValues,
            expressionAttributeNames,
            retryConditionCheckError = null,
            debugItemType,
        }: {
            tableName: string;
            key: SchemaSerializedObjectValue;
            item: SchemaSerializedObjectValue;
            conditionExpression?: string;
            expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
            expressionAttributeNames?: ReadonlyMap<string, string>;
            retryConditionCheckError?: ((error?: unknown) => never) | null;
            debugItemType: DynamoClientDebugItemType;
        },
    ): Promise<void> {
        // Make sure that all the properties in our `key` also exist in our `item`.
        for (const keyEntry of Object.entries(key)) {
            if (!isDeepEqual(keyEntry[1], item[keyEntry[0]]))
                throw new InvalidArgumentError(
                    quote`Key attribute ${keyEntry[0]} is different in key and item`,
                );
        }

        // Writes without a condition may be batched.
        if (context.batch && conditionExpression === undefined)
            return await this._writeItemBatcher.putItem(
                context as Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
                tableName,
                key,
                item,
                debugItemType,
            );

        try {
            await this._client.PutItem(
                context.tracer.getTracer(),
                {
                    TableName: tableName,
                    Item: intoDynamoAttributeValueObject(item),
                    ConditionExpression: conditionExpression,
                    ExpressionAttributeValues:
                        expressionAttributeValues && expressionAttributeValues.size > 0
                            ? Object.fromEntries(
                                  mapIterable(expressionAttributeValues, ([name, value]) => [
                                      name,
                                      intoDynamoAttributeValue(value),
                                  ]),
                              )
                            : undefined,
                    ExpressionAttributeNames:
                        expressionAttributeNames && expressionAttributeNames.size > 0
                            ? Object.fromEntries(expressionAttributeNames)
                            : undefined,
                },
                [debugItemType],
            );
        } catch (error) {
            let errorCause = error;
            while (errorCause instanceof Error && "cause" in errorCause)
                errorCause = errorCause.cause;

            if (
                isObject(errorCause) &&
                (errorCause.__type === "ConditionalCheckFailedException" ||
                    // If a PutItem request for an item conflicts with an ongoing TransactWriteItems
                    // request that includes the same item, the request fails with a
                    // TransactionConflictException [1].
                    //
                    // [1]:
                    //     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-conflict-handling
                    errorCause.__type === "TransactionConflictException")
            ) {
                retryConditionCheckError?.(error);
            }

            throw error;
        }
    }

    /**
     * Delete a single item from DynamoDB. Corresponds to the [`DeleteItem`][1]
     * command.
     *
     * For `deleteItem()` calls made in a short window of time that don't have
     * conditions, we will batch them together into a [`BatchWriteItem`][2] command.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async deleteItem(
        context: Context<{batch?: BatchContextModule; tracer: TracerContextModule}>,
        {
            tableName,
            key,
            conditionExpression,
            expressionAttributeValues,
            expressionAttributeNames,
            retryConditionCheckError = null,
            debugItemType,
        }: {
            tableName: string;
            key: SchemaSerializedObjectValue;
            conditionExpression?: string;
            expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
            expressionAttributeNames?: ReadonlyMap<string, string>;
            retryConditionCheckError?: ((error?: unknown) => never) | null;
            debugItemType: DynamoClientDebugItemType;
        },
    ): Promise<void> {
        // Writes without a condition may be batched.
        if (context.batch && conditionExpression === undefined)
            return await this._writeItemBatcher.deleteItem(
                context as Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
                tableName,
                key,
                debugItemType,
            );

        try {
            await this._client.DeleteItem(
                context.tracer.getTracer(),
                {
                    TableName: tableName,
                    Key: intoDynamoAttributeValueObject(key),
                    ConditionExpression: conditionExpression,
                    ExpressionAttributeValues:
                        expressionAttributeValues && expressionAttributeValues.size > 0
                            ? Object.fromEntries(
                                  mapIterable(expressionAttributeValues, ([name, value]) => [
                                      name,
                                      intoDynamoAttributeValue(value),
                                  ]),
                              )
                            : undefined,
                    ExpressionAttributeNames:
                        conditionExpression &&
                        expressionAttributeNames &&
                        expressionAttributeNames.size > 0
                            ? Object.fromEntries(expressionAttributeNames)
                            : undefined,
                },
                [debugItemType],
            );
        } catch (error) {
            let errorCause = error;
            while (errorCause instanceof Error && "cause" in errorCause)
                errorCause = errorCause.cause;

            if (
                isObject(errorCause) &&
                (errorCause.__type === "ConditionalCheckFailedException" ||
                    // If a DeleteItem request for an item conflicts with an ongoing TransactWriteItems
                    // request that includes the same item, the request fails with a
                    // TransactionConflictException [1].
                    //
                    // [1]:
                    //     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html#transaction-conflict-handling
                    errorCause.__type === "TransactionConflictException")
            ) {
                retryConditionCheckError?.(error);
            }

            throw error;
        }
    }

    /**
     * Perform up to 25 actions atomically with [`TransactWriteItems`][1]. Either all
     * actions in the transaction succeed or if one action fails then none of the
     * actions in the transaction will be applied.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public async executeTransaction(
        context: DynamoContext,
        entries: ReadonlyArray<DynamoTransactionEntry>,
        {
            clientRequestToken,
            retryConditionCheckError = null,
        }: {
            clientRequestToken?: string;
            retryConditionCheckError?: ((error?: unknown) => never) | null;
        },
    ): Promise<void> {
        const actualEntries: Array<DynamoTransactionEntryInternal> = [];
        const transactItems: Array<types.TransactWriteItem> = [];
        const debugItemTypes: Array<DynamoClientDebugItemType> = [];

        // Run all before transaction callbacks even if one of them has an error.
        {
            const errors: Array<unknown> = [];
            const promises: Array<Promise<void>> = [];

            for (const entry of entries) {
                assert(entry instanceof DynamoTransactionEntryInternal);

                actualEntries.push(entry);
                transactItems.push(entry.transactItem);
                debugItemTypes.push(entry.debugItemType);

                try {
                    const maybePromise = entry.onBeforeExecuteTransaction?.(context);

                    if (isPromiseLike(maybePromise)) {
                        promises.push(maybePromise);
                    }
                } catch (error) {
                    errors.push(error);
                }
            }

            if (promises.length > 0) {
                try {
                    await runAllPromises(promises);
                } catch (error) {
                    errors.push(error);
                }
            }

            if (errors.length > 0) {
                throw createAggregateError(errors);
            }
        }

        try {
            await this._client.TransactWriteItems(
                context.tracer.getTracer(),
                {TransactItems: transactItems, ClientRequestToken: clientRequestToken},
                debugItemTypes,
            );
        } catch (error) {
            let errorCause = error;
            while (errorCause instanceof Error && "cause" in errorCause)
                errorCause = errorCause.cause;

            if (
                isObject(errorCause) &&
                errorCause.__type === "TransactionCanceledException" &&
                Array.isArray(errorCause.CancellationReasons) &&
                errorCause.CancellationReasons.every(
                    (cancellationReason, index) =>
                        isObject(cancellationReason) &&
                        (cancellationReason.Code === "None" ||
                            cancellationReason.Code === "TransactionConflict" ||
                            (actualEntries[index]?.isConditionCheckErrorRetriable &&
                                cancellationReason.Code === "ConditionalCheckFailed")),
                )
            ) {
                retryConditionCheckError?.(error);
            }

            throw error;
        }

        // Run all after transaction callbacks even if one of them has an error.
        {
            const errors: Array<unknown> = [];
            const promises: Array<Promise<void>> = [];

            for (const entry of actualEntries) {
                try {
                    const maybePromise = entry.onAfterTransactionExecutedSuccessfully?.(context);

                    if (isPromiseLike(maybePromise)) {
                        promises.push(maybePromise);
                    }
                } catch (error) {
                    errors.push(error);
                }
            }

            if (promises.length > 0) {
                try {
                    await runAllPromises(promises);
                } catch (error) {
                    errors.push(error);
                }
            }

            if (errors.length > 0) {
                throw createAggregateError(errors);
            }
        }
    }

    /**
     * Create an `PutItem` entry for [`TransactWriteItems`][1]. Will not be executed
     * until you call `executeTransaction()` with other transaction entries.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public static transactionPutItem({
        tableName,
        item,
        conditionExpression,
        expressionAttributeValues,
        expressionAttributeNames,
        isConditionCheckErrorRetriable = false,
        onBeforeExecuteTransaction = null,
        onAfterTransactionExecutedSuccessfully = null,
        debugItemType,
    }: {
        tableName: string;
        item: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
        expressionAttributeNames?: ReadonlyMap<string, string>;
        isConditionCheckErrorRetriable?: boolean;
        onBeforeExecuteTransaction?: ((context: DynamoContext) => MaybePromise<void>) | null;
        onAfterTransactionExecutedSuccessfully?:
            | ((context: DynamoContext) => MaybePromise<void>)
            | null;
        debugItemType: DynamoClientDebugItemType;
    }): DynamoTransactionEntry {
        return new DynamoTransactionEntryInternal({
            transactItem: {
                Put: {
                    TableName: tableName,
                    Item: intoDynamoAttributeValueObject(item),
                    ConditionExpression: conditionExpression,
                    ExpressionAttributeValues:
                        conditionExpression &&
                        expressionAttributeValues &&
                        expressionAttributeValues.size > 0
                            ? Object.fromEntries(
                                  mapIterable(expressionAttributeValues, ([name, value]) => [
                                      name,
                                      intoDynamoAttributeValue(value),
                                  ]),
                              )
                            : undefined,
                    ExpressionAttributeNames:
                        conditionExpression &&
                        expressionAttributeNames &&
                        expressionAttributeNames.size > 0
                            ? Object.fromEntries(expressionAttributeNames)
                            : undefined,
                },
            },
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully,
            debugItemType,
        });
    }

    /**
     * Create a `DeleteItem` entry for [`TransactWriteItems`][1]. Will not be executed
     * until you call `executeTransaction()` with other transaction entries.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public static transactionDeleteItem({
        tableName,
        key,
        conditionExpression,
        expressionAttributeValues,
        expressionAttributeNames,
        isConditionCheckErrorRetriable = false,
        onBeforeExecuteTransaction = null,
        onAfterTransactionExecutedSuccessfully = null,
        debugItemType,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
        expressionAttributeNames?: ReadonlyMap<string, string>;
        isConditionCheckErrorRetriable?: boolean;
        onBeforeExecuteTransaction?: ((context: DynamoContext) => MaybePromise<void>) | null;
        onAfterTransactionExecutedSuccessfully?: ((context: DynamoContext) => void) | null;
        debugItemType: DynamoClientDebugItemType;
    }): DynamoTransactionEntry {
        return new DynamoTransactionEntryInternal({
            transactItem: {
                Delete: {
                    TableName: tableName,
                    Key: intoDynamoAttributeValueObject(key),
                    ConditionExpression: conditionExpression,
                    ExpressionAttributeValues:
                        conditionExpression &&
                        expressionAttributeValues &&
                        expressionAttributeValues.size > 0
                            ? Object.fromEntries(
                                  mapIterable(expressionAttributeValues, ([name, value]) => [
                                      name,
                                      intoDynamoAttributeValue(value),
                                  ]),
                              )
                            : undefined,
                    ExpressionAttributeNames:
                        conditionExpression &&
                        expressionAttributeNames &&
                        expressionAttributeNames.size > 0
                            ? Object.fromEntries(expressionAttributeNames)
                            : undefined,
                },
            },
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully,
            debugItemType,
        });
    }

    /**
     * Create a `ConditionCheck` entry for [`TransactWriteItems`][1]. Will not be
     * executed until you call `executeTransaction()` with other transaction entries.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public static transactionConditionCheck({
        tableName,
        key,
        conditionExpression,
        expressionAttributeValues,
        expressionAttributeNames,
        isConditionCheckErrorRetriable = false,
        onBeforeExecuteTransaction = null,
        onAfterTransactionExecutedSuccessfully = null,
        debugItemType,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        conditionExpression: string;
        expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
        expressionAttributeNames?: ReadonlyMap<string, string>;
        isConditionCheckErrorRetriable?: boolean;
        onBeforeExecuteTransaction?: ((context: DynamoContext) => MaybePromise<void>) | null;
        onAfterTransactionExecutedSuccessfully?: ((context: DynamoContext) => void) | null;
        debugItemType: DynamoClientDebugItemType;
    }): DynamoTransactionEntry {
        return new DynamoTransactionEntryInternal({
            transactItem: {
                ConditionCheck: {
                    TableName: tableName,
                    Key: intoDynamoAttributeValueObject(key),
                    ConditionExpression: conditionExpression,
                    ExpressionAttributeValues:
                        conditionExpression &&
                        expressionAttributeValues &&
                        expressionAttributeValues.size > 0
                            ? Object.fromEntries(
                                  mapIterable(expressionAttributeValues, ([name, value]) => [
                                      name,
                                      intoDynamoAttributeValue(value),
                                  ]),
                              )
                            : undefined,
                    ExpressionAttributeNames:
                        conditionExpression &&
                        expressionAttributeNames &&
                        expressionAttributeNames.size > 0
                            ? Object.fromEntries(expressionAttributeNames)
                            : undefined,
                },
            },
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully,
            debugItemType,
        });
    }

    /**
     * Gets multiple items from DynamoDB with a serializable transaction isolation
     * level. Corresponds to the [`TransactGetItems`][1] command.
     *
     * Read more about DynamoDB transactions [here][2].
     *
     * You probably want to wrap this function in a call to
     * `context.dynamo.retryTransaction()`. If there is a transaction in-progress then
     * this method will throw.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactGetItems.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html
     */
    public async executeGetItemsTransaction(
        tracer: TracerBase,
        {
            tableName,
            keys,
            retryTransactionConflictError,
            debugItemTypes,
        }: {
            tableName: string;
            keys: ReadonlyArray<SchemaSerializedObjectValue>;
            retryTransactionConflictError: (error?: unknown) => never;
            debugItemTypes: DynamoClientDebugItemTypes;
        },
    ): Promise<Array<SchemaSerializedObjectValue | null>> {
        try {
            const output = await this._client.TransactGetItems(
                tracer,
                {
                    TransactItems: keys.map(key => ({
                        Get: {
                            TableName: tableName,
                            Key: intoDynamoAttributeValueObject(key),
                        },
                    })),
                },
                debugItemTypes,
            );

            return (output.Responses ?? []).map(response =>
                response.Item ? fromDynamoAttributeValueObject(response.Item) : null,
            );
        } catch (error) {
            let errorCause = error;
            while (errorCause instanceof Error && "cause" in errorCause)
                errorCause = errorCause.cause;

            if (
                isObject(errorCause) &&
                errorCause.__type === "TransactionCanceledException" &&
                Array.isArray(errorCause.CancellationReasons) &&
                errorCause.CancellationReasons.every(
                    cancellationReason =>
                        isObject(cancellationReason) &&
                        (cancellationReason.Code === "None" ||
                            cancellationReason.Code === "TransactionConflict"),
                )
            ) {
                retryTransactionConflictError(error);
            }

            throw error;
        }
    }

    /**
     * Performs a [`Query`][1] operation against DynamoDB. A query lets us read items
     * from the table between two sort keys in a partition.
     *
     * DynamoDB only returns 1 MB of data at a time and you're expected to [paginate to
     * fetch the rest of the data][2]. This function abstracts that away. By returning
     * a JavaScript async iterator, the consumer may break the iterator at any time and
     * it will stop pagination.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
     */
    async *query(
        tracer: TracerBase,
        options: {
            tableName: string;
            indexName?: string;
            partitionKey: {
                name: string;
                value: SchemaSerializedValue;
            };
            sortKey?: {
                name: string;
                startValue?: SchemaSerializedValue;
                endValue?: SchemaSerializedValue;
                isStartExclusive?: boolean;
                isEndExclusive?: boolean;
            };
            lastEvaluatedKey?: SchemaSerializedObjectValue;
            consistency?: DynamoReadConsistency;
            limit?: number;
            pageLimit?: number;
            descending?: boolean;
            debugIndexName?: string;
            expectsStrongReadConsistency: boolean;
            debugItemTypes: DynamoClientDebugItemTypes;
        },
    ): AsyncIterableIterator<SchemaSerializedObjectValue> {
        const {
            tableName,
            indexName,
            partitionKey,
            sortKey,
            lastEvaluatedKey: _lastEvaluatedKey,
            consistency = "Eventual",
            limit,
            pageLimit,
            descending = false,
        } = options;

        const keyConditionExpressionEntries = [`${partitionKey.name} = :pkv`];

        if (sortKey?.startValue !== undefined && sortKey.endValue !== undefined) {
            keyConditionExpressionEntries.push(`${sortKey.name} between :skv1 and :skv2`);

            // DynamoDB throws an error when you have two conditions on the same attribute but
            // that means you have to use `between` for when both start and end is set? This
            // feels like a silly limitation in DynamoDB.
            if (sortKey.isStartExclusive || sortKey.isEndExclusive)
                throw new InternalError(
                    "Dynamo doesn\u2019t support exclusive sort keys in query when you have both a start and end sort key",
                );
        } else {
            if (sortKey?.startValue !== undefined) {
                if (sortKey.isStartExclusive) {
                    keyConditionExpressionEntries.push(`${sortKey.name} > :skv1`);
                } else {
                    keyConditionExpressionEntries.push(`${sortKey.name} >= :skv1`);
                }
            }

            if (sortKey?.endValue !== undefined) {
                if (sortKey.isEndExclusive) {
                    keyConditionExpressionEntries.push(`${sortKey.name} < :skv2`);
                } else {
                    keyConditionExpressionEntries.push(`${sortKey.name} <= :skv2`);
                }
            }
        }

        const keyConditionExpression = keyConditionExpressionEntries.join(" and ");

        const expressionAttributeValues = intoDynamoAttributeValueObject({
            ":pkv": partitionKey.value,
            ":skv1": sortKey?.startValue,
            ":skv2": sortKey?.endValue,
        });

        let totalScannedCount = 0;
        let lastEvaluatedKey: {[key: string]: types.AttributeValue} | undefined = _lastEvaluatedKey
            ? intoDynamoAttributeValueObject(_lastEvaluatedKey)
            : undefined;

        do {
            // If we have a limit of 100 and we scanned 40 rows in our previous queries, then
            // our new limit is 60 since we don't want to exceed our total limit.
            const remainingLimit = limit !== undefined ? limit - totalScannedCount : undefined;

            const output = await this._client.Query(
                tracer,
                {
                    TableName: tableName,
                    IndexName: indexName,
                    ConsistentRead: consistency === "Strong",
                    // If a `pageLimit` was configured then as we paginate, each page will be sized as
                    // `pageLimit` so we don't read a full 1 MB per page.
                    Limit:
                        pageLimit !== undefined
                            ? remainingLimit !== undefined
                                ? Math.min(pageLimit, remainingLimit)
                                : pageLimit
                            : remainingLimit,
                    ScanIndexForward: !descending,
                    KeyConditionExpression: keyConditionExpression,
                    ExpressionAttributeValues: expressionAttributeValues,
                    ExclusiveStartKey: lastEvaluatedKey,
                },
                options,
            );

            totalScannedCount += output.ScannedCount ?? 0;
            lastEvaluatedKey = output.LastEvaluatedKey;

            for (const item of output.Items ?? []) {
                yield fromDynamoAttributeValueObject(item);
            }

            // If we have exceeded the limit then don't query again. Even if there is a
            // `lastEvaluatedKey`.
            if (limit !== undefined && totalScannedCount >= limit) break;
        } while (lastEvaluatedKey !== undefined);
    }

    /**
     * Performs a [`Scan`][1] operation against DynamoDB. A scan allows you to see
     * every item in the table. Since tables can get quite large this method can be
     * quite expensive to execute!
     *
     * DynamoDB only returns 1 MB of data at a time and you're expected to [paginate to
     * fetch the rest of the data][2]. This function abstracts that away. By returning
     * a JavaScript async iterator, the consumer may break the iterator at any time and
     * it will stop pagination.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
     * [2]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
     */
    async *expensiveScan(
        tracer: TracerBase,
        {
            tableName,
            consistency = "Eventual",
            limit,
            segment,
            totalSegments,
            filterExpression,
            expressionAttributeValues,
            expressionAttributeNames,
        }: {
            tableName: string;
            consistency?: DynamoReadConsistency;
            limit?: number;
            segment?: number;
            totalSegments?: number;
            filterExpression?: string;
            expressionAttributeValues?: ReadonlyMap<string, SchemaSerializedValue>;
            expressionAttributeNames?: ReadonlyMap<string, string>;
        },
    ): AsyncIterableIterator<SchemaSerializedObjectValue> {
        let totalScannedCount = 0;
        let lastEvaluatedKey: {[key: string]: types.AttributeValue} | undefined;

        do {
            const output = await this._client.Scan(tracer, {
                TableName: tableName,
                ConsistentRead: consistency === "Strong",
                // If we have a limit of 100 and we scanned 40 rows in our previous queries, then
                // our new limit is 60 since we don't want to exceed our initial limit.
                Limit: limit !== undefined ? limit - totalScannedCount : undefined,
                ExclusiveStartKey: lastEvaluatedKey,
                Segment: segment,
                TotalSegments: totalSegments,
                FilterExpression: filterExpression,
                ExpressionAttributeValues:
                    expressionAttributeValues && expressionAttributeValues.size > 0
                        ? Object.fromEntries(
                              mapIterable(expressionAttributeValues, ([name, value]) => [
                                  name,
                                  intoDynamoAttributeValue(value),
                              ]),
                          )
                        : undefined,
                ExpressionAttributeNames:
                    expressionAttributeNames && expressionAttributeNames.size > 0
                        ? Object.fromEntries(expressionAttributeNames)
                        : undefined,
            });

            totalScannedCount += output.ScannedCount ?? 0;
            lastEvaluatedKey = output.LastEvaluatedKey;

            for (const item of output.Items ?? []) {
                yield fromDynamoAttributeValueObject(item);
            }

            // If we have exceeded the limit then don't query again. Even if there is a
            // `lastEvaluatedKey`.
            if (limit !== undefined && totalScannedCount >= limit) break;
        } while (lastEvaluatedKey !== undefined);
    }
}

type DynamoClientBatch<TableInput, ItemInput, ItemOutput> = {
    itemCount: number;
    tableBatches: Map<string, DynamoClientTableBatch<TableInput, ItemInput, ItemOutput>>;
    expectsStrongReadConsistency: boolean;
};

type DynamoClientTableBatch<TableInput, ItemInput, ItemOutput> = {
    input: TableInput;
    keyAttributes: Set<string>;
    keyBatches: Map<string, DynamoClientKeyBatch<ItemInput, ItemOutput>>;
};

type DynamoClientKeyBatch<ItemInput, ItemOutput> = {
    key: SchemaSerializedObjectValue;
    inputs: Array<ItemInput>;
    promiseResolvers: Array<{tracer: TracerBase; promiseResolver: PromiseResolver<ItemOutput>}>;
    debugItemTypes: Array<DynamoClientDebugItemType>;
};

abstract class DynamoClientItemBatcherBase<
    TableInput,
    ItemInput1,
    ItemInput2,
    ItemOutput,
> extends ContextBatcherBase<
    {tracer: TracerContextModule},
    DynamoClientBatch<null, ItemInput1, ItemOutput>,
    {
        tracer: TracerBase;
        tableName: string;
        key: SchemaSerializedObjectValue;
        input: ItemInput1;
        expectsStrongReadConsistency: boolean;
        debugItemType: DynamoClientDebugItemType;
    },
    ItemOutput
> {
    private readonly _maxBatchItemCount: number;

    constructor({maxBatchItemCount}: {maxBatchItemCount: number}) {
        super();
        this._maxBatchItemCount = maxBatchItemCount;
    }

    public override newBatch(): DynamoClientBatch<null, ItemInput1, ItemOutput> {
        return {
            itemCount: 0,
            tableBatches: new Map(),
            expectsStrongReadConsistency: false,
        };
    }

    public override addToBatch(
        batch: DynamoClientBatch<null, ItemInput1, ItemOutput>,
        {
            tracer,
            tableName,
            key,
            input,
            expectsStrongReadConsistency,
            debugItemType,
        }: {
            tracer: TracerBase;
            tableName: string;
            key: SchemaSerializedObjectValue;
            input: ItemInput1;
            expectsStrongReadConsistency: boolean;
            debugItemType: DynamoClientDebugItemType;
        },
    ): Promise<ItemOutput> {
        const keyAttributes = new Set(Object.keys(key));
        const promiseResolver = createPromiseResolver<ItemOutput>();

        const tableBatch = getOrSetDefaultMapValue(batch.tableBatches, tableName, () => ({
            input: null,
            keyAttributes,
            keyBatches: new Map(),
        }));

        // Make sure all keys for a table use the same attributes.
        assert(isDeepEqual(tableBatch.keyAttributes, keyAttributes));

        const keyBatch = getOrSetDefaultMapValue(
            tableBatch.keyBatches,
            jsonStableStringify(key),
            () => {
                // Every time this function is called, it means we are adding a new key to the map.
                // So increment the number of items this batch is fetching here.
                batch.itemCount++;

                return {
                    key,
                    inputs: [],
                    promiseResolvers: [],
                    debugItemTypes: [],
                };
            },
        );

        keyBatch.inputs.push(input);
        keyBatch.promiseResolvers.push({tracer, promiseResolver});
        keyBatch.debugItemTypes.push(debugItemType);
        batch.expectsStrongReadConsistency ||= expectsStrongReadConsistency;

        return promiseResolver.promise;
    }

    public override executeBatch(
        context: Context<{tracer: TracerContextModule}>,
        fullBatch: DynamoClientBatch<null, ItemInput1, ItemOutput>,
    ) {
        const tracer = context.tracer.getTracer();

        // This batch execution is performed in a microtask, so if an error is thrown it's
        // thrown into the void. Add a try/catch so that errors reject the promise
        // resolvers in our batch.
        try {
            const batches = this._reorganizeBatch(fullBatch).flatMap(batch =>
                splitDynamoClientBatch(batch, this._maxBatchItemCount),
            );

            for (const batch of batches) {
                void this._executeBatch(tracer, batch, 1);
            }
        } catch (error) {
            for (const {keyBatches} of fullBatch.tableBatches.values()) {
                for (const {promiseResolvers} of keyBatches.values()) {
                    for (const {promiseResolver} of promiseResolvers) {
                        promiseResolver.reject(error);
                    }
                }
            }
        }
    }

    private async _executeBatch(
        tracer: TracerBase,
        batch: DynamoClientBatch<TableInput, ItemInput2, ItemOutput>,
        attemptNumber: number,
    ) {
        // This function is async but called from a synchronous function. So if an error is
        // thrown it's thrown in the void. Add a try/catch so that errors reject the
        // promise resolvers in our batch.
        try {
            assert(batch.itemCount <= 100);

            const {unprocessedBatch} = await this._sendBatchCommand(tracer, batch);

            if (unprocessedBatch.itemCount > 0) {
                // The DynamoDB docs strongly recommend us to retry unprocessed key requests with
                // exponential backoff:
                // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
                const delayMs = 50 * 2 ** (attemptNumber - 1);

                if (delayMs > 1000 * 60)
                    throw new DeadlineExceededError(
                        `Could not finish executing batch after ${attemptNumber} attempts`,
                    );

                // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
                const delayMsWithJitter = Math.floor(Math.random() * delayMs);

                setTimeout(() => {
                    void this._executeBatch(tracer, unprocessedBatch, attemptNumber + 1);
                }, delayMsWithJitter);
            }
        } catch (error) {
            for (const {keyBatches} of batch.tableBatches.values()) {
                for (const {promiseResolvers} of keyBatches.values()) {
                    for (const {promiseResolver} of promiseResolvers) {
                        promiseResolver.reject(error);
                    }
                }
            }
        }
    }

    protected abstract _reorganizeBatch(
        batch: DynamoClientBatch<null, ItemInput1, ItemOutput>,
    ): Array<DynamoClientBatch<TableInput, ItemInput2, ItemOutput>>;

    /**
     * Send a batch command to DynamoDB for the provided batch.
     *
     * This function is expected to construct a new batch with any unprocessed items.
     * If all items were processed then the function may return an `unprocessedBatch`
     * with `itemCount` of 0.
     */
    protected abstract _sendBatchCommand(
        tracer: TracerBase,
        batch: DynamoClientBatch<TableInput, ItemInput2, ItemOutput>,
    ): Promise<{unprocessedBatch: DynamoClientBatch<TableInput, ItemInput2, ItemOutput>}>;
}

/**
 * DynamoDB's [`BatchGetItem`][1] command can get a maximum of 100 items. So if we
 * have a batch larger then that, split it into multiple smaller batches.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
 */
function splitDynamoClientBatch<TableInput, ItemInput, ItemOutput>(
    fullBatch: DynamoClientBatch<TableInput, ItemInput, ItemOutput>,
    maxBatchItemCount: number,
): Array<DynamoClientBatch<TableInput, ItemInput, ItemOutput>> {
    if (fullBatch.itemCount < maxBatchItemCount) {
        return [fullBatch];
    }

    const batches: Array<DynamoClientBatch<TableInput, ItemInput, ItemOutput>> = [];
    let currentBatch: DynamoClientBatch<TableInput, ItemInput, ItemOutput>;

    while (fullBatch.itemCount > 0) {
        currentBatch = {
            itemCount: 0,
            tableBatches: new Map(),
            expectsStrongReadConsistency: fullBatch.expectsStrongReadConsistency,
        };
        batches.push(currentBatch);

        for (const [tableName, fullTableBatch] of fullBatch.tableBatches) {
            // If all the remaining keys for this table can fit into the current batch, then
            // move them wholesale into the current batch.
            if (currentBatch.itemCount + fullTableBatch.keyBatches.size <= maxBatchItemCount) {
                fullBatch.tableBatches.delete(tableName);
                fullBatch.itemCount -= fullTableBatch.keyBatches.size;

                assert(!currentBatch.tableBatches.has(tableName));
                currentBatch.tableBatches.set(tableName, fullTableBatch);
                currentBatch.itemCount += fullTableBatch.keyBatches.size;
            }
            // Otherwise, add individual keys to the current batch until we hit the max batch
            // item count.
            else {
                const currentTableBatch = getOrSetDefaultMapValue(
                    currentBatch.tableBatches,
                    tableName,
                    () => ({
                        input: fullTableBatch.input,
                        keyAttributes: fullTableBatch.keyAttributes,
                        keyBatches: new Map(),
                    }),
                );

                for (const [key, fullKeyBatch] of fullTableBatch.keyBatches) {
                    fullTableBatch.keyBatches.delete(key);
                    fullBatch.itemCount -= 1;

                    assert(!currentTableBatch.keyBatches.has(key));
                    currentTableBatch.keyBatches.set(key, fullKeyBatch);
                    currentBatch.itemCount += 1;

                    // Stop if our current batch is full.
                    if (currentBatch.itemCount >= maxBatchItemCount) break;
                }

                // If we are in this code path, then we should be moving only some of the keys in
                // the full batch. Not all of them.
                assert(fullTableBatch.keyBatches.size > 0);
            }

            // Stop if our current batch is full.
            if (currentBatch.itemCount >= maxBatchItemCount) break;
        }

        // Double check that we don't have more items in the batch then expected.
        assert(currentBatch.itemCount <= maxBatchItemCount);
    }

    return batches;
}

type DynamoClientGetItemBatchItemInput = {
    readonly projectionExpression?: string;
    readonly expressionAttributeNames?: ReadonlyMap<string, string>;
};

/**
 * Responsible for batching multiple `getItem()` calls into one [`BatchGetItem`][1]
 * command for DynamoDB.
 *
 * Implemented as a class so we can have a separate batcher for each read
 * consistency mode.
 *
 * We want each `BatchGetItem` command to have the same read consistency since the
 * slowest individual item latency will be the latency for the entire batch. And
 * strong read consistency may increase latency.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
 */
class DynamoClientGetItemBatcher extends DynamoClientItemBatcherBase<
    DynamoClientGetItemBatchItemInput,
    DynamoClientGetItemBatchItemInput,
    null,
    SchemaSerializedObjectValue | null
> {
    // Reading DynamoDB items doesn't depend on the actor. Authorization happens before
    // we start issuing raw DynamoDB actions. It's safe to share batched IO across
    // actor changes.
    public override readonly whenActorChanges = "DangerouslyShare";

    private readonly _client: DynamoClientInternal;
    private readonly _consistency: DynamoReadConsistency;

    constructor(client: DynamoClientInternal, consistency: DynamoReadConsistency) {
        super({maxBatchItemCount: 100});
        this._client = client;
        this._consistency = consistency;
    }

    public getItem(
        context: Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
        tableName: string,
        key: SchemaSerializedObjectValue,
        input: DynamoClientGetItemBatchItemInput,
        expectsStrongReadConsistency: boolean,
        debugItemType: DynamoClientDebugItemType,
    ) {
        return context.batch.execute(this, {
            tracer: context.tracer.getTracer(),
            tableName,
            key,
            input,
            expectsStrongReadConsistency,
            debugItemType,
        });
    }

    protected override _reorganizeBatch(
        batch: DynamoClientBatch<
            null,
            DynamoClientGetItemBatchItemInput,
            SchemaSerializedObjectValue | null
        >,
    ) {
        return reorganizeDynamoClientGetItemBatch(batch);
    }

    protected async _sendBatchCommand(
        tracer: TracerBase,
        batch: DynamoClientBatch<
            DynamoClientGetItemBatchItemInput,
            null,
            SchemaSerializedObjectValue | null
        >,
    ) {
        // If we are only reading exactly one item in our batch then we will send a
        // `GetItem` command instead of a `BatchGetItem` command. That way our traces are a
        // little easier to read.
        if (batch.tableBatches.size === 1) {
            const [tableName, tableBatch] = [...batch.tableBatches.entries()][0]!;
            if (tableBatch.keyBatches.size === 1) {
                const {key, promiseResolvers, debugItemTypes} = [
                    ...tableBatch.keyBatches.values(),
                ][0]!;

                const output = await this._client.GetItem(
                    tracer,
                    {
                        TableName: tableName,
                        ConsistentRead: this._consistency === "Strong",
                        Key: intoDynamoAttributeValueObject(key),
                    },
                    batch.expectsStrongReadConsistency,
                    debugItemTypes,
                );

                const item = output.Item ? fromDynamoAttributeValueObject(output.Item) : null;
                for (const {promiseResolver} of promiseResolvers) promiseResolver.resolve(item);

                return {
                    unprocessedBatch: {
                        itemCount: 0,
                        tableBatches: new Map(),
                        expectsStrongReadConsistency: batch.expectsStrongReadConsistency,
                    },
                };
            }
        }

        const output = await this._client.BatchGetItem(
            tracer,
            flatMapIterable(batch.tableBatches.values(), tableBatch =>
                flatMapIterable(tableBatch.keyBatches.values(), ({promiseResolvers}) =>
                    mapIterable(promiseResolvers, ({tracer}) => tracer),
                ),
            ),
            {
                RequestItems: Object.fromEntries(
                    Array.from(batch.tableBatches, ([tableName, tableBatch]) => {
                        let projectionExpression;

                        // Make sure `keyAttributes` are included in `projectionExpression` since we'll
                        // need them for resolving the right output promise. This is the [DynamoDB
                        // recommendation][1]:
                        //
                        // > To help parse the response by item, include the primary key values for the
                        // > items in your request in the `ProjectionExpression` parameter.
                        //
                        // [1]:
                        //     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
                        if (tableBatch.input.projectionExpression) {
                            const projectionAttributeExpressions =
                                tableBatch.input.projectionExpression
                                    .split(",")
                                    .map(attribute => attribute.trim());

                            for (const keyAttribute of tableBatch.keyAttributes) {
                                if (!projectionAttributeExpressions.includes(keyAttribute)) {
                                    projectionAttributeExpressions.push(keyAttribute);
                                }
                            }

                            projectionExpression = projectionAttributeExpressions.join(", ");
                        }

                        return [
                            tableName,
                            {
                                Keys: Array.from(tableBatch.keyBatches.values(), ({key}) =>
                                    intoDynamoAttributeValueObject(key),
                                ),
                                ConsistentRead: this._consistency === "Strong",
                                ProjectionExpression: projectionExpression,
                                ExpressionAttributeNames:
                                    projectionExpression &&
                                    tableBatch.input.expressionAttributeNames &&
                                    tableBatch.input.expressionAttributeNames.size > 0
                                        ? Object.fromEntries(
                                              tableBatch.input.expressionAttributeNames,
                                          )
                                        : undefined,
                            },
                        ];
                    }),
                ),
            },
            batch.expectsStrongReadConsistency,
            flatMapIterable(batch.tableBatches.values(), tableBatch =>
                flatMapIterable(
                    tableBatch.keyBatches.values(),
                    ({debugItemTypes}) => debugItemTypes,
                ),
            ),
        );

        for (const [tableName, items] of Object.entries(output.Responses ?? {})) {
            const tableBatch = batch.tableBatches.get(tableName);
            assert(
                tableBatch,
                "`BatchGetItem` output contains a response for a table we didn\u2019t request",
            );

            for (const _item of items) {
                const item = fromDynamoAttributeValueObject(_item);

                const key = Object.fromEntries(
                    Array.from(tableBatch.keyAttributes, keyAttribute => [
                        keyAttribute,
                        item[keyAttribute],
                    ]),
                );

                const keyString = jsonStableStringify(key);
                const keyBatch = tableBatch.keyBatches.get(keyString);
                assert(
                    keyBatch,
                    "`BatchGetItem` output contains a response for an item we didn\u2019t request",
                );

                for (const {promiseResolver} of keyBatch.promiseResolvers) {
                    promiseResolver.resolve(item);
                }

                tableBatch.keyBatches.delete(keyString);
                batch.itemCount -= 1;
            }

            // If all items for this table were present in the response then we can cleanup our
            // table batch.
            if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
        }

        const unprocessedBatch: DynamoClientBatch<
            DynamoClientGetItemBatchItemInput,
            null,
            SchemaSerializedObjectValue | null
        > = {
            itemCount: 0,
            tableBatches: new Map(),
            expectsStrongReadConsistency: batch.expectsStrongReadConsistency,
        };

        // If we have any unprocessed keys move them into a new unprocessed batch object.
        if (output.UnprocessedKeys) {
            for (const [tableName, {Keys: unprocessedKeys}] of Object.entries(
                output.UnprocessedKeys,
            )) {
                const tableBatch = batch.tableBatches.get(tableName);
                assert(
                    tableBatch,
                    "`BatchGetItem` output contains a response for a table we didn\u2019t request",
                );

                if (unprocessedKeys && unprocessedKeys?.length > 1) {
                    const unprocessedTableBatch = getOrSetDefaultMapValue(
                        unprocessedBatch.tableBatches,
                        tableName,
                        () => ({
                            input: tableBatch.input,
                            keyAttributes: tableBatch.keyAttributes,
                            keyBatches: new Map(),
                        }),
                    );

                    for (const _key of unprocessedKeys) {
                        const key = fromDynamoAttributeValueObject(_key);

                        const keyString = jsonStableStringify(key);
                        const keyBatch = tableBatch.keyBatches.get(keyString);
                        assert(
                            keyBatch,
                            "`BatchGetItem` output contains a response for an item we didn\u2019t request",
                        );

                        tableBatch.keyBatches.delete(keyString);
                        batch.itemCount -= 1;

                        assert(!unprocessedTableBatch.keyBatches.has(keyString));
                        unprocessedTableBatch.keyBatches.set(keyString, keyBatch);
                        unprocessedBatch.itemCount += 1;
                    }

                    // If all items for this table were present in the response then we can cleanup our
                    // table batch.
                    if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
                }
            }
        }

        // For keys that were not returned in either `Responses` or `UnprocessedKeys`, that
        // means they do not have an item in DynamoDB and should resolve to null.
        for (const {keyBatches} of batch.tableBatches.values()) {
            for (const {promiseResolvers} of keyBatches.values()) {
                for (const {promiseResolver} of promiseResolvers) {
                    promiseResolver.resolve(null);
                }
            }
        }

        return {unprocessedBatch};
    }
}

/**
 * Take a batch with inputs at the item level and move those inputs to the table
 * level since that's the format expected by DynamoDB's `BatchGetItem` command.
 */
function reorganizeDynamoClientGetItemBatch(
    batch: DynamoClientBatch<
        null,
        DynamoClientGetItemBatchItemInput,
        SchemaSerializedObjectValue | null
    >,
): Array<
    DynamoClientBatch<DynamoClientGetItemBatchItemInput, null, SchemaSerializedObjectValue | null>
> {
    const newTableBatchesByTableName = new Map<
        string,
        Array<
            DynamoClientTableBatch<
                DynamoClientGetItemBatchItemInput,
                null,
                SchemaSerializedObjectValue | null
            >
        >
    >();

    // We start with a batch where each item has an input. We want to move inputs to
    // the table level and keep all items with the same input in the same batch.
    for (const [tableName, tableBatch] of batch.tableBatches) {
        const newTableBatches = getOrSetDefaultMapValue(
            newTableBatchesByTableName,
            tableName,
            () => [],
        );

        for (const [key, keyBatch] of tableBatch.keyBatches) {
            for (let i = 0; i < keyBatch.inputs.length; i++) {
                const input = keyBatch.inputs[i]!;
                const promiseResolver = keyBatch.promiseResolvers[i]!;
                const debugItemTypes = keyBatch.debugItemTypes[i]!;

                let wasAdded = false;
                for (const newTableBatch of newTableBatches) {
                    if (!isDeepEqual(newTableBatch.input, input)) continue;

                    // Make sure all keys for a table use the same attributes.
                    assert(isDeepEqual(newTableBatch.keyAttributes, tableBatch.keyAttributes));

                    const newKeyBatch = getOrSetDefaultMapValue(
                        newTableBatch.keyBatches,
                        key,
                        () => ({
                            key: keyBatch.key,
                            inputs: [],
                            promiseResolvers: [],
                            debugItemTypes: [],
                        }),
                    );

                    newKeyBatch.inputs.push(null);
                    newKeyBatch.promiseResolvers.push(promiseResolver);
                    newKeyBatch.debugItemTypes.push(debugItemTypes);
                    wasAdded = true;
                    break;
                }

                // If we did not add our key's promise resolver to an existing batch then create a
                // new batch.
                if (!wasAdded) {
                    newTableBatches.push({
                        input,
                        keyAttributes: tableBatch.keyAttributes,
                        keyBatches: new Map([
                            [
                                key,
                                {
                                    key: keyBatch.key,
                                    inputs: [null],
                                    promiseResolvers: [promiseResolver],
                                    debugItemTypes: [debugItemTypes],
                                },
                            ],
                        ]),
                    });
                }
            }
        }
    }

    const finalBatches: Array<
        DynamoClientBatch<
            DynamoClientGetItemBatchItemInput,
            null,
            SchemaSerializedObjectValue | null
        >
    > = [];

    for (const [tableName, newTableBatches] of newTableBatchesByTableName) {
        for (const newTableBatch of newTableBatches) {
            let wasAdded = false;
            for (const finalBatch of finalBatches) {
                if (finalBatch.tableBatches.has(tableName)) continue;
                finalBatch.itemCount += newTableBatch.keyBatches.size;
                finalBatch.tableBatches.set(tableName, newTableBatch);
                wasAdded = true;
                break;
            }
            if (!wasAdded) {
                finalBatches.push({
                    itemCount: newTableBatch.keyBatches.size,
                    tableBatches: new Map([[tableName, newTableBatch]]),
                    expectsStrongReadConsistency: batch.expectsStrongReadConsistency,
                });
            }
        }
    }

    return finalBatches;
}

type DynamoClientWriteItemBatchAction =
    | {action: "Put"; item: SchemaSerializedObjectValue}
    | {action: "Delete"};

/**
 * Responsible for batching multiple `putItem()` and `deleteItem()` calls into one
 * [`BatchWriteItem`][1] command for DynamoDB.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
 */
class DynamoClientWriteItemBatcher extends DynamoClientItemBatcherBase<
    null,
    DynamoClientWriteItemBatchAction,
    DynamoClientWriteItemBatchAction,
    void
> {
    // Writing DynamoDB items doesn't depend on the actor. Authorization happens before
    // we start issuing raw DynamoDB actions. It's safe to share batched IO across
    // actor changes.
    public override readonly whenActorChanges = "DangerouslyShare";

    private readonly _client: DynamoClientInternal;

    constructor(client: DynamoClientInternal) {
        super({maxBatchItemCount: 25});
        this._client = client;
    }

    public putItem(
        context: Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
        tableName: string,
        key: SchemaSerializedObjectValue,
        item: SchemaSerializedObjectValue,
        debugItemType: DynamoClientDebugItemType,
    ): Promise<void> {
        return context.batch.execute(this, {
            tracer: context.tracer.getTracer(),
            tableName,
            key,
            input: {action: "Put", item},
            expectsStrongReadConsistency: false,
            debugItemType,
        });
    }

    public deleteItem(
        context: Context<{batch: BatchContextModule; tracer: TracerContextModule}>,
        tableName: string,
        key: SchemaSerializedObjectValue,
        debugItemType: DynamoClientDebugItemType,
    ): Promise<void> {
        return context.batch.execute(this, {
            tracer: context.tracer.getTracer(),
            tableName,
            key,
            input: {action: "Delete"},
            expectsStrongReadConsistency: false,
            debugItemType,
        });
    }

    protected override _reorganizeBatch(
        batch: DynamoClientBatch<null, DynamoClientWriteItemBatchAction, void>,
    ) {
        return [batch];
    }

    protected async _sendBatchCommand(
        tracer: TracerBase,
        batch: DynamoClientBatch<null, DynamoClientWriteItemBatchAction, void>,
    ) {
        // If we are only writing exactly one item in our batch then we will send a
        // `PutItem` or `DeleteItem` command instead of a `BatchWriteItem` command. That
        // way our traces are a little easier to read.
        if (batch.tableBatches.size === 1) {
            const [tableName, tableBatch] = [...batch.tableBatches.entries()][0]!;
            if (tableBatch.keyBatches.size === 1) {
                const {key, inputs, promiseResolvers, debugItemTypes} = [
                    ...tableBatch.keyBatches.values(),
                ][0]!;

                // We only write the last input.
                const input = assertExists(inputs[inputs.length - 1]);

                switch (input.action) {
                    case "Put": {
                        await this._client.PutItem(
                            tracer,
                            {
                                TableName: tableName,
                                Item: intoDynamoAttributeValueObject(input.item),
                            },
                            debugItemTypes,
                        );
                        break;
                    }
                    case "Delete": {
                        await this._client.DeleteItem(
                            tracer,
                            {
                                TableName: tableName,
                                Key: intoDynamoAttributeValueObject(key),
                            },
                            debugItemTypes,
                        );
                        break;
                    }
                    default:
                        throw exhaustive(input);
                }

                for (const {promiseResolver} of promiseResolvers) promiseResolver.resolve();

                return {
                    unprocessedBatch: {
                        itemCount: 0,
                        tableBatches: new Map(),
                        expectsStrongReadConsistency: batch.expectsStrongReadConsistency,
                    },
                };
            }
        }

        const output = await this._client.BatchWriteItem(
            tracer,
            flatMapIterable(batch.tableBatches.values(), tableBatch =>
                flatMapIterable(tableBatch.keyBatches.values(), ({promiseResolvers}) =>
                    mapIterable(promiseResolvers, ({tracer}) => tracer),
                ),
            ),
            {
                RequestItems: Object.fromEntries(
                    Array.from(batch.tableBatches, ([tableName, tableBatch]) => {
                        return [
                            tableName,
                            Array.from(tableBatch.keyBatches.values(), ({key, inputs}) => {
                                // We only write the last input.
                                const input = assertExists(inputs[inputs.length - 1]);

                                switch (input.action) {
                                    case "Put": {
                                        return {
                                            PutRequest: {
                                                Item: intoDynamoAttributeValueObject(input.item),
                                            },
                                        };
                                    }
                                    case "Delete": {
                                        return {
                                            DeleteRequest: {
                                                Key: intoDynamoAttributeValueObject(key),
                                            },
                                        };
                                    }
                                    default:
                                        throw exhaustive(input);
                                }
                            }),
                        ];
                    }),
                ),
            },
            flatMapIterable(batch.tableBatches.values(), tableBatch =>
                flatMapIterable(
                    tableBatch.keyBatches.values(),
                    ({debugItemTypes}) => debugItemTypes,
                ),
            ),
        );

        const unprocessedBatch: DynamoClientBatch<null, DynamoClientWriteItemBatchAction, void> = {
            itemCount: 0,
            tableBatches: new Map(),
            expectsStrongReadConsistency: batch.expectsStrongReadConsistency,
        };

        // If we have any unprocessed keys move them into a new unprocessed batch object.
        if (output.UnprocessedItems) {
            for (const [tableName, unprocessedItems] of Object.entries(output.UnprocessedItems)) {
                const tableBatch = batch.tableBatches.get(tableName);
                assert(
                    tableBatch,
                    "`BatchWriteItem` output contains a response for a table we didn\u2019t request",
                );

                const unprocessedTableBatch = getOrSetDefaultMapValue(
                    unprocessedBatch.tableBatches,
                    tableName,
                    () => ({
                        input: tableBatch.input,
                        keyAttributes: tableBatch.keyAttributes,
                        keyBatches: new Map(),
                    }),
                );

                for (const unprocessedItem of unprocessedItems) {
                    let key: SchemaSerializedObjectValue;
                    if (unprocessedItem.PutRequest?.Item) {
                        const newKey: {[key: string]: types.AttributeValue} = {};

                        for (const keyAttribute of tableBatch.keyAttributes) {
                            const keyAttributeValue = unprocessedItem.PutRequest.Item[keyAttribute];
                            if (keyAttributeValue !== undefined)
                                newKey[keyAttribute] = keyAttributeValue;
                        }

                        key = fromDynamoAttributeValueObject(newKey);
                    } else if (unprocessedItem.DeleteRequest && unprocessedItem.DeleteRequest.Key) {
                        key = fromDynamoAttributeValueObject(unprocessedItem.DeleteRequest.Key);
                    } else {
                        throw new InternalError(
                            "Unrecognized unprocessed item in `BatchWriteItem` output",
                        );
                    }

                    const keyString = jsonStableStringify(key);
                    const keyBatch = tableBatch.keyBatches.get(keyString);
                    assert(
                        keyBatch,
                        "`BatchWriteItem` output contains a response for an item we didn\u2019t request",
                    );

                    tableBatch.keyBatches.delete(keyString);
                    batch.itemCount -= 1;

                    assert(!unprocessedTableBatch.keyBatches.has(keyString));
                    unprocessedTableBatch.keyBatches.set(keyString, keyBatch);
                    unprocessedBatch.itemCount += 1;
                }

                // If all items for this table were present in the response then we can cleanup our
                // table batch.
                if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
            }
        }

        // For keys that were not returned in `UnprocessedItems`, that means the write
        // succeeded so we can resolve the promises for the batched items.
        for (const {keyBatches} of batch.tableBatches.values()) {
            for (const {promiseResolvers} of keyBatches.values()) {
                for (const {promiseResolver} of promiseResolvers) {
                    promiseResolver.resolve();
                }
            }
        }

        return {unprocessedBatch};
    }
}
