import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoReadConsistency, dynamoClient} from "~/server/dynamo/internal/dynamo_client";
import {
    DynamoCondition,
    DynamoConditionExpression,
    DynamoConditionExpressionCompilationContext,
} from "~/server/dynamo/internal/dynamo_condition";
import {
    DynamoKeyAttribute,
    dynamoKeySeparator,
} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo_table_schema_types";
import {checkSchemaBackwardsCompatibility} from "~/server/schema/check_schema_backwards_compatibility";
import {DataLossError, InvalidArgumentError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order_key";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {
    ObjectSchema,
    SchemaDeserializationError,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

/**
 * When schema evolution is enabled, the schema in code may be different from
 * the last schema used to write to the database.
 *
 * We will validate that the schema in code is backwards compatible with the
 * last schema used to write to the database. Then we will record the schema in
 * code as the schema to which data in the database should adhere.
 */
// TODO(calebmer): Backwards compatibility checking in a way that works with
// Cloudflare workers.
// const isSchemaEvolutionEnabled =
//     (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")&& !isCi;
const isSchemaEvolutionEnabled =
    process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

// TODO(calebmer): Backwards compatibility checking in a way that works with
// Cloudflare workers.
// const dynamoGeneratedDirectoryPath = path.join(
//     workspacePath,
//     "server/dynamo/internal/generated",
// );

export type DynamoTableSchemaGetTypes<Schema extends DynamoTableSchema<any>> =
    Schema extends DynamoTableSchema<infer Types> ? Types : never;

export type DynamoTableKeyType<
    Schema extends DynamoTableSchema<any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    DynamoTableSchemaGetTypes<Schema>["Key"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

export type DynamoTableItemType<
    Schema extends DynamoTableSchema<any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    DynamoTableSchemaGetTypes<Schema>["Item"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

/**
 * Abstraction over DynamoDB tables for defining the type of data that resides
 * within. Features of this abstraction:
 *
 * - Define the type of data in your DynamoDB table using our `Schema`
 *   abstraction.
 * - Forces you to structure your table in a way that is easy to evolve over
 *   time without migrations. (Multiple partition types, multiple sort range
 *   types.)
 * - Ensures you always evolve your schema in a backwards compatible way.
 *   (Saves a description of the schema to the git repo and checks against it
 *   whenever you make a change.)
 * - Automatically provisions AWS resources needed for the table using the
 *   AWS CDK.
 * - Reads and writes are automatically batched behind the scenes when
 *   possible.
 * - Queries use async iterators to transparently paginate.
 * - Transactions automatically use the request id to ensure idempotency.
 */
export class DynamoTableSchema<
    Types extends DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>,
> {
    /**
     * The config is the object you pass into the constructor when initializing the
     * table.
     *
     * How it's different from `_description`:
     *
     * - Contains full `Schema` objects instead of a JSON description. So you need
     *   the config to serialize/deserialize values from DynamoDB.
     * - The object style is optimize for the developers who manually write the
     *   object. So we pick shorter names like `partitions` instead of longer,
     *   explicit names like `partitionByType`.
     */
    private readonly _config: DynamoTableSchemaTypes.ConfigBase;

    /**
     * The description is a JSON object we generate from the config and last
     * description object committed to the git repo.
     *
     * How it's different from `_config`:
     *
     * - Contains an `OrderKey` for sort ranges. This `OrderKey` is taken from the
     *   last schema description that we loaded from the git repo. If no `OrderKey`
     *   exists in that description for the sort range then we generate a new one.
     * - Fully serializable to JSON. So does not contain `Schema` objects but
     *   rather contains a `SchemaSerializedValueDescription`.
     */
    private readonly _description: DynamoTableSchemaTypes.Description;

    /**
     * Have we serialized our description to disk yet? We wait for the first write
     * against our database to do this.
     *
     * Reads are safe since on schema construction we assert that our current
     * description is backwards compatible with the description saved to disk.
     */
    private _hasCommitDescription = false;

    public static new<Config extends DynamoTableSchemaTypes.ConfigBase>(
        config: Config,
    ): DynamoTableSchema<DynamoTableSchemaTypes.Types<Config>> {
        return new DynamoTableSchema(config);
    }

    private constructor(config: DynamoTableSchemaTypes.ConfigBase) {
        this._config = config;

        const {description} = getAndCheckDynamoTableSchemaDescriptions(this._config);

        this._description = description;

        assert(!allConstructedDynamoTableSchemas.has(this._config.name));
        allConstructedDynamoTableSchemas.set(this._config.name, this);
    }

    public getName() {
        return this._config.name;
    }

    /**
     * Serializes a key object to the two attribute values we store in the
     * database.
     *
     * Also returns the `Schema` object for attributes of the key's sort range.
     *
     * The key format is a list of strings separated by a `#` character.
     */
    private _serializeKey(key: Types["Key"]): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        const partitionConfig = this._config.partitions[key.partitionType];
        const partitionDescription = this._description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRanges[key.sortRangeType];
        const sortRangeDescription = partitionDescription.sortRangeByType[key.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        const partitionKeyEntries = [key.partitionType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        const sortKeyEntries = [sortRangeDescription.orderKey, key.sortRangeType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            sortKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        const partitionKey = partitionKeyEntries.join(dynamoKeySeparator);

        const sortKey = sortKeyEntries.join(dynamoKeySeparator);

        return {
            partitionKey,
            sortKey,
            attributesSchema: sortRangeConfig.attributes,
        };
    }

    /**
     * Deserializes the two key attribute values we store in the database to our
     * key object.
     *
     * Also returns the `Schema` object for attributes of the key's sort range.
     */
    private _deserializeKey(
        partitionKey: string,
        sortKey: string,
    ): {
        key: Types["Key"];
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        const partitionKeyEntries = partitionKey.split(dynamoKeySeparator);
        const sortKeyEntries = sortKey.split(dynamoKeySeparator);

        const partitionType = partitionKeyEntries[0];
        const sortRangeType = sortKeyEntries[1];
        assert(partitionType, "Invalid partition key");
        assert(sortRangeType, "Invalid sort key");

        const partitionConfig = this._config.partitions[partitionType];
        const partitionDescription = this._description.partitionByType[partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition key");
        const sortRangeConfig = partitionConfig.sortRanges[sortRangeType];
        const sortRangeDescription = partitionDescription.sortRangeByType[sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort key");

        assert(sortKeyEntries[0] === sortRangeDescription.orderKey, "Invalid sort key");

        const key: any = {partitionType};

        let partitionKeyEntryIndex = 1;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            const partitionKeyEntry = partitionKeyEntries[partitionKeyEntryIndex++];
            assert(partitionKeyEntry !== undefined, "Invalid partition key");
            key[attributeKey] = attributeSchema.deserialize(
                partitionKeyEntry as DynamoKeyAttribute,
            );
        }

        key.sortRangeType = sortRangeType;

        let sortKeyEntryIndex = 2;
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            const sortKeyEntry = sortKeyEntries[sortKeyEntryIndex++];
            assert(sortKeyEntry !== undefined, "Invalid sort key");
            key[attributeKey] = attributeSchema.deserialize(sortKeyEntry as DynamoKeyAttribute);
        }

        return {
            key,
            attributesSchema: sortRangeConfig.attributes,
        };
    }

    /**
     * Gets a single item by its key from the database. Returns `null` if the item
     * does not exist.
     *
     * Corresponds to the [`GetItem`][1] command. If you call this function many
     * times in parallel then we will batch the reads together into a
     * [`BatchGetItem`][2] command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchGetItem.html
     */
    public async getItem<Key extends Types["Key"]>(
        key: Key,
        {consistency}: {consistency?: DynamoReadConsistency} = {},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        const serializedItem = await dynamoClient.getItem({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            consistency,
        });
        if (!serializedItem) return null;

        const item: any = {...key};
        try {
            attributesSchema.deserializeInto(serializedItem, item);
        } catch (error) {
            // Reclassify deserialization errors from data stored in the database as data
            // loss errors. It means we have corrupt data stored in the database!
            if (error instanceof SchemaDeserializationError) {
                throw new DataLossError(error.message, {cause: error});
            }
            throw error;
        }

        return item;
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Returns
     * `null` if the item does not exist.
     *
     * Corresponds to the [`GetItem`][1] command with `ProjectionExpression` set.
     * At this time we do not batch `getPartialItem()` commands.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    public async getPartialItem<
        Key extends Types["Key"],
        // Here, `keyof (Types["Item"] & Key)` ends up giving us the type
        // `keyof Types["Item"]` which isn't what we want. We only want the keys of the
        // item for the provided `Key`. However, we've found a different implementation
        // of `keyof` that works for us. See `KeyofImplementedWithConditionalType`.
        Attributes extends string & KeyofImplementedWithConditionalType<Types["Item"] & Key>,
    >(
        key: Key,
        {
            attributes,
            consistency,
        }: {
            attributes: Array<Attributes>;
            consistency?: DynamoReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>> | null> {
        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        assert(
            attributesSchema instanceof ObjectSchema,
            "Expected a schema created by `Schema.object()`",
        );

        const projectionExpressionEntries = [];
        for (const propertyKey of attributes) {
            const propertySchema = attributesSchema.propertySchemaByKey.get(propertyKey);
            assert(propertySchema, "Property not found");

            const serializedKey = propertySchema.serializedKey ?? propertyKey;
            projectionExpressionEntries.push(serializedKey);
        }

        const serializedItem = await dynamoClient.getItem({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            consistency,
            projectionExpression:
                projectionExpressionEntries.length !== 0
                    ? projectionExpressionEntries.join(", ")
                    : "partitionKey",
        });
        if (!serializedItem) return null;

        const item: any = {...key};
        try {
            for (const propertyKey of attributes) {
                const propertySchema = attributesSchema.propertySchemaByKey.get(propertyKey);
                assert(propertySchema, "Property not found");

                const serializedKey = propertySchema.serializedKey ?? propertyKey;

                const propertyValue = propertySchema.deserializeProperty(
                    serializedItem,
                    serializedKey,
                );
                item[propertyKey] = propertyValue;
            }
        } catch (error) {
            // Reclassify deserialization errors from data stored in the database as data
            // loss errors. It means we have corrupt data stored in the database!
            if (error instanceof SchemaDeserializationError) {
                throw new DataLossError(error.message, {cause: error});
            }
            throw error;
        }

        return item;
    }

    /**
     * Puts an item into the database. If an item with the same key already exists
     * then we will replace that item.
     *
     * If you provide a condition then the condition must evaluate to true for the
     * write to succeed. Otherwise an error is thrown. Use this to implement
     * [optimistic locking][1].
     *
     * Corresponds to the [`PutItem`][2] command. If you call this function many
     * times in parallel (without a condition) then we will batch the writes
     * together into a [`BatchWriteItem`][3] command.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [3]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async putItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): Promise<void> {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(item as Types["Key"]);

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return dynamoClient.putItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                item: serializedItem,
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return dynamoClient.putItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    /**
     * Deletes an item from the database. If the item doesn't exist, this is
     * a noop.
     *
     * If you provide a condition then the condition must evaluate to true for the
     * write to succeed. Otherwise an error is thrown. Use this to implement
     * [optimistic locking][1].
     *
     * Corresponds to the [`DeleteItem`][2] command. If you call this function many
     * times in parallel (without a condition) then we will batch the writes
     * together into a [`BatchWriteItem`][3] command.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     * [3]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public deleteItem<Key extends Types["Key"]>(
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): Promise<void> {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        if (condition === undefined) {
            return dynamoClient.deleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return dynamoClient.deleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    /**
     * Perform up to 25 actions atomically with [`TransactWriteItems`][1]. Either
     * all actions in the transaction succeed or if one action fails then none of
     * the actions in the transaction will be applied.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public static async executeTransaction(
        entries: ReadonlyArray<DynamoTransactionEntry>,
        options?: {clientRequestToken?: string},
    ): Promise<void> {
        await dynamoClient.executeTransaction(entries, options);
    }

    /**
     * Creates a transaction entry to put an item into the database. Same semantics
     * as `putItem()` but you can perform multiple writes in a single transaction
     * so they all succeed or fail together.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionPutItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): DynamoTransactionEntry {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(item as Types["Key"]);

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return dynamoClient.transactionPutItem({
                tableName: this._config.name,
                item: serializedItem,
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return dynamoClient.transactionPutItem({
                tableName: this._config.name,
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    /**
     * Creates a transaction entry to delete an item from the database. Same
     * semantics as `deleteItem()` but you can perform multiple writes in a single
     * transaction so they all succeed or fail together.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDeleteItem<Key extends Types["Key"]>(
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): DynamoTransactionEntry {
        this._commitDescriptionOnFirstWrite();

        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        if (condition === undefined) {
            return dynamoClient.transactionDeleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return dynamoClient.transactionDeleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            });
        }
    }

    /**
     * Creates a transaction entry that checks that a condition evaluates to true
     * for the provided key. If the condition fails then the entire transaction
     * which contains this condition check fails.
     *
     * See the [`TransactWriteItems`][1] command for more information about the
     * condition check.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactWriteItems.html
     */
    public transactionConditionCheck<Key extends Types["Key"]>(
        key: Key,
        condition: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeKey(key);

        const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
        const conditionExpression = DynamoConditionExpression.from(condition);
        const {string: conditionExpressionString} = conditionExpression.compile(
            attributesSchema,
            conditionCompilationContext,
        );

        return dynamoClient.transactionConditionCheck({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            conditionExpression: conditionExpressionString,
            expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
        });
    }

    /**
     * Queries a range of a partition in the table. Queries are how you get many
     * items from the database at once. Queries require you to carefully structure
     * your table ahead of time so that items that need to be read together are
     * physically next to each other.
     *
     * Through some TypeScript magic, the return type of this function only
     * includes valid items within the provided range.
     *
     * Corresponds to the [`Query`][1] command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     */
    public query<
        PartitionKey extends Types["PartitionKey"],
        StartKey extends Types["Key"] & PartitionKey,
        EndKey extends Types["Key"] & PartitionKey,
    >({
        startKey,
        endKey,
        limit,
        descending,
        consistency,
    }: {
        startKey: StartKey;
        endKey: EndKey;
        limit?: number;
        descending?: boolean;
        consistency?: DynamoReadConsistency;
    }): AsyncIterableIterator<
        MergeObjectIntersection<
            Types["Item"] &
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartKey["sortRangeType"]][EndKey["sortRangeType"]];
                }
        >
    > {
        const {partitionKey: startPartitionKey, sortKey: startSortKey} =
            this._serializeKey(startKey);
        const {partitionKey: endPartitionKey, sortKey: endSortKey} = this._serializeKey(endKey);

        if (startPartitionKey !== endPartitionKey)
            throw new InvalidArgumentError(
                "The partition key of our start key and end key should be the same",
            );

        const iterator = dynamoClient.query({
            tableName: this._config.name,
            partitionKey: {
                name: "partitionKey",
                value: startPartitionKey,
            },
            sortKey: {
                name: "sortKey",
                startValue: startSortKey,
                endValue: endSortKey,
            },
            consistency,
            limit,
            descending,
        });

        return mapAsyncIterableIterator(iterator, serializedItem => {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            const {key, attributesSchema} = this._deserializeKey(
                serializedItem.partitionKey,
                serializedItem.sortKey,
            );

            const item: any = key;
            try {
                attributesSchema.deserializeInto(serializedItem, item);
            } catch (error) {
                // Reclassify deserialization errors from data stored in the database as data
                // loss errors. It means we have corrupt data stored in the database!
                if (error instanceof SchemaDeserializationError) {
                    throw new DataLossError(error.message, {cause: error});
                }
                throw error;
            }

            return item;
        });
    }

    /**
     * Before we start writing data to DynamoDB, we should commit our new
     * description. In case newly written data uses the new schema.
     *
     * We wait until the first write to commit our description so if the user is
     * iterating on code in their editor we don't lock their new schema in until
     * they start writing data.
     *
     * Synchronous because we want to call this in our transaction functions as
     * well which return an object synchronously.
     */
    private _commitDescriptionOnFirstWrite() {
        if (!isSchemaEvolutionEnabled) return;
        if (this._hasCommitDescription) return;

        // TODO(calebmer): Backwards compatibility checking in a way that works with
        // Cloudflare workers.
        // fs.writeFileSync(this._descriptionPath, JSON.stringify(this._description, null, 4));
        this._hasCommitDescription = true;
    }
}

const allConstructedDynamoTableSchemas = new Map<
    string,
    DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
>();

/**
 * Get all `DynamoTableSchema`s that have been constructed so far.
 *
 * They will be sorted by name so the order is deterministic.
 */
export function getAllConstructedDynamoTableSchemas(): Array<
    DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
> {
    return Array.from(allConstructedDynamoTableSchemas)
        .sort(([name1], [name2]) => defaultCompareStrings(name1, name2))
        .map(([, schema]) => schema);
}

/**
 * Loads the last schema description from the file system, creates the next
 * schema description from the schema config, and checks that the next schema
 * description is backwards compatible with the last schema description.
 *
 * Also generates `OrderKey`s for sort ranges which don't have them. Every sort
 * range gets an `OrderKey` and the lexicographic order of `OrderKey`s
 * corresponds to the order in which the sort ranges were defined. We include
 * the `OrderKey` at the beginning of the sort key so that sort ranges in the
 * database have the same order as when they were defined in code.
 *
 * After an `OrderKey` is set for a sort range it may not be changed! That
 * would be a backwards incompatible change since we've saved data to the
 * database with that `OrderKey`. However, you may add new sort ranges between
 * two existing sort ranges. We will generate an `OrderKey` between the
 * `OrderKey`s of the existing sort ranges.
 */
function getAndCheckDynamoTableSchemaDescriptions(config: DynamoTableSchemaTypes.ConfigBase): {
    lastDescription: DynamoTableSchemaTypes.Description | null;
    description: DynamoTableSchemaTypes.Description;
} {
    // TODO(calebmer): Backwards compatibility checking in a way that works with
    // Cloudflare workers.
    // const descriptionPath = path.join(
    //     dynamoGeneratedDirectoryPath,
    //     `dynamo-${paramCase(config.name)}-table-schema.json`,
    // );

    // TODO(calebmer): Backwards compatibility checking in a way that works with
    // Cloudflare workers.
    // const lastDescription: DynamoTableSchemaTypes.Description | null = fs.existsSync(descriptionPath)
    //     ? JSON.parse(fs.readFileSync(descriptionPath, "utf8"))
    //     : null;
    const lastDescription = null as DynamoTableSchemaTypes.Description | null;

    const description: DynamoTableSchemaTypes.Description = {
        name: config.name,
        partitionByType: mapObjectValues(
            config.partitions,
            (partitionConfig, partitionType): DynamoTableSchemaTypes.Partition.Description => {
                // Iterate through all our sort ranges, in order, finding contiguous subsets of
                // the list which do not have an `OrderKey` in the last description. For these
                // sort ranges generate new `OrderKey`s for our new description.
                const sortRangeOrderKeyByType = new Map<string, OrderKey>();
                let lastExistingSortRangeOrderKey: OrderKey | null = null;
                let sortRangeTypesWithoutExistingOrderKey = [];

                for (const sortRangeType of Object.keys(partitionConfig.sortRanges)) {
                    const existingSortRangeOrderKey =
                        lastDescription?.partitionByType[partitionType]?.sortRangeByType[
                            sortRangeType
                        ]?.orderKey;

                    if (!existingSortRangeOrderKey) {
                        sortRangeTypesWithoutExistingOrderKey.push(sortRangeType);
                    } else {
                        // The order of `sortRanges` in our config object matters! It must be the same
                        // as the order key order. Throw an error if we detect the developer may have
                        // moved things around. That's a backwards incompatible change.
                        if (
                            lastExistingSortRangeOrderKey !== null &&
                            lastExistingSortRangeOrderKey >= existingSortRangeOrderKey
                        ) {
                            throw new InvalidArgumentError(
                                `Order key for sort range \`${sortRangeType}\` is less than a previous sort range order key. Did you reorder your sort range object?`,
                            );
                        }

                        const newSortRangeOrderKeys = generateOrderKeysBetween(
                            lastExistingSortRangeOrderKey,
                            existingSortRangeOrderKey,
                            sortRangeTypesWithoutExistingOrderKey.length,
                        );

                        for (
                            let index = 0;
                            index < sortRangeTypesWithoutExistingOrderKey.length;
                            index++
                        ) {
                            sortRangeOrderKeyByType.set(
                                sortRangeTypesWithoutExistingOrderKey[index]!,
                                newSortRangeOrderKeys[index]!,
                            );
                        }

                        lastExistingSortRangeOrderKey = existingSortRangeOrderKey;
                        sortRangeTypesWithoutExistingOrderKey = [];
                        sortRangeOrderKeyByType.set(sortRangeType, existingSortRangeOrderKey);
                    }
                }

                const newSortRangeOrderKeys = generateOrderKeysBetween(
                    lastExistingSortRangeOrderKey,
                    null,
                    sortRangeTypesWithoutExistingOrderKey.length,
                );

                for (let index = 0; index < sortRangeTypesWithoutExistingOrderKey.length; index++) {
                    sortRangeOrderKeyByType.set(
                        sortRangeTypesWithoutExistingOrderKey[index]!,
                        newSortRangeOrderKeys[index]!,
                    );
                }

                return {
                    partitionKeyAttributeByKey: mapObjectValues(
                        partitionConfig.partitionKeyAttributes,
                        keyAttribute => keyAttribute.description,
                    ),
                    sortRangeByType: mapObjectValues(
                        partitionConfig.sortRanges,
                        (
                            sortRangeConfig,
                            sortRangeType,
                        ): DynamoTableSchemaTypes.SortRange.Description => ({
                            orderKey: sortRangeOrderKeyByType.get(sortRangeType)!,
                            sortKeyAttributeByKey: mapObjectValues(
                                sortRangeConfig.sortKeyAttributes,
                                keyAttribute => keyAttribute.description,
                            ),
                            attributesSchema: sortRangeConfig.attributes.description,
                        }),
                    ),
                };
            },
        ),
    };

    // If we have a description saved, then verify our new description is backwards
    // compatible with the old description. We will save our new description the
    // first time an item is written to this table.
    if (lastDescription !== null) {
        checkDynamoTableSchemaDescriptionBackwardsCompatibility(lastDescription, description);

        // We only allow schema evolution in development and test environments. If we
        // are running in production then our schema's description in code must exactly
        // match the generated schema description. We can check exact equality by
        // running our backwards compatibility check in the other direction.
        if (!isSchemaEvolutionEnabled) {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(description, lastDescription);
        }
    }

    return {
        // TODO(calebmer): Backwards compatibility checking in a way that works with
        // Cloudflare workers.
        // descriptionPath,
        lastDescription,
        description,
    };
}

function checkDynamoTableSchemaDescriptionBackwardsCompatibility(
    lastDescription: DynamoTableSchemaTypes.Description,
    nextDescription: DynamoTableSchemaTypes.Description,
): void {
    if (lastDescription.name !== nextDescription.name)
        throw new InvalidArgumentError(
            `Table name \`${lastDescription.name}\` is not the same as \`${nextDescription.name}\``,
        );

    const missingPartitionTypes = new Set(Object.keys(lastDescription.partitionByType));

    for (const [partitionType, nextPartitionSchemaDescription] of Object.entries(
        nextDescription.partitionByType,
    )) {
        if (missingPartitionTypes.delete(partitionType)) {
            checkDynamoTablePartitionSchemaDescriptionBackwardsCompatibility(
                partitionType,
                lastDescription.partitionByType[partitionType]!,
                nextPartitionSchemaDescription,
            );
        }
    }

    for (const partitionName of missingPartitionTypes)
        throw new InvalidArgumentError(`Partition \`${partitionName}\` is missing`);
}

function checkDynamoTablePartitionSchemaDescriptionBackwardsCompatibility(
    type: string,
    lastDescription: DynamoTableSchemaTypes.Partition.Description,
    nextDescription: DynamoTableSchemaTypes.Partition.Description,
): void {
    const lastKeyAttributeDescriptions = Object.values(lastDescription.partitionKeyAttributeByKey);
    const nextKeyAttributeDescriptions = Object.values(nextDescription.partitionKeyAttributeByKey);

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastKeyAttributeDescriptions, nextKeyAttributeDescriptions))
        throw new InvalidArgumentError(`Incompatible partition key for partition \`${type}\``);

    const missingSortRangeTypes = new Set(Object.keys(lastDescription.sortRangeByType));

    for (const [sortRangeType, nextSortRangeSchemaDescription] of Object.entries(
        nextDescription.sortRangeByType,
    )) {
        if (missingSortRangeTypes.delete(sortRangeType)) {
            checkDynamoTableSortRangeSchemaDescriptionBackwardsCompatibility(
                sortRangeType,
                lastDescription.sortRangeByType[sortRangeType]!,
                nextSortRangeSchemaDescription,
            );
        }
    }

    for (const sortRange of missingSortRangeTypes)
        throw new InvalidArgumentError(`Sort range \`${sortRange}\` is missing`);
}

function checkDynamoTableSortRangeSchemaDescriptionBackwardsCompatibility(
    type: string,
    lastDescription: DynamoTableSchemaTypes.SortRange.Description,
    nextDescription: DynamoTableSchemaTypes.SortRange.Description,
): void {
    const lastKeyAttributeDescriptions = Object.values(lastDescription.sortKeyAttributeByKey);
    const nextKeyAttributeDescriptions = Object.values(nextDescription.sortKeyAttributeByKey);

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastKeyAttributeDescriptions, nextKeyAttributeDescriptions))
        throw new InvalidArgumentError(`Incompatible sort key for sort range \`${type}\``);

    if (lastDescription.orderKey !== nextDescription.orderKey)
        throw new InvalidArgumentError(`Incompatible order key for sort range \`${type}\``);

    checkSchemaBackwardsCompatibility(
        lastDescription.attributesSchema,
        nextDescription.attributesSchema,
    );
}

/**
 * An alternative implementation of `keyof T` that seems to work in
 * `getPartialItem()` whereas `keyof` doesn't.
 */
type KeyofImplementedWithConditionalType<T> = T extends {[K in infer U]: any} ? U : never;
