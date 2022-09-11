import {
    AttributeValue,
    BatchGetItemCommand,
    DynamoDBClient,
    KeysAndAttributes,
} from "@aws-sdk/client-dynamodb";
import {Command, MetadataBearer} from "@aws-sdk/types";
import {expectTypeOf} from "expect-type";
import jsonStableStringify from "json-stable-stringify";
import {isReadonlyArray} from "~/shared/helpers/array/is-readonly-array";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";
import {
    JsonStringifiableUint8Array,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

export type DynamoReadConsistency = "Eventual" | "Strong";

/**
 * The interface of a DynamoDB client from the AWS SDK that our client wrapper
 * uses.
 *
 * Having this as an interface is useful for writing tests against a mock
 * client.
 */
export interface DynamoWrappedClientInterface {
    send<InputType extends object, OutputType extends MetadataBearer>(
        command: Command<object, InputType, MetadataBearer, OutputType, object>,
    ): Promise<OutputType>;
}

// Make sure the actual AWS SDK DynamoDB client matches our interface.
expectTypeOf<DynamoDBClient>().toMatchTypeOf<DynamoWrappedClientInterface>();

/**
 * Our client interface to DynamoDB.
 *
 * Wraps the AWS SDK DynamoDB client with some extra functionality like command
 * batching.
 */
export class DynamoClient {
    private readonly _client: DynamoWrappedClientInterface;

    private readonly _getItemBatcherByConsistency: {
        [Key in DynamoReadConsistency]: DynamoClientGetItemBatcher;
    };

    constructor(client: DynamoWrappedClientInterface) {
        this._client = client;

        this._getItemBatcherByConsistency = {
            Eventual: new DynamoClientGetItemBatcher(this._client, "Eventual"),
            Strong: new DynamoClientGetItemBatcher(this._client, "Strong"),
        };
    }

    /**
     * Get a single item from DynamoDB. Corresponds to the [`GetItem`][1] command.
     *
     * For `getItem()` calls made in a short window of time, we will batch them
     * together into a [`BatchGetItem`][2] command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
     */
    public getItem({
        tableName,
        key,
        consistency = "Eventual",
    }: {
        tableName: string;
        key: SchemaSerializedObjectValue;
        consistency?: DynamoReadConsistency;
    }): Promise<SchemaSerializedObjectValue | null> {
        const batcher = this._getItemBatcherByConsistency[consistency];
        return batcher.getItem(tableName, key);
    }
}

type DynamoClientGetItemBatch = {
    itemCount: number;
    tableBatches: Map<string, DynamoClientGetItemTableBatch>;
};

type DynamoClientGetItemTableBatch = {
    keyAttributes: Set<string>;
    keyBatches: Map<string, DynamoClientGetItemKeyBatch>;
};

type DynamoClientGetItemKeyBatch = {
    key: SchemaSerializedObjectValue;
    promiseResolvers: Array<PromiseResolver<SchemaSerializedObjectValue | null>>;
};

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
class DynamoClientGetItemBatcher {
    private readonly _client: DynamoWrappedClientInterface;
    private readonly _consistency: DynamoReadConsistency;

    private _scheduledBatch: DynamoClientGetItemBatch | null = null;

    constructor(client: DynamoWrappedClientInterface, consistency: DynamoReadConsistency) {
        this._client = client;
        this._consistency = consistency;
    }

    /**
     * Add a get item request to the current batch we're building. If we haven't
     * scheduled a batch execution, also do that.
     */
    public getItem(
        tableName: string,
        key: SchemaSerializedObjectValue,
    ): Promise<SchemaSerializedObjectValue | null> {
        if (this._scheduledBatch === null) {
            this._scheduledBatch = {
                itemCount: 0,
                tableBatches: new Map(),
            };
            this._scheduleBatchExecution();
        }

        const keyAttributes = new Set(Object.keys(key));
        const promiseResolver = createPromiseResolver<SchemaSerializedObjectValue | null>();

        const tableBatch = getOrSetDefaultMapValue(
            this._scheduledBatch.tableBatches,
            tableName,
            () => ({
                keyAttributes,
                keyBatches: new Map(),
            }),
        );

        // Make sure all keys for a table use the same attributes.
        assert(isDeepEqual(tableBatch.keyAttributes, keyAttributes));

        const keyBatch = getOrSetDefaultMapValue(
            tableBatch.keyBatches,
            jsonStableStringify(key),
            () => {
                // Every time this function is called, it means we are adding a new key to the
                // map. So increment the number of items this batch is fetching here.
                this._scheduledBatch!.itemCount++;

                return {
                    key,
                    promiseResolvers: [],
                };
            },
        );

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
            let lastItemCount = scheduledBatch.itemCount;

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

    private _executeFullBatch(fullBatch: DynamoClientGetItemBatch) {
        // This batch execution is performed in a microtask, so if an error is thrown
        // it's thrown into the void. Add a try/catch so that errors reject the promise
        // resolvers in our batch.
        try {
            const batches = splitDynamoClientGetItemBatch(fullBatch);

            for (const batch of batches) {
                this._executeBatch(batch, 1);
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

    private async _executeBatch(batch: DynamoClientGetItemBatch, attemptNumber: number) {
        // This function is async but called from a synchronous function. So if an
        // error is thrown it's thrown in the void. Add a try/catch so that errors
        // reject the promise resolvers in our batch.
        try {
            assert(batch.itemCount <= 100);

            const command = new BatchGetItemCommand({
                RequestItems: Object.fromEntries(
                    Array.from(
                        batch.tableBatches,
                        ([tableName, tableBatch]): [string, KeysAndAttributes] => {
                            return [
                                tableName,
                                {
                                    ConsistentRead: this._consistency === "Strong",
                                    Keys: Array.from(tableBatch.keyBatches.values(), ({key}) =>
                                        intoDynamoAttributeValueObject(key),
                                    ),
                                },
                            ];
                        },
                    ),
                ),
            });

            const output = await this._client.send(command);

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

            const unprocessedBatch: DynamoClientGetItemBatch = {
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

            if (unprocessedBatch.itemCount > 0) {
                // The DynamoDB docs strongly recommend us to retry unprocessed key requests
                // with exponential backoff:
                // https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
                const delayMs = Math.min(1000 * 60, 50 * 2 ** (attemptNumber - 1));

                // See: https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter
                const delayMsWithJitter = Math.floor(Math.random() * delayMs);

                setTimeout(() => {
                    this._executeBatch(unprocessedBatch, attemptNumber + 1);
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
}

/**
 * DynamoDB's [`BatchGetItem`][1] command can get a maximum of 100 items. So if
 * we have a batch larger then that, split it into multiple smaller batches.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
 */
function splitDynamoClientGetItemBatch(
    fullBatch: DynamoClientGetItemBatch,
): Array<DynamoClientGetItemBatch> {
    const maxBatchItemCount = 100;

    if (fullBatch.itemCount < maxBatchItemCount) {
        return [fullBatch];
    }

    const batches: Array<DynamoClientGetItemBatch> = [];
    let currentBatch: DynamoClientGetItemBatch;

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
function intoDynamoAttributeValue(value: SchemaSerializedValue): AttributeValue {
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
    [key: string]: AttributeValue;
} {
    const newObject: {[key: string]: AttributeValue} = {};

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
function fromDynamoAttributeValue(value: AttributeValue): SchemaSerializedValue {
    if (value.NULL !== undefined) return null;
    if (value.BOOL !== undefined) return value.BOOL;
    if (value.N !== undefined) return JSON.parse(value.N);
    if (value.S !== undefined) return value.S;
    if (value.L !== undefined) return value.L.map(fromDynamoAttributeValue);
    if (value.B !== undefined) return new JsonStringifiableUint8Array(value.B);
    if (value.M !== undefined) return fromDynamoAttributeValueObject(value.M);

    throw new Error("Unexpected DynamoDB attribute value");
}

function fromDynamoAttributeValueObject(value: {
    [key: string]: AttributeValue;
}): SchemaSerializedObjectValue {
    const newObject: {[key: string]: SchemaSerializedValue} = {};

    for (const [key, keyValue] of Object.entries(value)) {
        if (keyValue === undefined) continue;
        newObject[key] = fromDynamoAttributeValue(keyValue);
    }

    return newObject;
}
