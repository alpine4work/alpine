// IMPORTANT: We are only importing `@aws-sdk` for types. Use `aws-client.ts`
// for executing any AWS commands.
import type * as types from "@aws-sdk/client-dynamodb";
import jsonStableStringify from "json-stable-stringify";
import {awsClient} from "~/server/aws/aws-client";
import {localstackEdgePort} from "~/server/aws/localstack-edge-port";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo-transaction-entry";
import {classifyDynamoError} from "~/server/dynamo/internal/classify-dynamo-error";
import {DeadlineExceededError, InternalError, InvalidArgumentError} from "~/shared/error/error";
import {isReadonlyArray} from "~/shared/helpers/array/is-readonly-array";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {mapIterable} from "~/shared/helpers/iterable/map-iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";
import {quote} from "~/shared/helpers/string/quote";
import {
    JsonStringifiableUint8Array,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

export type DynamoReadConsistency = "Eventual" | "Strong";

/**
 * Our client interface to DynamoDB.
 *
 * Wraps the AWS SDK DynamoDB client with some extra functionality like command
 * batching.
 */
class DynamoClient {
    /**
     * Batchers for the [`GetItem`][1] command.
     *
     * We have a separate batcher for our different read consistency levels. If the
     * code tries to do eventual and strong reads simultaneously, we don't want the
     * strong reads to increase the latency of eventual reads.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    private readonly _getItemBatcherByConsistency: {
        [Key in DynamoReadConsistency]: DynamoClientGetItemBatcher;
    };

    /**
     * Batcher for the [`PutItem`][1] and [`DeleteItem`][2] commands.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    private readonly _writeItemBatcher: DynamoClientWriteItemBatcher;

    constructor() {
        this._getItemBatcherByConsistency = {
            Eventual: new DynamoClientGetItemBatcher("Eventual"),
            Strong: new DynamoClientGetItemBatcher("Strong"),
        };
        this._writeItemBatcher = new DynamoClientWriteItemBatcher();
    }

    /**
     * Get a single item from DynamoDB. Corresponds to the [`GetItem`][1] command.
     *
     * For `getItem()` calls made in a short window of time, we will batch them
     * together into a [`BatchGetItem`][2] command.
     *
     * If a `projectionExpression` is provided then we will not batch and send a
     * plain `GetItem` command at this time.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
     */
    public async getItem({
        tableName,
        key,
        consistency = "Eventual",
        projectionExpression,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        consistency?: DynamoReadConsistency;
        projectionExpression?: string;
    }): Promise<SchemaSerializedObjectValue | null> {
        // Reads without a projection expression may be batched.
        //
        // NOTE: If we end up using `projectionExpression` a lot, consider in the
        // future sending batch requests with `projectionExpression`.
        if (projectionExpression === undefined) {
            const batcher = this._getItemBatcherByConsistency[consistency];
            return batcher.getItem(tableName, key);
        }

        const output = await executeDynamoCommand<types.GetItemInput, types.GetItemOutput>(
            "GetItem",
            {
                TableName: tableName,
                Key: intoDynamoAttributeValueObject(key),
                ConsistentRead: consistency === "Strong",
                ProjectionExpression: projectionExpression,
            },
        );

        if (!output.Item) return null;
        return fromDynamoAttributeValueObject(output.Item);
    }

    /**
     * Put a single item into DynamoDB. Corresponds to the [`PutItem`][1] command.
     *
     * Our DynamoDB class doesn't know which attributes in an item correspond to
     * the key, so we need the caller to give us the `key` object for the item
     * separately.
     *
     * For `putItem()` calls made in a short window of time that don't have
     * conditions, we will batch them together into a [`BatchWriteItem`][2]
     * command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async putItem({
        tableName,
        key,
        item,
        conditionExpression,
        expressionAttributeValues,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        item: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: Map<string, SchemaSerializedValue>;
    }): Promise<void> {
        // Make sure that all the properties in our `key` also exist in our `item`.
        for (const keyEntry of Object.entries(key)) {
            if (!isDeepEqual(keyEntry[1], item[keyEntry[0]]))
                throw new InvalidArgumentError(
                    quote`Key attribute ${keyEntry[0]} is different in key and item`,
                );
        }

        // Writes without a condition may be batched.
        if (conditionExpression === undefined)
            return this._writeItemBatcher.putItem(tableName, key, item);

        await executeDynamoCommand<types.PutItemInput, types.PutItemOutput>("PutItem", {
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
        });
    }

    /**
     * Delete a single item from DynamoDB. Corresponds to the [`DeleteItem`][1]
     * command.
     *
     * For `deleteItem()` calls made in a short window of time that don't have
     * conditions, we will batch them together into a [`BatchWriteItem`][2]
     * command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async deleteItem({
        tableName,
        key,
        conditionExpression,
        expressionAttributeValues,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: Map<string, SchemaSerializedValue>;
    }): Promise<void> {
        // Writes without a condition may be batched.
        if (conditionExpression === undefined)
            return this._writeItemBatcher.deleteItem(tableName, key);

        await executeDynamoCommand<types.DeleteItemInput, types.DeleteItemOutput>("DeleteItem", {
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
        });
    }

    /**
     * Perform up to 25 actions atomically with [`TransactWriteItems`][1]. Either
     * all actions in the transaction succeed or if one action fails then none of
     * the actions in the transaction will be applied.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public async executeTransaction(
        entries: ReadonlyArray<DynamoTransactionEntry>,
        {clientRequestToken}: {clientRequestToken?: string} = {},
    ): Promise<void> {
        await executeDynamoCommand<types.TransactWriteItemsInput, types.TransactWriteItemsOutput>(
            "TransactWriteItems",
            {
                TransactItems: entries.map(entry => entry._getTransactItemForClient(this)),
                ClientRequestToken: clientRequestToken,
            },
        );
    }

    /**
     * Create an `PutItem` entry for [`TransactWriteItems`][1]. Will not be
     * executed until you call `executeTransaction()` with other transaction
     * entries.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public transactionPutItem({
        tableName,
        item,
        conditionExpression,
        expressionAttributeValues,
    }: {
        tableName: string;
        item: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: Map<string, SchemaSerializedValue>;
    }): DynamoTransactionEntry {
        return DynamoTransactionEntry._newFromClient(this, {
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
            },
        });
    }

    /**
     * Create a `DeleteItem` entry for [`TransactWriteItems`][1]. Will not be
     * executed until you call `executeTransaction()` with other transaction
     * entries.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public transactionDeleteItem({
        tableName,
        key,
        conditionExpression,
        expressionAttributeValues,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        conditionExpression?: string;
        expressionAttributeValues?: Map<string, SchemaSerializedValue>;
    }): DynamoTransactionEntry {
        return DynamoTransactionEntry._newFromClient(this, {
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
            },
        });
    }

    /**
     * Create a `ConditionCheck` entry for [`TransactWriteItems`][1]. Will not be
     * executed until you call `executeTransaction()` with other transaction
     * entries.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public transactionConditionCheck({
        tableName,
        key,
        conditionExpression,
        expressionAttributeValues,
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        conditionExpression: string;
        expressionAttributeValues?: Map<string, SchemaSerializedValue>;
    }): DynamoTransactionEntry {
        return DynamoTransactionEntry._newFromClient(this, {
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
            },
        });
    }

    /**
     * Performs a [`Query`][1] operation against DynamoDB. A query lets us read
     * items from the table between two sort keys in a partition.
     *
     * DynamoDB only returns 1 MB of data at a time and you're expected to
     * [paginate to fetch the rest of the data][2]. This function abstracts that
     * away. By returning a JavaScript async iterator, the consumer may break the
     * iterator at any time and it will stop pagination.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.Pagination.html
     */
    public async *query({
        tableName,
        partitionKey,
        sortKey,
        consistency = "Eventual",
        limit,
        descending = false,
    }: {
        tableName: string;
        partitionKey: {
            name: string;
            value: SchemaSerializedValue;
        };
        sortKey: {
            name: string;
            startValue?: SchemaSerializedValue;
            endValue?: SchemaSerializedValue;
        };
        consistency?: DynamoReadConsistency;
        limit?: number;
        descending?: boolean;
    }): AsyncIterableIterator<SchemaSerializedObjectValue> {
        const keyConditionExpression =
            sortKey.startValue !== undefined && sortKey.endValue !== undefined
                ? `${partitionKey.name} = :pkv and ${sortKey.name} between :skv1 and :skv2`
                : sortKey.startValue !== undefined
                ? `${partitionKey.name} = :pkv and ${sortKey.name} >= :skv1`
                : sortKey.endValue !== undefined
                ? `${partitionKey.name} = :pkv and ${sortKey.name} <= :skv2`
                : `${partitionKey.name} = :pkv`;

        const expressionAttributeValues = intoDynamoAttributeValueObject({
            ":pkv": partitionKey.value,
            ":skv1": sortKey.startValue,
            ":skv2": sortKey.endValue,
        });

        let totalScannedCount = 0;
        let lastEvaluatedKey: {[key: string]: types.AttributeValue} | undefined;

        do {
            const output = await executeDynamoCommand<types.QueryInput, types.QueryOutput>(
                "Query",
                {
                    TableName: tableName,
                    ConsistentRead: consistency === "Strong",
                    // If we have a limit of 100 and we scanned 40 rows in our previous queries,
                    // then our new limit is 60 since we don't want to exceed our initial limit.
                    Limit: limit !== undefined ? limit - totalScannedCount : undefined,
                    ScanIndexForward: !descending,
                    KeyConditionExpression: keyConditionExpression,
                    ExpressionAttributeValues: expressionAttributeValues,
                    ExclusiveStartKey: lastEvaluatedKey,
                },
            );

            totalScannedCount += output.ScannedCount ?? 0;
            lastEvaluatedKey = output.LastEvaluatedKey;

            for (const item of output.Items ?? []) {
                yield fromDynamoAttributeValueObject(item);
            }

            // If we have exceeded the limit then don't query again. Even if there is
            // a `lastEvaluatedKey`.
            if (limit !== undefined && totalScannedCount >= limit) break;
        } while (lastEvaluatedKey !== undefined);
    }
}

type DynamoClientBatch<Input, Output> = {
    itemCount: number;
    tableBatches: Map<string, DynamoClientTableBatch<Input, Output>>;
};

type DynamoClientTableBatch<Input, Output> = {
    keyAttributes: Set<string>;
    keyBatches: Map<string, DynamoClientKeyBatch<Input, Output>>;
};

type DynamoClientKeyBatch<Input, Output> = {
    key: SchemaSerializedObjectValue;
    input: Input;
    promiseResolvers: Array<PromiseResolver<Output>>;
};

abstract class DynamoClientItemBatcherBase<Input, Output> {
    private readonly _maxBatchItemCount: number;
    private _scheduledBatch: DynamoClientBatch<Input, Output> | null = null;

    constructor({maxBatchItemCount}: {maxBatchItemCount: number}) {
        this._maxBatchItemCount = maxBatchItemCount;
    }

    private _getScheduledBatch(): DynamoClientBatch<Input, Output> {
        if (this._scheduledBatch === null) {
            this._scheduledBatch = {
                itemCount: 0,
                tableBatches: new Map(),
            };
            this._scheduleBatchExecution();
        }
        return this._scheduledBatch;
    }

    protected _addItem(
        tableName: string,
        key: SchemaSerializedObjectValue,
        input: Input,
    ): Promise<Output> {
        const scheduledBatch = this._getScheduledBatch();

        const keyAttributes = new Set(Object.keys(key));
        const promiseResolver = createPromiseResolver<Output>();

        const tableBatch = getOrSetDefaultMapValue(scheduledBatch.tableBatches, tableName, () => ({
            keyAttributes,
            keyBatches: new Map(),
        }));

        // Make sure all keys for a table use the same attributes.
        assert(isDeepEqual(tableBatch.keyAttributes, keyAttributes));

        const keyBatch = getOrSetDefaultMapValue(
            tableBatch.keyBatches,
            jsonStableStringify(key),
            () => {
                // Every time this function is called, it means we are adding a new key to the
                // map. So increment the number of items this batch is fetching here.
                scheduledBatch.itemCount++;

                return {
                    key,
                    input,
                    promiseResolvers: [],
                };
            },
        );

        // Always override with the latest input.
        keyBatch.input = input;

        keyBatch.promiseResolvers.push(promiseResolver);

        return promiseResolver.promise;
    }

    /**
     * We schedule our batch execution to happen during the current JavaScript
     * runtime task once all other code in the task has executed. (Learn more about
     * [tasks and microtasks][1].)
     *
     * We want to execute during the current task so that we don't give code
     * running for other requests a chance to execute before we fire off our
     * request to DynamoDB.
     *
     * So we use `scheduleMicrotask()` to schedule some async work at the end of
     * our current task. Well, we schedule multiple microtasks.
     *
     * We schedule a microtask and then once that executes we schedule another
     * microtask. Like this:
     *
     * ```ts
     * scheduleMicrotask(() => {
     *     scheduleMicrotask(() => {
     *         // ...
     *     });
     * });
     * ```
     *
     * That way we execute after all microtasks queued before our batch
     * execution was scheduled and we execute after all microtasks queued after
     * our batch execution was scheduled.
     *
     * We keep scheduling microtasks until we see no more `getItem()` calls. At
     * this point we assume our task is done batching `getItem()` calls and is now
     * actually waiting for data to be returned.
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/API/HTML_DOM_API/Microtask_guide/In_depth
     */
    private _scheduleBatchExecution() {
        assert(this._scheduledBatch !== null);
        const scheduledBatch = this._scheduledBatch;

        const maybeExecuteBatch = () => {
            assert(scheduledBatch === this._scheduledBatch);
            const lastItemCount = scheduledBatch.itemCount;

            scheduleMicrotask(() => {
                assert(scheduledBatch === this._scheduledBatch);

                if (lastItemCount !== scheduledBatch.itemCount) {
                    maybeExecuteBatch();
                } else {
                    this._scheduledBatch = null;
                    this._executeFullBatch(scheduledBatch);
                }
            });
        };

        scheduleMicrotask(maybeExecuteBatch);
    }

    protected _executeFullBatch(fullBatch: DynamoClientBatch<Input, Output>) {
        // This batch execution is performed in a microtask, so if an error is thrown
        // it's thrown into the void. Add a try/catch so that errors reject the promise
        // resolvers in our batch.
        try {
            const batches = splitDynamoClientBatch(fullBatch, this._maxBatchItemCount);

            for (const batch of batches) {
                void this._executeBatch(batch, 1);
            }
        } catch (error) {
            for (const {keyBatches} of fullBatch.tableBatches.values()) {
                for (const {promiseResolvers} of keyBatches.values()) {
                    for (const promiseResolver of promiseResolvers) {
                        promiseResolver.reject(error);
                    }
                }
            }
        }
    }

    private async _executeBatch(batch: DynamoClientBatch<Input, Output>, attemptNumber: number) {
        // This function is async but called from a synchronous function. So if an
        // error is thrown it's thrown in the void. Add a try/catch so that errors
        // reject the promise resolvers in our batch.
        try {
            assert(batch.itemCount <= 100);

            const {unprocessedBatch} = await this._sendBatchCommand(batch);

            if (unprocessedBatch.itemCount > 0) {
                // The DynamoDB docs strongly recommend us to retry unprocessed key requests
                // with exponential backoff:
                // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
                const delayMs = 50 * 2 ** (attemptNumber - 1);

                if (delayMs > 1000 * 60)
                    throw new DeadlineExceededError(
                        `Could not finish executing batch after ${attemptNumber} attempts`,
                    );

                // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
                const delayMsWithJitter = Math.floor(Math.random() * delayMs);

                setTimeout(() => {
                    void this._executeBatch(unprocessedBatch, attemptNumber + 1);
                }, delayMsWithJitter);
            }
        } catch (error) {
            for (const {keyBatches} of batch.tableBatches.values()) {
                for (const {promiseResolvers} of keyBatches.values()) {
                    for (const promiseResolver of promiseResolvers) {
                        promiseResolver.reject(error);
                    }
                }
            }
        }
    }

    /**
     * Send a batch command to DynamoDB for the provided batch.
     *
     * This function is expected to construct a new batch with any unprocessed
     * items. If all items were processed then the function may return an
     * `unprocessedBatch` with `itemCount` of 0.
     */
    protected abstract _sendBatchCommand(
        batch: DynamoClientBatch<Input, Output>,
    ): Promise<{unprocessedBatch: DynamoClientBatch<Input, Output>}>;
}

/**
 * DynamoDB's [`BatchGetItem`][1] command can get a maximum of 100 items. So if
 * we have a batch larger then that, split it into multiple smaller batches.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
 */
function splitDynamoClientBatch<Input, Output>(
    fullBatch: DynamoClientBatch<Input, Output>,
    maxBatchItemCount: number,
): Array<DynamoClientBatch<Input, Output>> {
    if (fullBatch.itemCount < maxBatchItemCount) {
        return [fullBatch];
    }

    const batches: Array<DynamoClientBatch<Input, Output>> = [];
    let currentBatch: DynamoClientBatch<Input, Output>;

    while (fullBatch.itemCount > 0) {
        currentBatch = {
            itemCount: 0,
            tableBatches: new Map(),
        };
        batches.push(currentBatch);

        for (const [tableName, fullTableBatch] of fullBatch.tableBatches) {
            // If all the remaining keys for this table can fit into the current batch,
            // then move them wholesale into the current batch.
            if (currentBatch.itemCount + fullTableBatch.keyBatches.size <= maxBatchItemCount) {
                fullBatch.tableBatches.delete(tableName);
                fullBatch.itemCount -= fullTableBatch.keyBatches.size;

                assert(!currentBatch.tableBatches.has(tableName));
                currentBatch.tableBatches.set(tableName, fullTableBatch);
                currentBatch.itemCount += fullTableBatch.keyBatches.size;
            }
            // Otherwise, add individual keys to the current batch until we hit the max
            // batch item count.
            else {
                const currentTableBatch = getOrSetDefaultMapValue(
                    currentBatch.tableBatches,
                    tableName,
                    () => ({
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

                // If we are in this code path, then we should be moving only some of the keys
                // in the full batch. Not all of them.
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

/**
 * Responsible for batching multiple `getItem()` calls into one
 * [`BatchGetItem`][1] command for DynamoDB.
 *
 * Implemented as a class so we can have a separate batcher for each read
 * consistency mode.
 *
 * We want each `BatchGetItem` command to have the same read consistency since
 * the slowest individual item latency will be the latency for the entire
 * batch. And strong read consistency may increase latency.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
 */
class DynamoClientGetItemBatcher extends DynamoClientItemBatcherBase<
    null,
    SchemaSerializedObjectValue | null
> {
    private readonly _consistency: DynamoReadConsistency;

    constructor(consistency: DynamoReadConsistency) {
        super({maxBatchItemCount: 100});
        this._consistency = consistency;
    }

    public getItem(tableName: string, key: SchemaSerializedObjectValue) {
        return this._addItem(tableName, key, null);
    }

    protected async _sendBatchCommand(
        batch: DynamoClientBatch<null, SchemaSerializedObjectValue | null>,
    ) {
        const output = await executeDynamoCommand<
            types.BatchGetItemInput,
            types.BatchGetItemOutput
        >("BatchGetItem", {
            RequestItems: Object.fromEntries(
                Array.from(batch.tableBatches, ([tableName, tableBatch]) => {
                    return [
                        tableName,
                        {
                            ConsistentRead: this._consistency === "Strong",
                            Keys: Array.from(tableBatch.keyBatches.values(), ({key}) =>
                                intoDynamoAttributeValueObject(key),
                            ),
                        },
                    ];
                }),
            ),
        });

        for (const [tableName, items] of Object.entries(output.Responses ?? {})) {
            const tableBatch = batch.tableBatches.get(tableName);
            assert(
                tableBatch,
                '"BatchGetItem" output contains a response for a table we didn\'t request',
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
                    '"BatchGetItem" output contains a response for an item we didn\'t request',
                );

                for (const promiseResolver of keyBatch.promiseResolvers) {
                    promiseResolver.resolve(item);
                }

                tableBatch.keyBatches.delete(keyString);
                batch.itemCount -= 1;
            }

            // If all items for this table were present in the response then we can cleanup
            // our table batch.
            if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
        }

        const unprocessedBatch: DynamoClientBatch<null, SchemaSerializedObjectValue | null> = {
            itemCount: 0,
            tableBatches: new Map(),
        };

        // If we have any unprocessed keys move them into a new unprocessed batch
        // object.
        if (output.UnprocessedKeys) {
            for (const [tableName, {Keys: unprocessedKeys}] of Object.entries(
                output.UnprocessedKeys,
            )) {
                const tableBatch = batch.tableBatches.get(tableName);
                assert(
                    tableBatch,
                    '"BatchGetItem" output contains a response for a table we didn\'t request',
                );

                if (unprocessedKeys && unprocessedKeys?.length > 1) {
                    const unprocessedTableBatch = getOrSetDefaultMapValue(
                        unprocessedBatch.tableBatches,
                        tableName,
                        () => ({
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
                            '"BatchGetItem" output contains a response for an item we didn\'t request',
                        );

                        tableBatch.keyBatches.delete(keyString);
                        batch.itemCount -= 1;

                        assert(!unprocessedTableBatch.keyBatches.has(keyString));
                        unprocessedTableBatch.keyBatches.set(keyString, keyBatch);
                        unprocessedBatch.itemCount += 1;
                    }

                    // If all items for this table were present in the response then we can cleanup
                    // our table batch.
                    if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
                }
            }
        }

        // For keys that were not returned in either `Responses` or `UnprocessedKeys`,
        // that means they do not have an item in DynamoDB and should resolve to null.
        for (const {keyBatches} of batch.tableBatches.values()) {
            for (const {promiseResolvers} of keyBatches.values()) {
                for (const promiseResolver of promiseResolvers) {
                    promiseResolver.resolve(null);
                }
            }
        }

        return {unprocessedBatch};
    }
}

type DynamoClientWriteItemBatchAction =
    | {action: "Put"; item: SchemaSerializedObjectValue}
    | {action: "Delete"};

/**
 * Responsible for batching multiple `putItem()` and `deleteItem()` calls into
 * one [`BatchWriteItem`][1] command for DynamoDB.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
 */
class DynamoClientWriteItemBatcher extends DynamoClientItemBatcherBase<
    DynamoClientWriteItemBatchAction,
    void
> {
    constructor() {
        super({maxBatchItemCount: 25});
    }

    public putItem(
        tableName: string,
        key: SchemaSerializedObjectValue,
        item: SchemaSerializedObjectValue,
    ): Promise<void> {
        return this._addItem(tableName, key, {action: "Put", item});
    }

    public deleteItem(tableName: string, key: SchemaSerializedObjectValue): Promise<void> {
        return this._addItem(tableName, key, {action: "Delete"});
    }

    protected async _sendBatchCommand(
        batch: DynamoClientBatch<DynamoClientWriteItemBatchAction, void>,
    ) {
        const output = await executeDynamoCommand<
            types.BatchWriteItemInput,
            types.BatchWriteItemOutput
        >("BatchWriteItem", {
            RequestItems: Object.fromEntries(
                Array.from(batch.tableBatches, ([tableName, tableBatch]) => {
                    return [
                        tableName,
                        Array.from(tableBatch.keyBatches.values(), ({key, input}) => {
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
        });

        const unprocessedBatch: DynamoClientBatch<DynamoClientWriteItemBatchAction, void> = {
            itemCount: 0,
            tableBatches: new Map(),
        };

        // If we have any unprocessed keys move them into a new unprocessed batch
        // object.
        if (output.UnprocessedItems) {
            for (const [tableName, unprocessedItems] of Object.entries(output.UnprocessedItems)) {
                const tableBatch = batch.tableBatches.get(tableName);
                assert(
                    tableBatch,
                    '"BatchWriteItem" output contains a response for a table we didn\'t request',
                );

                const unprocessedTableBatch = getOrSetDefaultMapValue(
                    unprocessedBatch.tableBatches,
                    tableName,
                    () => ({
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
                            'Unrecognized unprocessed item in "BatchWriteItem" output',
                        );
                    }

                    const keyString = jsonStableStringify(key);
                    const keyBatch = tableBatch.keyBatches.get(keyString);
                    assert(
                        keyBatch,
                        '"BatchWriteItem" output contains a response for an item we didn\'t request',
                    );

                    tableBatch.keyBatches.delete(keyString);
                    batch.itemCount -= 1;

                    assert(!unprocessedTableBatch.keyBatches.has(keyString));
                    unprocessedTableBatch.keyBatches.set(keyString, keyBatch);
                    unprocessedBatch.itemCount += 1;
                }

                // If all items for this table were present in the response then we can cleanup
                // our table batch.
                if (tableBatch.keyBatches.size === 0) batch.tableBatches.delete(tableName);
            }
        }

        // For keys that were not returned in `UnprocessedItems`, that means the write
        // succeeded so we can resolve the promises for the batched items.
        for (const {keyBatches} of batch.tableBatches.values()) {
            for (const {promiseResolvers} of keyBatches.values()) {
                for (const promiseResolver of promiseResolvers) {
                    promiseResolver.resolve();
                }
            }
        }

        return {unprocessedBatch};
    }
}

export const dynamoClient = new DynamoClient();

const dynamoUrl = `http://127.0.0.1:${localstackEdgePort}`;

async function executeDynamoCommand<Input = never, Output = unknown>(
    command: string,
    input: Input,
): Promise<Output> {
    const response = await awsClient.fetch(dynamoUrl, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-amz-json-1.0",
            "X-Amz-Target": `DynamoDB_20120810.${command}`,
        },
        body: JSON.stringify(input),
    });

    const output: any = await response.json();

    if (response.status !== 200) throw classifyDynamoError(output);

    return output;
}

/**
 * The DynamoDB API has this awkward format where the type for all values must
 * be tagged. This function converts from our serialized value format to
 * DynamoDB's attribute value format.
 */
// NOTE(calebmer): The extra object allocation and traversal is a little annoying.
// What if we implemented our own custom DynamoDB client that made HTTP calls
// directly to DynamoDB? Then we could directly write values to a stream and avoid
// some excess iteration.
//
// We could also likely build a faster serialization/deserialization API into
// `Schema`. For instance, what if `Schema` generated code that directly wrote
// to our DynamoDB stream in the right attribute value? So fast.
function intoDynamoAttributeValue(value: SchemaSerializedValue): types.AttributeValue {
    switch (typeof value) {
        case "boolean":
            return {BOOL: value};
        case "number":
            return {N: JSON.stringify(value)};
        case "string":
            return {S: value};
        case "object": {
            if (value === null) return {NULL: true};
            if (isReadonlyArray(value)) return {L: value.map(intoDynamoAttributeValue)};
            if (value instanceof Uint8Array) return {B: value};
            return {M: intoDynamoAttributeValueObject(value)};
        }
        default:
            throw exhaustive(value);
    }
}

function intoDynamoAttributeValueObject(value: SchemaSerializedObjectValue): {
    [key: string]: types.AttributeValue;
} {
    const newObject: {[key: string]: types.AttributeValue} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keyValue === undefined) continue;
        newObject[key] = intoDynamoAttributeValue(keyValue);
    }

    return newObject;
}

/**
 * The DynamoDB API has this awkward format where the type for all values must
 * be tagged. This function converts from the DynamoDB attribute value format
 * to our serialized value format.
 */
function fromDynamoAttributeValue(value: types.AttributeValue): SchemaSerializedValue {
    if (value.NULL !== undefined) return null;
    if (value.BOOL !== undefined) return value.BOOL;
    if (value.N !== undefined) return JSON.parse(value.N);
    if (value.S !== undefined) return value.S;
    if (value.L !== undefined) return value.L.map(fromDynamoAttributeValue);
    if (value.B !== undefined) return new JsonStringifiableUint8Array(value.B);
    if (value.M !== undefined) return fromDynamoAttributeValueObject(value.M);

    throw new InternalError("Unexpected DynamoDB attribute value");
}

function fromDynamoAttributeValueObject(value: {
    [key: string]: types.AttributeValue;
}): SchemaSerializedObjectValue {
    const newObject: {[key: string]: SchemaSerializedValue} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keyValue === undefined) continue;
        newObject[key] = fromDynamoAttributeValue(keyValue);
    }

    return newObject;
}
