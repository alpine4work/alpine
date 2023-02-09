import {AttributeValue} from "@aws-sdk/client-dynamodb";
import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {
    intoDynamoAttributeValue,
    intoDynamoAttributeValueObject,
} from "~/server/dynamo/internal/dynamo_attribute_value";
import {DynamoClient, DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {
    DynamoCondition,
    DynamoConditionExpression,
    DynamoConditionExpressionCompilationContext,
    DynamoConditionExpressionPrecedence,
} from "~/server/dynamo/internal/dynamo_condition";
import {dynamoGeneratedSchemaDescription} from "~/server/dynamo/internal/dynamo_generated_schema_description";
import {
    DynamoKeyAttribute,
    dynamoKeySeparator,
} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {getDynamoClient} from "~/server/dynamo/internal/get_dynamo_client";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {isDynamoResourceNotFoundError} from "~/server/dynamo/internal/is_dynamo_resource_not_found_error";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo_table_schema_types";
import {checkSchemaBackwardsCompatibility} from "~/server/schema/check_schema_backwards_compatibility";
import {DataLossError, InternalError, InvalidArgumentError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order_key";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {
    ObjectSchema,
    Schema,
    SchemaDeserializationError,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

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

const DynamoTableItemSharedAttributesSchema: ObjectSchema<DynamoTableSchemaTypes.ItemSharedAttributes> =
    Schema.object({
        updateLockVersion: Schema.integer.min(1).optional(),
    });

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
    public readonly description: DynamoTableSchemaTypes.Description;

    /**
     * If our new schema is write incompatible with the old schema then this will
     * be an error. We will throw the error every time you try to write to the
     * table.
     *
     * Once you run the command to update our generated schema this
     * compatibility error should go away.
     */
    private readonly _writeCompatibilityError: Error | null;

    public static new<Config extends DynamoTableSchemaTypes.ConfigBase>(
        config: Config,
    ): DynamoTableSchema<DynamoTableSchemaTypes.Types<Config>> {
        return new DynamoTableSchema(config);
    }

    private constructor(config: DynamoTableSchemaTypes.ConfigBase) {
        // Validate that attribute names are identifiers that do not start with
        // underscores and that attribute names are unique. We do not allow identifiers
        // to start with underscores so we can reserve underscore names for framework
        // properties.
        //
        // Also extends the attribute schema to include internal attributes. So when we
        // serialize/deserialize with the schema we pick up those private attributes.
        config = {
            ...config,
            partitions: mapObjectValues(
                config.partitions,
                (partitionConfig): DynamoTableSchemaTypes.Partition.ConfigBase => {
                    const partitionAttributeNames = new Set<string>([
                        "partitionType",
                        "sortRangeType",
                    ]);

                    for (const attributeName of Object.keys(
                        partitionConfig.partitionKeyAttributes,
                    )) {
                        assert(
                            isIdentifier(attributeName) && !attributeName.startsWith("_"),
                            "Attribute name must be an identifier that does not start with an underscore",
                        );

                        assert(
                            !partitionAttributeNames.has(attributeName),
                            "Attribute names must be unique within an item",
                        );
                        partitionAttributeNames.add(attributeName);
                    }

                    return {
                        ...partitionConfig,
                        sortRanges: mapObjectValues(
                            partitionConfig.sortRanges,
                            (sortRangeConfig): DynamoTableSchemaTypes.SortRange.ConfigBase => {
                                const sortRangeAttributeNames = new Set(partitionAttributeNames);

                                for (const attributeName of Object.keys(
                                    sortRangeConfig.sortKeyAttributes,
                                )) {
                                    assert(
                                        isIdentifier(attributeName) &&
                                            !attributeName.startsWith("_"),
                                        "Attribute name must be an identifier that does not start with an underscore",
                                    );

                                    assert(
                                        !sortRangeAttributeNames.has(attributeName),
                                        "Attribute names must be unique within an item",
                                    );
                                    sortRangeAttributeNames.add(attributeName);
                                }

                                for (const attributeName of sortRangeConfig.attributes.propertySchemaByKey.keys()) {
                                    assert(
                                        isIdentifier(attributeName) &&
                                            !attributeName.startsWith("_"),
                                        "Attribute name must be an identifier that does not start with an underscore",
                                    );

                                    assert(
                                        !sortRangeAttributeNames.has(attributeName),
                                        "Attribute names must be unique within an item",
                                    );
                                    sortRangeAttributeNames.add(attributeName);
                                }

                                return {
                                    ...sortRangeConfig,
                                    attributes: sortRangeConfig.attributes.merge(
                                        DynamoTableItemSharedAttributesSchema,
                                    ),
                                };
                            },
                        ),
                    };
                },
            ),
        };

        this._config = config;

        const {description, writeCompatibilityError} = getAndCheckDynamoTableSchemaDescriptions(
            this._config,
        );
        this.description = description;
        this._writeCompatibilityError = writeCompatibilityError;

        assert(!allConstructedDynamoTableSchemas.has(this._config.name));
        allConstructedDynamoTableSchemas.set(this._config.name, this);
    }

    public getName() {
        return this._config.name;
    }

    private _ensureTablePromise: Promise<void> | null = null;

    private async _getClient(
        context: DynamoContext,
        checkWriteCompatibility: boolean,
    ): Promise<DynamoClient> {
        // If our schema is write incompatible with the old schema then throw an error.
        // Do not allow writing to this table until the generated schema has been
        // updated.
        if (checkWriteCompatibility && this._writeCompatibilityError !== null)
            throw this._writeCompatibilityError;

        const client = getDynamoClient(context);

        // In development environments if we are running against a local DynamoDB then
        // ensure our table exists in the database.
        //
        // Store the ensure table promise so that if we are executing commands in
        // parallel, we only try to create the table once.
        if (process.env.NODE_ENV !== "production") {
            const internalClient = client.getInternalClient();
            if (internalClient.isLocal()) {
                if (!this._ensureTablePromise)
                    this._ensureTablePromise = this._ensureTable(context);
                await this._ensureTablePromise;
            }
        }

        return client;
    }

    /**
     * Ensures that our table exists in DynamoDB.
     */
    private async _ensureTable(context: DynamoContext): Promise<void> {
        const client = getDynamoClient(context);
        const internalClient = client.getInternalClient();
        const tableName = this.getName();

        // Only allow creating tables in this way in local DynamoDB databases. In
        // production we should use the AWS CDK.
        assert(internalClient.isLocal());

        let doesTableExist;
        try {
            await internalClient.DescribeTable(context.tracer.getTracer(), {
                TableName: tableName,
            });
            doesTableExist = true;
        } catch (error) {
            if (isDynamoResourceNotFoundError(error)) {
                doesTableExist = false;
            } else {
                throw error;
            }
        }

        // If our table already exists, we don't have to create it.
        if (doesTableExist) return;

        await internalClient.CreateTable(context.tracer.getTracer(), {
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
        });
    }

    private _serializePartitionKey(key: Types["PartitionKey"]): string {
        const partitionConfig = this._config.partitions[key.partitionType];
        const partitionDescription = this.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");

        const partitionKeyEntries = [key.partitionType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        return partitionKeyEntries.join(dynamoKeySeparator);
    }

    private _serializeItemKey(key: Types["Key"]): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        return this._serializeSeparatedItemKey(key, key as any);
    }

    private _serializeSeparatedItemKey<PartitionKey extends Types["PartitionKey"]>(
        partitionKey: PartitionKey,
        sortKey: Types["SortKeyMap"][PartitionKey["partitionType"]],
    ) {
        const partitionConfig = this._config.partitions[partitionKey.partitionType];
        const partitionDescription = this.description.partitionByType[partitionKey.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRanges[sortKey.sortRangeType];
        const sortRangeDescription = partitionDescription.sortRangeByType[sortKey.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        const partitionKeyEntries = [partitionKey.partitionType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(partitionKey[attributeKey]));
        }

        const sortKeyEntries = [sortRangeDescription.orderKey, sortKey.sortRangeType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            sortKeyEntries.push(attributeSchema.serialize(sortKey[attributeKey]));
        }

        const serializedPartitionKey = partitionKeyEntries.join(dynamoKeySeparator);
        const serializedSortKey = sortKeyEntries.join(dynamoKeySeparator);

        return {
            partitionKey: serializedPartitionKey,
            sortKey: serializedSortKey,
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
        const partitionDescription = this.description.partitionByType[partitionType];
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
        context: DynamoContext,
        key: Key,
        {
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            consistency?: DynamoReadConsistency;
        } = {},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        const client = await this._getClient(context, false);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const serializedItem = await client.getItem(context.tracer.getTracer(), {
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
        Attributes extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        context: DynamoContext,
        key: Key,
        {
            attributes,
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            attributes: Array<Attributes>;
            consistency?: DynamoReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>> | null> {
        const client = await this._getClient(context, false);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const projectionExpressionEntries = [];
        for (const attribute of attributes) {
            const propertySchema = attributesSchema.propertySchemaByKey.get(attribute);
            if (!propertySchema)
                throw new InternalError(quote`Attribute ${attribute} not found in item schema`);

            const serializedKey = propertySchema.serializedKey ?? attribute;
            projectionExpressionEntries.push(serializedKey);
        }

        const serializedItem = await client.getItem(context.tracer.getTracer(), {
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
     * Create an item in the database. If an item with the same key already exists
     * then we will throw a condition check error.
     *
     * Under the hood uses the [`PutItem`][1] command with a condition.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public async createItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<void> {
        await this._putItem(context, item, {
            condition: DynamoConditionExpression._unsafeRaw(
                "attribute_not_exists(partitionKey)",
                DynamoConditionExpressionPrecedence.Function,
            ),
        });
    }

    /**
     * Create an item in the database but only if an item with the same key does
     * not already exist. If an item with the same key does exist then this will
     * not do anything.
     *
     * Under the hood uses the [`PutItem`][1] command with a condition.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public async createItemIfNoneExists<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<void> {
        try {
            await this.createItem(context, item);
        } catch (error) {
            // If this item already exists, great! This is a noop.
            if (isDynamoConditionCheckError(error)) return;

            throw error;
        }
    }

    /**
     * Replace an item that already exists in the database. If an item with the
     * same key does not already exist then we will throw a condition check
     * error.
     *
     * WARNING: Carefully consider concurrent writers when using this method. If
     * two users are writing to the same item at the same time this method will
     * clobber one of the user's updates. You may want to merge the updates
     * instead. You may also clobber locks added by `updateItem()`.
     *
     * You may use the optional `condition` to implement [optimistic locking][1].
     * The `updateItem()` method performs optimistic locking out of the box.
     *
     * Under the hood uses the [`PutItem`][2] command with a condition.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public async replaceItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): Promise<void> {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        await this._putItem(context, item, {
            condition: condition
                ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
                : itemExistsCondition,
        });
    }

    /**
     * Creates an item in the database if one with the same key does not already
     * exist. If an item with the same key does exist then we will replace that
     * item.
     *
     * WARNING: Carefully consider concurrent writers when using this method. If
     * two users are writing to the same item at the same time this method will
     * clobber one of the user's updates. You may want to merge the updates
     * instead. You may also clobber locks added by `updateItem()`.
     *
     * This is the most resource efficient update method! Since it does not require
     * a [read capacity unit (RCU) only a write capacity unit (WCU)][1].
     *
     * Under the hood this directly executes the [`PutItem`][2] command. When
     * called many times in parallel then we will batch the writes together into a
     * [`BatchWriteItem`][3] command.
     *
     * We don't allow a `condition` on this method since a condition on an item
     * that does not exist doesn't make sense.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     * [3]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     */
    public async createOrReplaceItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<void> {
        await this._putItem(context, item);
    }

    /**
     * Updates an existing item in the database atomically. You provide the key for
     * the item you want to update and a function that updates the existing item to
     * a new item.
     *
     * If there are multiple concurrent writers we may re-run the update function
     * multiple times. To cancel an update you may return the exact item object you
     * were provided.
     *
     * This is implemented with [optimistic locking][1]. First we read the item
     * with a [`GetItem`][2] command. If the item does not exist then we throw an
     * error. Then we call our update function and pass the new item into a
     * conditional [`PutItem`][3] command. If a concurrent writer made an update
     * _after_ our read but _before_ our write then the `PutItem` command will fail
     * and we will try again with `retryDynamoConditionCheckErrors()`.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public async updateItem<Key extends Types["Key"]>(
        context: DynamoContext,
        key: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MergeObjectIntersection<Types["Item"] & Key>,
    ): Promise<void> {
        await context.tracer.withSpan("DynamoTableSchema.updateItem", async (context, span) => {
            span.addData({dynamodb: {tableName: this.getName()}});

            await retryDynamoConditionCheckErrors(async () => {
                const item = await this.getItem(context, key);

                // The update function is synchronous to discourage more complex coordination
                // in the middle of an update. For example trying to perform an update across
                // items or tables that really should be part of a transaction.
                //
                // The update function is also synchronous to avoid it executing a write that
                // throws a condition check error that throws off our
                // `retryDynamoConditionCheckErrors()` function.
                //
                // However, it is not a hard requirement that these things do not happen. If
                // the need arises this function could plausibly be async.
                const newItem = update(item);

                // Update was short-circuited.
                if (item === newItem) return;

                if (!item) {
                    await this.createItem(context, {
                        ...newItem,
                        // Make sure to override the lock version if it was set. An undefined lock
                        // version is the same as a lock version of 0. Except we can't set to 0 because
                        // our conditional update looks for a lock version that does not exist.
                        updateLockVersion: undefined,
                    });
                } else {
                    await this.replaceItem(
                        context,
                        {
                            ...newItem,
                            // Increment the lock version in this new item.
                            //
                            // The `update()` function should not change the `updateLockVersion` property
                            // itself. If it does (e.g. creates a new item without the property instead of
                            // spreading the old object) then we override the change.
                            updateLockVersion:
                                typeof item.updateLockVersion === "number"
                                    ? item.updateLockVersion + 1
                                    : 1,
                        },
                        {
                            condition: {
                                // Verify that the lock version was not changed by a concurrent writer.
                                updateLockVersion:
                                    typeof item.updateLockVersion === "number"
                                        ? DynamoConditionExpression.eq(item.updateLockVersion)
                                        : DynamoConditionExpression.exists().not(),
                            },
                        },
                    );
                }
            });
        });
    }

    /**
     * Updates an item in the database.
     *
     * The item you provided should be a spread copy (`{...item}`) an item you just
     * read with updated properties. That way private properties enforcing
     * [optimistic locking][1] will be propagated.
     *
     * This method updates items in a way that's safe in the presence of concurrent
     * writers. If a concurrent writer makes an update after the last time you read
     * the item then this update will fail with a condition check error.
     *
     * To use this method properly you should probably wrap in a
     * `retryDynamoConditionCheckErrors()` call and you should call `getItem()`
     * inside that retry block so you get a new version of the item after a retry.
     * The `updateItem()` method handles this for you so generally prefer using
     * that method but sometimes you may need to create your own
     * `retryDynamoConditionCheckErrors()` loop. (Maybe you are executing a
     * transaction?)
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     */
    public async directlyUpdateItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<void> {
        await this._putItem(
            context,
            {
                ...item,
                // Increment the lock version in this new item.
                updateLockVersion:
                    typeof item.updateLockVersion === "number" ? item.updateLockVersion + 1 : 1,
            },
            {
                condition: {
                    // Verify that the lock version was not changed by a concurrent writer.
                    updateLockVersion:
                        typeof item.updateLockVersion === "number"
                            ? DynamoConditionExpression.eq(item.updateLockVersion)
                            : DynamoConditionExpression.exists().not(),
                },
            },
        );
    }

    /**
     * Puts an item into the database. If an item with the same key already exists
     * then we will replace that item.
     *
     * Private since it's easy to shoot yourself in the foot with this method.
     * Given it has upsert semantics and does not consider concurrent writers.
     * Instead use one of `createItem()`, `updateItem()`, `replaceItem()`, or
     * `createOrReplaceItem()` which have clearer semantics.
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
    private async _putItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): Promise<void> {
        const client = await this._getClient(context, true);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(
            item as Types["Key"],
        );

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return client.putItem(context.tracer.getTracer(), {
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

            return client.putItem(context.tracer.getTracer(), {
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
            });
        }
    }

    /**
     * Deletes an item from the database. If the item doesn't exist, we throw a
     * condition check error.
     *
     * Corresponds to the [`DeleteItem`][1] command with a condition.
     *
     * If you don't need a condition, generally you should prefer to use
     * `deleteItemIfExists()` because it is more efficient.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    public async deleteItem<Key extends Types["Key"]>(
        context: DynamoContext,
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): Promise<void> {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        await this._deleteItem(context, key, {
            condition: condition
                ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
                : itemExistsCondition,
        });
    }

    /**
     * Deletes an item from the database. If the item doesn't exist, this is a noop.
     *
     * Corresponds to the [`DeleteItem`][1] command. If you call this function many
     * times in parallel (without a condition) then we will batch the writes
     * together into a [`BatchWriteItem`][2] command.
     *
     * This method is more efficient than `deleteItem()` because it does not need a
     * [read capacity unit (RCU), it only needs a write capacity unit (WCU)][3].
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     * [3]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
     */
    public async deleteItemIfExists<Key extends Types["Key"]>(
        context: DynamoContext,
        key: Key,
    ): Promise<void> {
        await this._deleteItem(context, key);
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
    private async _deleteItem<Key extends Types["Key"]>(
        context: DynamoContext,
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): Promise<void> {
        const client = await this._getClient(context, true);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        if (condition === undefined) {
            return client.deleteItem(context.tracer.getTracer(), {
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

            return client.deleteItem(context.tracer.getTracer(), {
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
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
        context: DynamoContext,
        entries: ReadonlyArray<DynamoTransactionEntry>,
        options?: {clientRequestToken?: string},
    ): Promise<void> {
        const client = getDynamoClient(context);

        // Make sure we run `_getClient()` for all tables in the transaction. This will
        // make sure we create the table in development and will make sure we check
        // write backwards compatibility.
        await runAllPromises(
            entries.map(entry => {
                const transactItem = entry._getTransactItemForClient(DynamoClient);
                const tableName =
                    transactItem.ConditionCheck?.TableName ??
                    transactItem.Put?.TableName ??
                    transactItem.Delete?.TableName ??
                    transactItem.Update?.TableName;
                assert(tableName, "Could not find transact item table name");

                const tableSchema = allConstructedDynamoTableSchemas.get(tableName);
                assert(tableSchema, "Could not find table schema for transact item table");

                return tableSchema._getClient(context, true);
            }),
        );

        await client.executeTransaction(context.tracer.getTracer(), entries, options);
    }

    /**
     * Transaction entry for creating an item in the database. Same semantics as
     * `createItem()` but can be part of a transaction that atomically succeeds
     * or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionCreateItem<Item extends Types["Item"]>(item: Item): DynamoTransactionEntry {
        return this._transactionPutItem(item, {
            condition: DynamoConditionExpression._unsafeRaw(
                "attribute_not_exists(partitionKey)",
                DynamoConditionExpressionPrecedence.Function,
            ),
        });
    }

    /**
     * Transaction entry for replacing an item in the database. Same semantics as
     * `replaceItem()` but can be part of a transaction that atomically succeeds
     * or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionReplaceItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): DynamoTransactionEntry {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        return this._transactionPutItem(item, {
            condition: condition
                ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
                : itemExistsCondition,
        });
    }

    /**
     * Transaction entry for creating an item in the database. Same semantics as
     * `createOrReplaceItem()` but can be part of a transaction that atomically
     * succeeds or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionCreateOrReplaceItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoTransactionEntry {
        return this._transactionPutItem(item);
    }

    /**
     * Transaction entry for updating an existing item in the database. Similar
     * semantics to `updateItem()`. This method lets you perform updates within a
     * transaction alongside updates to other items and tables. Uses the same
     * [optimistic locking][1] mechanism as `updateItem()` so any calls to
     * `updateItem()` and any `transactionDirectlyUpdateItem()` should be performed
     * in sequence.
     *
     * Unlike `updateItem()`, you must wrap your transaction in
     * `retryDynamoConditionCheckErrors()` on your own! You must also make sure
     * that you read the item you are updating within that function so it may be
     * re-read when we retry.
     *
     * This method corresponds to `directlyUpdateItem()`.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoTransactionEntry {
        return this._transactionPutItem(
            {
                ...item,
                // Increment the lock version in this new item.
                updateLockVersion:
                    typeof item.updateLockVersion === "number" ? item.updateLockVersion + 1 : 1,
            },
            {
                condition: {
                    // Verify that the lock version was not changed by a concurrent writer.
                    updateLockVersion:
                        typeof item.updateLockVersion === "number"
                            ? DynamoConditionExpression.eq(item.updateLockVersion)
                            : DynamoConditionExpression.exists().not(),
                },
            },
        );
    }

    /**
     * Creates a transaction entry to put an item into the database. Same semantics
     * as `putItem()` but you can perform multiple writes in a single transaction
     * so they all succeed or fail together.
     *
     * Private since it's easy to shoot yourself in the foot with this method.
     * Given it has upsert semantics and does not consider concurrent writers.
     * Instead use one of `transactionCreateItem()`,
     * `transactionDirectlyUpdateItem()`, `transactionReplaceItem()`, or
     * `transactionCreateOrReplaceItem()` which have clearer semantics.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    private _transactionPutItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ): DynamoTransactionEntry {
        // If our schema is write incompatible with the old schema then throw an error.
        // Do not allow writing to this table until the generated schema has been
        // updated.
        if (this._writeCompatibilityError !== null) throw this._writeCompatibilityError;

        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(
            item as Types["Key"],
        );

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        if (condition === undefined) {
            return DynamoClient.transactionPutItem({
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

            return DynamoClient.transactionPutItem({
                tableName: this._config.name,
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
            });
        }
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItem()` but can be part of a transaction that atomically succeeds
     * or fails.
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
    ) {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        return this._transactionDeleteItem(key, {
            condition: condition
                ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
                : itemExistsCondition,
        });
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItemIfExists()` but can be part of a transaction that atomically
     * succeeds or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDeleteItemIfExists<Key extends Types["Key"]>(
        key: Key,
    ): DynamoTransactionEntry {
        return this._transactionDeleteItem(key);
    }

    /**
     * Creates a transaction entry to delete an item from the database. Same
     * semantics as `deleteItem()` but you can perform multiple writes in a single
     * transaction so they all succeed or fail together.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    private _transactionDeleteItem<Key extends Types["Key"]>(
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Types["Item"] & Key>;
        } = {},
    ): DynamoTransactionEntry {
        // If our schema is write incompatible with the old schema then throw an error.
        // Do not allow writing to this table until the generated schema has been
        // updated.
        if (this._writeCompatibilityError !== null) throw this._writeCompatibilityError;

        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        if (condition === undefined) {
            return DynamoClient.transactionDeleteItem({
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

            return DynamoClient.transactionDeleteItem({
                tableName: this._config.name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
            });
        }
    }

    /**
     * Creates a transaction entry that checks that an item exists and optionally
     * that an additional condition evaluates to true for the provided key. If the
     * condition fails then the entire transaction which contains this condition
     * check fails.
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
        condition?: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        const conditionExpression = condition
            ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
            : itemExistsCondition;

        const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
        const {string: conditionExpressionString} = conditionExpression.compile(
            attributesSchema,
            conditionCompilationContext,
        );

        return DynamoClient.transactionConditionCheck({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            conditionExpression: conditionExpressionString,
            expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            expressionAttributeNames: new Map(conditionCompilationContext.iterateAttributeNames()),
        });
    }

    /**
     * Creates a transaction entry that checks whether an item with the provided
     * key does not exist.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDoesNotExistConditionCheck<Key extends Types["Key"]>(
        key: Key,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const conditionExpression = DynamoConditionExpression._unsafeRaw(
            "attribute_not_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
        const {string: conditionExpressionString} = conditionExpression.compile(
            attributesSchema,
            conditionCompilationContext,
        );

        return DynamoClient.transactionConditionCheck({
            tableName: this._config.name,
            key: {partitionKey, sortKey},
            conditionExpression: conditionExpressionString,
            expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
            expressionAttributeNames: new Map(conditionCompilationContext.iterateAttributeNames()),
        });
    }

    /**
     * Update a single attribute on the item with the specified key. Is serialized
     * with all other updates of this item with `updateLockVersion`.
     *
     * You are expected to load the current `updateLockVersion` and pass it into
     * this function. Probably with `getPartialItem()`. If you pass in an incorrect
     * `updateLockVersion` there will be a condition check error. Probably what you
     * want to do is to run a `retryDynamoConditionCheckErrors()` loop that loads
     * the old version of the property and the `updateLockVersion`. Then apply an
     * update and create this transaction entry. Or you can use
     * `updateItemAttribute()` which handles the retry loop for you.
     */
    // NOTE(calebmer): Eventually this should have a suite of attribute update
    // methods. For instance, a `updateItemAttribute()` function that has a
    // retry loop similar to our `updateItem()` function I think would be a
    // good idea for one-off attribute updates.
    public transactionDirectlyUpdateItemAttribute<
        Key extends Types["Key"],
        Attribute extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        key: Key,
        attribute: Attribute,
        attributeValue: (Types["Item"] & Key)[Attribute],
        {updateLockVersion}: {updateLockVersion: number | undefined},
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const propertySchema = attributesSchema.propertySchemaByKey.get(attribute);
        if (!propertySchema)
            throw new InternalError(quote`Attribute ${attribute} not found in item schema`);

        const serializedKey = propertySchema.serializedKey ?? attribute;
        const serializedObject: {[key: string]: SchemaSerializedValue} = {};
        propertySchema.serializeProperty(serializedObject, serializedKey, attributeValue);
        const serializedValue = serializedObject[serializedKey];

        const expressionAttributeValues: {[key: string]: AttributeValue} = {};

        if (typeof updateLockVersion === "number") {
            expressionAttributeValues[":oldUpdateLockVersion"] =
                intoDynamoAttributeValue(updateLockVersion);
        }

        expressionAttributeValues[":newUpdateLockVersion"] = intoDynamoAttributeValue(
            (updateLockVersion ?? 0) + 1,
        );

        if (serializedValue !== undefined) {
            expressionAttributeValues[":value"] = intoDynamoAttributeValue(serializedValue);
        }

        return DynamoTransactionEntry._newFromClient(DynamoClient, {
            Update: {
                TableName: this._config.name,
                Key: intoDynamoAttributeValueObject({partitionKey, sortKey}),
                UpdateExpression:
                    serializedValue === undefined
                        ? `REMOVE ${serializedKey} SET updateLockVersion = :newUpdateLockVersion`
                        : `SET ${serializedKey} = :value, updateLockVersion = :newUpdateLockVersion`,
                ConditionExpression:
                    typeof updateLockVersion === "number"
                        ? "updateLockVersion = :oldUpdateLockVersion"
                        : "attribute_not_exists(updateLockVersion)",
                ExpressionAttributeValues: expressionAttributeValues,
            },
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
    public async *query<
        PartitionKey extends Types["PartitionKey"],
        StartKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        EndKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: DynamoContext,
        {
            partitionKey,
            startKey,
            endKey,
            limit,
            descending,
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            partitionKey: PartitionKey;
            startKey: StartKey;
            endKey: EndKey;
            limit?: number;
            descending?: boolean;
            consistency?: DynamoReadConsistency;
        },
    ): AsyncIterableIterator<
        MergeObjectIntersection<
            Types["Item"] &
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartKey["sortRangeType"]][EndKey["sortRangeType"]];
                }
        >
    > {
        const client = await this._getClient(context, false);
        const {partitionKey: startPartitionKey, sortKey: startSortKey} =
            this._serializeSeparatedItemKey(partitionKey, startKey);
        const {partitionKey: endPartitionKey, sortKey: endSortKey} =
            this._serializeSeparatedItemKey(partitionKey, endKey);

        if (startPartitionKey !== endPartitionKey)
            throw new InvalidArgumentError(
                "The partition key of our start key and end key should be the same",
            );

        const iterator = client.query(context.tracer.getTracer(), {
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

        for await (const serializedItem of iterator) {
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

            yield item;
        }
    }

    /**
     * Queries an entire partition in a table. Queries are how you get many
     * items from the database at once. Queries require you to carefully structure
     * your table ahead of time so that items that need to be read together are
     * physically next to each other.
     *
     * Corresponds to the [`Query`][1] command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Query.html
     */
    public async *queryEntirePartition<PartitionKey extends Types["PartitionKey"]>(
        context: DynamoContext,
        {
            partitionKey,
            limit,
            descending,
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            partitionKey: PartitionKey;
            limit?: number;
            descending?: boolean;
            consistency?: DynamoReadConsistency;
        },
    ): AsyncIterableIterator<MergeObjectIntersection<Types["Item"] & PartitionKey>> {
        const client = await this._getClient(context, false);
        const serializedPartitionKey = this._serializePartitionKey(partitionKey);

        const iterator = client.query(context.tracer.getTracer(), {
            tableName: this._config.name,
            partitionKey: {
                name: "partitionKey",
                value: serializedPartitionKey,
            },
            consistency,
            limit,
            descending,
        });

        for await (const serializedItem of iterator) {
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

            yield item;
        }
    }

    /**
     * Scans every item in the table. Since tables can get very large this function
     * is expensive! Generally you should avoid it.
     *
     * Corresponds to the [`Scan`][1] command.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
     */
    public async *expensiveScan<PartitionKey extends Types["PartitionKey"]>(
        context: DynamoContext,
        {
            limit,
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            limit?: number;
            consistency?: DynamoReadConsistency;
        } = {},
    ): AsyncIterableIterator<MergeObjectIntersection<Types["Item"] & PartitionKey>> {
        const client = await this._getClient(context, false);

        const iterator = client.expensiveScan(context.tracer.getTracer(), {
            tableName: this._config.name,
            consistency,
            limit,
        });

        for await (const serializedItem of iterator) {
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

            yield item;
        }
    }
}

const allConstructedDynamoTableSchemas = new Map<
    string,
    DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
>();

/**
 * Is the provided name the name of a `DynamoTableSchema` that has been
 * constructed?
 */
export function isConstructedDynamoTableSchemaName(name: string): boolean {
    return allConstructedDynamoTableSchemas.has(name);
}

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
    writeCompatibilityError: Error | null;
} {
    const lastDescription = dynamoGeneratedSchemaDescription.tableByName[config.name] ?? null;

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
    let writeCompatibilityError: Error | null = null;
    if (lastDescription !== null) {
        try {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(lastDescription, description);
        } catch (error) {
            throw InternalError.from(error, "Can not read from table with new schema");
        }

        try {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(description, lastDescription);
        } catch (error) {
            writeCompatibilityError = InternalError.from(
                error,
                "Can not write to table with new schema until you run `bazel run //server/dynamo:write_schema`",
            );
        }
    } else {
        writeCompatibilityError = new InternalError(
            "Can not write to table with new schema until you run `bazel run //server/dynamo:write_schema`",
        );
    }

    return {
        lastDescription,
        description,
        writeCompatibilityError,
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
