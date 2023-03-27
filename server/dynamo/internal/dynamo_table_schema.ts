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
    DynamoKeyAttributeSchema,
    dynamoKeySeparator,
} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {dynamoReservedWords} from "~/server/dynamo/internal/dynamo_reserved_words";
import {getDynamoClient} from "~/server/dynamo/internal/get_dynamo_client";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {isDynamoResourceNotFoundError} from "~/server/dynamo/internal/is_dynamo_resource_not_found_error";
import {retryDynamoConditionCheckErrors} from "~/server/dynamo/internal/retry_dynamo_condition_check_errors";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo_table_schema_types";
import {checkSchemaBackwardsCompatibility} from "~/server/schema/check_schema_backwards_compatibility";
import {
    DataLossError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order_key";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {Replace} from "~/shared/helpers/types/replace";
import {
    ObjectSchema,
    Schema,
    SchemaDeserializationError,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
} from "~/shared/schema/schema";

export type DynamoTableSchemaGetTypes<Schema extends DynamoTableSchema<any>> =
    Schema extends DynamoTableSchema<infer Types> ? Types : never;

export type DynamoTableItemKeyType<
    Schema extends DynamoTableSchema<any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    DynamoTableSchemaGetTypes<Schema>["ItemKey"] & {
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
 * The DynamoDB TTL attribute needs to be serialized as a [Unix epoch timestamp
 * measured in seconds][1].
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/time-to-live-ttl-before-you-start.html
 */
const DynamoTableItemSharedExpirationTimeAttributeSchema = Schema.integer.transform<Date>({
    serialize: date => Math.floor(date.getTime() / 1000),
    deserialize: time => new Date(time * 1000),
});

type DynamoTableSchemaInitializationState =
    | {
          readonly isInitialized: false;

          /**
           * Indexes may be added before initialization.
           */
          readonly indexDescriptions: Array<{
              overloadByName: {
                  [name: string]: DynamoTableSchemaTypes.Index.OverloadDescription;
              };
          }>;

          /**
           * Index configs for a specified item type. The item type string is in the form
           * `${partitionType}#${sortRangeType}`.
           *
           * Mutable before initialization.
           */
          readonly indexConfigsByItemType: Map<
              string,
              Array<{
                  readonly indexNumber: number;
                  readonly name: string;
                  readonly partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
                  readonly sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
              }>
          >;
      }
    | {
          readonly isInitialized: true;

          /**
           * Index configs for a specified item type. The item type string is in the form
           * `${partitionType}#${sortRangeType}`.
           *
           * Mutable during initialization.
           */
          readonly indexConfigsByItemType: ReadonlyMap<
              string,
              ReadonlyArray<{
                  readonly indexNumber: number;
                  readonly name: string;
                  readonly partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
                  readonly sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
              }>
          >;

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
           *
           * Will be null until the schema has finished initializing.
           */
          readonly description: DynamoTableSchemaTypes.Description;

          /**
           * If our new schema is read incompatible with the old schema then this will
           * be an error. We will throw the error every time you try to read from the
           * table.
           */
          readonly readCompatibilityError: Error | null;

          /**
           * If our new schema is write incompatible with the old schema then this will
           * be an error. We will throw the error every time you try to write to the
           * table.
           *
           * Once you run the command to update our generated schema this
           * compatibility error should go away.
           */
          readonly writeCompatibilityError: Error | null;
      };

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
 */
export class DynamoTableSchema<
    Types extends Replace<
        DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>,
        // This types give TypeScript trouble when dealing with generics (try removing,
        // the `new()` function should have errors). So any them out to not deal with
        // it since we know it's safe.
        {SortKeyMap: any; QueryKeyMap: any}
    >,
> {
    private readonly _name: string;

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
    private readonly _partitionConfigByName: Map<
        string,
        DynamoTableSchemaTypes.Partition.ConfigBase & {
            readonly sortRangeByName: Map<string, DynamoTableSchemaTypes.SortRange.ConfigBase>;
        }
    >;

    /**
     * Our DynamoDB table schema initializes a little after construction since we
     * need to wait for modifications from an `addIndex()` call in the same module.
     */
    private _initializationState: DynamoTableSchemaInitializationState = {
        isInitialized: false,
        indexDescriptions: [],
        indexConfigsByItemType: new Map(),
    };

    public static new<const Config extends DynamoTableSchemaTypes.ConfigBase>(
        config: Config,
    ): DynamoTableSchema<DynamoTableSchemaTypes.Types<Config>> {
        return new DynamoTableSchema(config);
    }

    private constructor(config: DynamoTableSchemaTypes.ConfigBase) {
        const partitionNames = new Set<string>();

        // Validate that attribute names are identifiers that do not start with
        // underscores and that attribute names are unique. We do not allow identifiers
        // to start with underscores so we can reserve underscore names for framework
        // properties.
        //
        // Also extends the attribute schema to include internal attributes. So when we
        // serialize/deserialize with the schema we pick up those private attributes.
        config = {
            ...config,
            partitions: config.partitions.map(
                (partitionConfig): DynamoTableSchemaTypes.Partition.ConfigBase => {
                    assert(
                        isIdentifier(partitionConfig.name),
                        "Partition name must be an identifier",
                    );
                    assert(
                        partitionConfig.name[0] === partitionConfig.name[0]?.toUpperCase(),
                        "Partition name must start with an uppercase letter",
                    );
                    assert(
                        !partitionNames.has(partitionConfig.name),
                        "Partition names must be unique within a table",
                    );
                    partitionNames.add(partitionConfig.name);

                    // Use the type system to make sure we write out all the shared attribute names.
                    const sharedAttributeNames: {
                        [K in keyof DynamoTableSchemaTypes.ItemSharedAttributes]: true;
                    } = {
                        updateLockVersion: true,
                    };

                    const partitionAttributeNames = new Set<string>([
                        "partitionType",
                        "sortRangeType",
                        "expirationTime",
                        ...Object.keys(sharedAttributeNames),
                    ]);

                    const assertValidAttributeName = (attributeName: string) => {
                        assert(isIdentifier(attributeName), "Attribute name must be an identifier");
                        assert(
                            !attributeName.startsWith("_"),
                            "Attribute name must not start with an underscore",
                        );
                        assert(
                            attributeName !== "partitionKey" && attributeName !== "sortKey",
                            "Attribute may not be a reserved key attribute name",
                        );
                        assert(
                            !/^index\d+(PartitionKey|SortKey)$/.test(attributeName),
                            "Attribute name may not be a reserved index key attribute name",
                        );
                    };

                    for (const attributeName of Object.keys(
                        partitionConfig.partitionKeyAttributes,
                    )) {
                        assertValidAttributeName(attributeName);

                        assert(
                            !partitionAttributeNames.has(attributeName),
                            "Attribute names must be unique within an item",
                        );
                        partitionAttributeNames.add(attributeName);
                    }

                    const sortRangeNames = new Set<string>();

                    return {
                        ...partitionConfig,
                        sortRanges: partitionConfig.sortRanges.map(
                            (sortRangeConfig): DynamoTableSchemaTypes.SortRange.ConfigBase => {
                                assert(
                                    isIdentifier(sortRangeConfig.name),
                                    "Sort range name must be an identifier",
                                );
                                assert(
                                    sortRangeConfig.name[0] ===
                                        sortRangeConfig.name[0]?.toUpperCase(),
                                    "Sort range name must start with an uppercase letter",
                                );
                                assert(
                                    !sortRangeNames.has(sortRangeConfig.name),
                                    "Sort range names must be unique within a partition",
                                );
                                sortRangeNames.add(sortRangeConfig.name);

                                const sortRangeAttributeNames = new Set(partitionAttributeNames);

                                for (const attributeName of Object.keys(
                                    sortRangeConfig.sortKeyAttributes,
                                )) {
                                    assertValidAttributeName(attributeName);

                                    assert(
                                        !sortRangeAttributeNames.has(attributeName),
                                        "Attribute names must be unique within an item",
                                    );
                                    sortRangeAttributeNames.add(attributeName);
                                }

                                for (const attributeName of sortRangeConfig.attributes.propertySchemaByKey.keys()) {
                                    assertValidAttributeName(attributeName);

                                    assert(
                                        !sortRangeAttributeNames.has(attributeName),
                                        "Attribute names must be unique within an item",
                                    );
                                    sortRangeAttributeNames.add(attributeName);
                                }

                                let attributesSchema = sortRangeConfig.attributes.merge(
                                    DynamoTableItemSharedAttributesSchema,
                                );

                                attributesSchema =
                                    sortRangeConfig.withExpirationTime === "Optional"
                                        ? attributesSchema.merge(
                                              Schema.object({
                                                  expirationTime:
                                                      DynamoTableItemSharedExpirationTimeAttributeSchema.optional(),
                                              }),
                                          )
                                        : sortRangeConfig.withExpirationTime === "Required"
                                        ? attributesSchema.merge(
                                              Schema.object({
                                                  expirationTime:
                                                      DynamoTableItemSharedExpirationTimeAttributeSchema,
                                              }),
                                          )
                                        : attributesSchema;

                                return {
                                    ...sortRangeConfig,
                                    attributes: attributesSchema,
                                };
                            },
                        ),
                    };
                },
            ),
        };

        this._name = config.name;

        this._partitionConfigByName = new Map(
            config.partitions.map(partitionConfig => [
                partitionConfig.name,
                {
                    ...partitionConfig,
                    sortRangeByName: new Map(
                        partitionConfig.sortRanges.map(sortRange => [sortRange.name, sortRange]),
                    ),
                },
            ]),
        );

        assert(!allConstructedDynamoTableSchemas.has(this._name), "Table names must be unique");
        allConstructedDynamoTableSchemas.set(this._name, this);

        // We need to initialize DynamoDB table schemas at the end of module
        // initialization because functions like `addIndex()` will extend the table
        // schema. So we schedule a microtask to finish initialization immediately
        // after module evaluation.
        //
        // You may call `finishInitializingAllDynamoTableSchemas()` to synchronously
        // initialize schemas.
        //
        // After initializing table schemas you may not construct any new
        // table schemas.

        assert(
            dynamoTableSchemaInitializationCallbacks !== null,
            "DynamoDB schemas have already initialized",
        );

        if (dynamoTableSchemaInitializationCallbacks.length === 0) {
            scheduleMicrotask(() => {
                if (dynamoTableSchemaInitializationCallbacks === null) return;
                const callbacks = dynamoTableSchemaInitializationCallbacks;
                dynamoTableSchemaInitializationCallbacks = null;
                for (const callback of callbacks) callback();
            });
        }

        dynamoTableSchemaInitializationCallbacks.push(() => {
            assert(!this._initializationState.isInitialized);
            const {description, readCompatibilityError, writeCompatibilityError} =
                getAndCheckDynamoTableSchemaDescriptions(
                    config,
                    this._initializationState.indexDescriptions,
                );

            this._initializationState = {
                isInitialized: true,
                indexConfigsByItemType: this._initializationState.indexConfigsByItemType,
                description: description,
                readCompatibilityError: readCompatibilityError,
                writeCompatibilityError: writeCompatibilityError,
            };
        });
    }

    public getName() {
        return this._name;
    }

    /**
     * Returns the schema description. Will throw if the schema has not
     * finished initializing. Wait a microtask for it to finish.
     */
    public getDescription() {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        // If our schema is read incompatible with the old schema then always throw an
        // error when a user tries to observe the description.
        if (this._initializationState.readCompatibilityError !== null)
            throw this._initializationState.readCompatibilityError;

        return this._initializationState.description;
    }

    private _ensureTablePromise: Promise<void> | null = null;

    private async _getClient(
        context: DynamoContext,
        checkWriteCompatibility: boolean,
    ): Promise<DynamoClient> {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        // If our schema is read incompatible with the old schema then always throw an
        // error whether we are reading or writing.
        if (this._initializationState.readCompatibilityError !== null)
            throw this._initializationState.readCompatibilityError;

        // If our schema is write incompatible with the old schema then throw an error.
        // Do not allow writing to this table until the generated schema has been
        // updated.
        if (checkWriteCompatibility && this._initializationState.writeCompatibilityError !== null)
            throw this._initializationState.writeCompatibilityError;

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
                    this._ensureTablePromise = this._ensureLocalTable(context);
                await this._ensureTablePromise;
            }
        }

        return client;
    }

    /**
     * Ensures that our table exists in DynamoDB local.
     */
    private async _ensureLocalTable(context: DynamoContext): Promise<void> {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        const client = getDynamoClient(context);
        const internalClient = client.getInternalClient();
        const tableName = this.getName();

        // Only allow creating tables in this way in local DynamoDB databases. In
        // production we should use the AWS CDK.
        assert(internalClient.isLocal());

        let doesTableExist;
        let isTimeToLiveEnabled;
        try {
            const output = await internalClient.DescribeTimeToLive(context.tracer.getTracer(), {
                TableName: tableName,
            });
            doesTableExist = true;
            isTimeToLiveEnabled = output.TimeToLiveDescription?.TimeToLiveStatus !== "DISABLED";
        } catch (error) {
            if (isDynamoResourceNotFoundError(error)) {
                doesTableExist = false;
                isTimeToLiveEnabled = false;
            } else {
                throw error;
            }
        }

        if (!doesTableExist) {
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
                    ...this._initializationState.description.indexes.flatMap(
                        (indexDescription, i) => {
                            const indexNumber = i + 1;

                            return [
                                {
                                    AttributeName: `index${indexNumber}PartitionKey`,
                                    AttributeType: "S",
                                },
                                {
                                    AttributeName: `index${indexNumber}SortKey`,
                                    AttributeType: "S",
                                },
                            ];
                        },
                    ),
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
                GlobalSecondaryIndexes:
                    this._initializationState.description.indexes.length > 0
                        ? this._initializationState.description.indexes.map(
                              (indexDescription, i) => {
                                  const indexNumber = i + 1;

                                  return {
                                      IndexName: `Index${indexNumber}`,
                                      KeySchema: [
                                          {
                                              AttributeName: `index${indexNumber}PartitionKey`,
                                              KeyType: "HASH",
                                          },
                                          {
                                              AttributeName: `index${indexNumber}SortKey`,
                                              KeyType: "RANGE",
                                          },
                                      ],
                                      Projection: {
                                          ProjectionType: "KEYS_ONLY",
                                      },
                                  };
                              },
                          )
                        : undefined,
            });
        }

        if (!isTimeToLiveEnabled) {
            await internalClient.UpdateTimeToLive(context.tracer.getTracer(), {
                TableName: tableName,
                TimeToLiveSpecification: {
                    Enabled: true,
                    AttributeName: "expirationTime",
                },
            });
        }
    }

    private _serializePartitionKey(key: Types["PartitionKey"]): string {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(key.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");

        const partitionKeyEntries = [key.partitionType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            partitionKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
        }

        return partitionKeyEntries.join(dynamoKeySeparator);
    }

    private _serializeSortKey<PartitionKey extends Types["PartitionKey"]>(
        partitionKey: PartitionKey,
        sortKey: Types["SortKeyMap"][PartitionKey["partitionType"]],
    ) {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(partitionKey.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[partitionKey.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(sortKey.sortRangeType);
        const sortRangeDescription = partitionDescription.sortRangeByType[sortKey.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        const sortKeyEntries = [sortRangeDescription.orderKey, sortKey.sortRangeType];
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            sortKeyEntries.push(attributeSchema.serialize(sortKey[attributeKey]));
        }

        return sortKeyEntries.join(dynamoKeySeparator);
    }

    private _serializeItemKey(key: Types["ItemKey"]): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(key.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(key.sortRangeType);
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
    private _deserializeItemKey(
        partitionKey: string,
        sortKey: string,
    ): {
        key: Types["ItemKey"];
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
        const partitionKeyEntries = partitionKey.split(dynamoKeySeparator);
        const sortKeyEntries = sortKey.split(dynamoKeySeparator);

        const partitionType = partitionKeyEntries[0];
        const sortRangeType = sortKeyEntries[1];
        assert(partitionType, "Invalid partition key");
        assert(sortRangeType, "Invalid sort key");

        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition key");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeType);
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
     * Serializes an item into a representation for saving to DynamoDB.
     *
     * Serializes the item's key, attributes, and adds any index attributes.
     */
    private _serializeItem<Item extends Types["Item"]>(
        item: Item,
    ): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
        serializedItem: SchemaSerializedObjectValue;
    } {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(
            item as Types["ItemKey"],
        );

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        // Serialize all the index properties for this item.
        const indexConfigs = this._initializationState.indexConfigsByItemType.get(
            `${item.partitionType}#${item.sortRangeType}`,
        );
        if (indexConfigs) {
            for (const indexConfig of indexConfigs) {
                const indexPartitionKey = serializeDynamoTableSchemaIndexPartitionKey(
                    indexConfig,
                    item,
                );
                const indexSortKey = serializeDynamoTableSchemaIndexSortKey(indexConfig, item);

                serializedItem[`index${indexConfig.indexNumber}PartitionKey`] = indexPartitionKey;
                serializedItem[`index${indexConfig.indexNumber}SortKey`] = indexSortKey;
            }
        }

        return {
            partitionKey,
            sortKey,
            attributesSchema,
            serializedItem,
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
    public async getItem<Key extends Types["ItemKey"]>(
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
            tableName: this._name,
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
     * Gets an item with the provided key and if the item does not exist then we
     * throw an error. Same as `getItem()` but throws an error instead of returning
     * null when an item is missing.
     */
    public async getItemOrThrow<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        options?: {
            consistency?: DynamoReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        const item = await this.getItem(context, key, options);

        if (!item) {
            throw new NotFoundError(
                `Item not found (partition type "${key.partitionType}", sort range type "${key.sortRangeType}")`,
            );
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
        Key extends Types["ItemKey"],
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
        const expressionAttributeNames = new Map<string, string>();
        for (const attribute of attributes) {
            const propertySchema = attributesSchema.propertySchemaByKey.get(attribute);
            if (!propertySchema)
                throw new InternalError(quote`Attribute ${attribute} not found in item schema`);

            const serializedKey = propertySchema.serializedKey ?? attribute;

            if (
                isIdentifier(serializedKey) &&
                !dynamoReservedWords.has(serializedKey.toUpperCase())
            ) {
                projectionExpressionEntries.push(serializedKey);
            } else {
                projectionExpressionEntries.push(
                    getOrSetDefaultMapValue(
                        expressionAttributeNames,
                        serializedKey,
                        () => `#n${expressionAttributeNames.size + 1}`,
                    ),
                );
            }
        }

        const serializedItem = await client.getItem(context.tracer.getTracer(), {
            tableName: this._name,
            key: {partitionKey, sortKey},
            consistency,
            projectionExpression:
                projectionExpressionEntries.length !== 0
                    ? projectionExpressionEntries.join(", ")
                    : "partitionKey",
            expressionAttributeNames: new Map(
                mapIterable(expressionAttributeNames, ([key, value]) => [value, key]),
            ),
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
     * Be careful about what you put in the `update()` function. The `update()`
     * function may run multiple times if there are conflicting updates. Avoid
     * performing writes in the `update()` function since they may throw a DynamoDB
     * condition check error which causes us to retry the update.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
     */
    public async updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key>>,
    ): Promise<void> {
        await context.tracer.withSpan("DynamoTableSchema.updateItem", async (context, span) => {
            span.addData({dynamodb: {tableName: this.getName()}});

            await retryDynamoConditionCheckErrors(async () => {
                const item = await this.getItem(context, key);

                const newItem = await update(item);

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

        const {partitionKey, sortKey, attributesSchema, serializedItem} = this._serializeItem(item);

        if (condition === undefined) {
            return client.putItem(context.tracer.getTracer(), {
                tableName: this._name,
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
                tableName: this._name,
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
    public async deleteItem<Key extends Types["ItemKey"]>(
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
    public async deleteItemIfExists<Key extends Types["ItemKey"]>(
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
    private async _deleteItem<Key extends Types["ItemKey"]>(
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
                tableName: this._name,
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
                tableName: this._name,
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
     *
     * WARNING: Carefully consider concurrent writers when using this method. If
     * two users are writing to the same item at the same time this method will
     * clobber one of the user's updates. You may want to merge the updates
     * instead. You may also clobber locks added by `updateItem()`.
     *
     * This is the most resource efficient update method! Since it does not require
     * a [read capacity unit (RCU) only a write capacity unit (WCU)][1].
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
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
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        if (this._initializationState.readCompatibilityError !== null)
            throw this._initializationState.readCompatibilityError;
        if (this._initializationState.writeCompatibilityError !== null)
            throw this._initializationState.writeCompatibilityError;

        const {attributesSchema, serializedItem} = this._serializeItem(item);

        if (condition === undefined) {
            return DynamoClient.transactionPutItem({
                tableName: this._name,
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
                tableName: this._name,
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
    public transactionDeleteItem<Key extends Types["ItemKey"]>(
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
    public transactionDeleteItemIfExists<Key extends Types["ItemKey"]>(
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
    private _transactionDeleteItem<Key extends Types["ItemKey"]>(
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
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        if (this._initializationState.readCompatibilityError !== null)
            throw this._initializationState.readCompatibilityError;
        if (this._initializationState.writeCompatibilityError !== null)
            throw this._initializationState.writeCompatibilityError;

        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        if (condition === undefined) {
            return DynamoClient.transactionDeleteItem({
                tableName: this._name,
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
                tableName: this._name,
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
    public transactionConditionCheck<Key extends Types["ItemKey"]>(
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
            tableName: this._name,
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
    public transactionDoesNotExistConditionCheck<Key extends Types["ItemKey"]>(
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
            tableName: this._name,
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
        Key extends Types["ItemKey"],
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

        // Disallow updating indexed attributes. If you update an indexed attribute
        // then we need to update the associated index attribute (e.g.
        // `indexNPartitionKey` or `indexNSortKey`). It's definitely possible to
        // implement this but we aren't for now to keep things simple.
        const indexConfigs = this._initializationState.indexConfigsByItemType.get(
            `${key.partitionType}#${key.sortRangeType}`,
        );
        if (indexConfigs) {
            for (const indexConfig of indexConfigs) {
                assert(
                    indexConfig.partitionKeyAttributes[attribute] === undefined,
                    "Can not directly update an indexed attribute",
                );
                assert(
                    indexConfig.sortKeyAttributes[attribute] === undefined,
                    "Can not directly update an indexed attribute",
                );
            }
        }

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
                TableName: this._name,
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
        StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: DynamoContext,
        {
            partitionKey,
            startSortKey,
            endSortKey,
            isStartSortKeyExclusive,
            isEndSortKeyExclusive,
            limit,
            descending,
            consistency = context.dynamo.defaultReadConsistency,
        }: {
            partitionKey: PartitionKey;
            startSortKey?: StartSortKey | undefined;
            endSortKey?: EndSortKey | undefined;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            descending?: boolean;
            consistency?: DynamoReadConsistency;
        },
    ): AsyncIterableIterator<
        MergeObjectIntersection<
            Types["Item"] &
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                }
        >
    > {
        const client = await this._getClient(context, false);

        const serializedPartitionKey = this._serializePartitionKey(partitionKey);
        const serializedStartSortKey = startSortKey
            ? this._serializeSortKey(partitionKey, startSortKey)
            : undefined;
        const serializedEndSortKey = endSortKey
            ? this._serializeSortKey(partitionKey, endSortKey)
            : undefined;

        const iterator = client.query(context.tracer.getTracer(), {
            tableName: this._name,
            partitionKey: {
                name: "partitionKey",
                value: serializedPartitionKey,
            },
            sortKey: {
                name: "sortKey",
                startValue: serializedStartSortKey,
                endValue: serializedEndSortKey,
                isStartExclusive: isStartSortKeyExclusive,
                isEndExclusive: isEndSortKeyExclusive,
            },
            consistency,
            limit: limit !== "All" ? limit : undefined,
            descending,
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            const {key, attributesSchema} = this._deserializeItemKey(
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
            tableName: this._name,
            consistency,
            limit,
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            const {key, attributesSchema} = this._deserializeItemKey(
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
     * Adds an index to the table. Indexes allow you to build different access
     * patterns for your data.
     *
     * Indexes are implemented with [DynamoDB Global Secondary Indexes][1] and we
     * [overload][2] many logical indexes into one physical index when possible.
     *
     * Some notes on the implementation:
     *
     * - Indexing is implemented by copying indexed properties into special
     *   `index{n}PartitionKey` and `index{n}SortKey` attributes (where `{n}` is
     *   the physical index number starting at 1) which are lexicographically
     *   orderable and can be overloaded.
     *
     * - You may only create indexes when you introduce a new item type. You may
     *   not add an index for an existing item type since we will have written data
     *   to the database without the special index attributes. In the future we'd
     *   like to provide a migration that backfills the index attribute so you may
     *   add indexes to existing item types.
     *
     * - You can only perform eventually consistent reads against the index. If the
     *   DynamoDB context has a strong read consistency default then we will throw
     *   an error.
     *
     * - Two indexes on different item types are considered separate logical
     *   indexes but we put them in the same physical index to save on cost. Two
     *   indexes on the same item type will be in two different physical indexes.
     *
     * - Currently we only support `KEYS_ONLY` index attribute projections for
     *   cost. An `ALL` attribute projection would replicate the items entirely
     *   doubling write costs. An `INCLUDE` attribute projection means we couldn't
     *   overload multiple logical indexes onto one physical index. We may add
     *   other options for attribute projections in the future.
     *
     * - You can index any property on an item as long as it can be serialized with
     *   a `DynamoKeyAttributeSchema`. Since `DynamoKeyAttributeSchema` supports
     *   lexicographic serializations of many data types which is important for
     *   indexing.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/GSI.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/bp-gsi-overloading.html
     */
    public addIndex<
        ItemTypes extends Types["ItemType"],
        PartitionKeyAttributes extends {
            [K in keyof (Types["Item"] & ItemTypes)]?: DynamoKeyAttributeSchema<
                (Types["Item"] & ItemTypes)[K]
            >;
        },
        SortKeyAttributes extends {
            [K in keyof (Types["Item"] & ItemTypes)]?: DynamoKeyAttributeSchema<
                (Types["Item"] & ItemTypes)[K]
            >;
        },
    >({
        name,
        itemTypes,
        partitionKeyAttributes,
        sortKeyAttributes,
    }: {
        name: string;
        itemTypes: ReadonlyArray<ItemTypes>;
        partitionKeyAttributes: PartitionKeyAttributes;
        sortKeyAttributes: SortKeyAttributes;
    }): DynamoTableSchemaIndex<
        Types["ItemKey"] & ItemTypes,
        DynamoTableSchemaTypes.KeyAttributes.Type<{
            [K in keyof PartitionKeyAttributes]: NonNullable<PartitionKeyAttributes[K]>;
        }>,
        DynamoTableSchemaTypes.KeyAttributes.Type<{
            [K in keyof SortKeyAttributes]: NonNullable<SortKeyAttributes[K]>;
        }>
    > {
        assert(
            !this._initializationState.isInitialized,
            "Can not add indexes after schema has finished initializing",
        );

        for (const indexDescription of this._initializationState.indexDescriptions) {
            for (const indexOverloadName of Object.keys(indexDescription.overloadByName)) {
                assert(name !== indexOverloadName, "Index names must be unique within a table");
            }
        }

        const itemTypeSet = new Set<string>();

        for (const {partitionType, sortRangeType} of itemTypes) {
            const partitionConfig = this._partitionConfigByName.get(partitionType);
            assert(partitionConfig, "Invalid partition");
            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeType);
            assert(sortRangeConfig, "Invalid sort range");

            const itemType = `${partitionType}#${sortRangeType}`;

            assert(!itemTypeSet.has(itemType), "Item types must be unique");
            itemTypeSet.add(itemType);

            for (const attributeKey of Object.keys(partitionKeyAttributes)) {
                assert(
                    hasOwnProperty(partitionConfig.partitionKeyAttributes, attributeKey) ||
                        hasOwnProperty(sortRangeConfig.sortKeyAttributes, attributeKey) ||
                        sortRangeConfig.attributes.propertySchemaByKey.has(attributeKey),
                    quote`Attribute ${attributeKey} does not exist in sort range ${sortRangeType} of partition ${partitionType}`,
                );
            }

            for (const attributeKey of Object.keys(sortKeyAttributes)) {
                assert(
                    hasOwnProperty(partitionConfig.partitionKeyAttributes, attributeKey) ||
                        hasOwnProperty(sortRangeConfig.sortKeyAttributes, attributeKey) ||
                        sortRangeConfig.attributes.propertySchemaByKey.has(attributeKey),
                    quote`Attribute ${attributeKey} does not exist in sort range ${sortRangeType} of partition ${partitionType}`,
                );
            }
        }

        const indexOverloadDescription: DynamoTableSchemaTypes.Index.OverloadDescription = {
            itemTypes,
            partitionKeyAttributeByKey: mapObjectValues(
                partitionKeyAttributes,
                keyAttribute => keyAttribute!.description,
            ),
            sortKeyAttributeByKey: mapObjectValues(
                sortKeyAttributes,
                keyAttribute => keyAttribute!.description,
            ),
        };

        let addedToIndexNumber: number | null = null;

        // We can add our logical index to an existing physical index if the physical
        // index doesn't have an overload which conflicts with the item types in
        // this index.
        for (const [
            i,
            targetIndexDescription,
        ] of this._initializationState.indexDescriptions.entries()) {
            const targetIndexNumber = i + 1;
            const targetItemTypeSet = new Set<string>();

            for (const targetIndexOverloadDescription of Object.values(
                targetIndexDescription.overloadByName,
            )) {
                for (const {
                    partitionType,
                    sortRangeType,
                } of targetIndexOverloadDescription.itemTypes) {
                    targetItemTypeSet.add(`${partitionType}#${sortRangeType}`);
                }
            }

            if (iterableEvery(itemTypeSet, itemType => !targetItemTypeSet.has(itemType))) {
                targetIndexDescription.overloadByName[name] = indexOverloadDescription;
                addedToIndexNumber = targetIndexNumber;
                break;
            }
        }

        // Create a new physical index if we couldn't overload an existing
        // physical index.
        if (addedToIndexNumber === null) {
            addedToIndexNumber = this._initializationState.indexDescriptions.length + 1;
            this._initializationState.indexDescriptions.push({
                overloadByName: {[name]: indexOverloadDescription},
            });
        }

        const indexConfig = {
            indexNumber: addedToIndexNumber,
            name,
            partitionKeyAttributes:
                partitionKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
            sortKeyAttributes: sortKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
        };

        // Store the attributes for the item types in this index so we can easily
        // serialize those items in the future.
        for (const itemType of itemTypeSet) {
            getOrSetDefaultMapValue(
                this._initializationState.indexConfigsByItemType,
                itemType,
                () => [],
            ).push(indexConfig);
        }

        const schema = this;

        return {
            async *query(
                context,
                {
                    partitionKey,
                    startSortKey,
                    endSortKey,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    limit,
                    descending,
                },
            ) {
                // Error if trying to a query an index with strong consistency. You must design
                // your code assuming eventually consistent reads when querying an index.
                if (context.dynamo.defaultReadConsistency !== "Eventual")
                    throw new InternalError(
                        "Dynamo only supports eventually consistent queries on indexes",
                    );

                const client = await schema._getClient(context, false);
                const serializedPartitionKey = serializeDynamoTableSchemaIndexPartitionKey(
                    indexConfig,
                    partitionKey,
                );
                const serializedStartSortKey = startSortKey
                    ? serializeDynamoTableSchemaIndexSortKey(indexConfig, startSortKey)
                    : undefined;
                const serializedEndSortKey = endSortKey
                    ? serializeDynamoTableSchemaIndexSortKey(indexConfig, endSortKey)
                    : undefined;

                const partitionKeyAttributeName = `index${indexConfig.indexNumber}PartitionKey`;
                const sortKeyAttributeName = `index${indexConfig.indexNumber}SortKey`;

                const iterator = client.query(context.tracer.getTracer(), {
                    tableName: schema._name,
                    indexName: `Index${indexConfig.indexNumber}`,
                    partitionKey: {
                        name: partitionKeyAttributeName,
                        value: serializedPartitionKey,
                    },
                    sortKey: {
                        name: sortKeyAttributeName,
                        startValue: serializedStartSortKey,
                        endValue: serializedEndSortKey,
                        isStartExclusive: isStartSortKeyExclusive,
                        isEndExclusive: isEndSortKeyExclusive,
                    },
                    consistency: "Eventual",
                    limit: limit !== "All" ? limit : undefined,
                    descending,
                });

                for await (const serializedItem of iterator) {
                    assert(typeof serializedItem.partitionKey === "string");
                    assert(typeof serializedItem.sortKey === "string");

                    const indexPartitionKey = serializedItem[partitionKeyAttributeName];
                    const indexSortKey = serializedItem[sortKeyAttributeName];
                    assert(typeof indexPartitionKey === "string");
                    assert(typeof indexSortKey === "string");

                    const item: any = {
                        ...schema._deserializeItemKey(
                            serializedItem.partitionKey,
                            serializedItem.sortKey,
                        ).key,
                        ...deserializeDynamoTableSchemaIndexKey(
                            indexConfig,
                            indexPartitionKey,
                            indexSortKey,
                        ),
                    };

                    yield item;
                }
            },
        };
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

let dynamoTableSchemaInitializationCallbacks: Array<() => void> | null = [];

/**
 * Finish initializing all our `DynamoTableSchema`s immediately instead of
 * waiting for a microtask callback.
 */
export function finishInitializingAllDynamoTableSchemas() {
    assert(
        dynamoTableSchemaInitializationCallbacks !== null,
        "DynamoDB schemas already initialized",
    );
    const callbacks = dynamoTableSchemaInitializationCallbacks;
    dynamoTableSchemaInitializationCallbacks = null;
    for (const callback of callbacks) callback();
}

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface DynamoTableSchemaIndex<ItemKey, IndexPartitionKey, IndexSortKey> {
    query(
        context: DynamoContext,
        options: {
            partitionKey: IndexPartitionKey;
            startSortKey?: IndexSortKey;
            endSortKey?: IndexSortKey;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            descending?: boolean;
        },
    ): AsyncIterableIterator<MergeObjectIntersection<ItemKey & IndexPartitionKey & IndexSortKey>>;
}

function serializeDynamoTableSchemaIndexPartitionKey(
    indexConfig: {
        name: string;
        partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
        sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
    },
    item: {[key: string]: unknown},
) {
    const indexPartitionKeyEntries = [indexConfig.name];
    for (const [attributeKey, attributeSchema] of Object.entries(
        indexConfig.partitionKeyAttributes,
    )) {
        const attributeValue = item[attributeKey];
        indexPartitionKeyEntries.push(attributeSchema.serialize(attributeValue));
    }

    return indexPartitionKeyEntries.join(dynamoKeySeparator);
}

function serializeDynamoTableSchemaIndexSortKey(
    indexConfig: {
        name: string;
        partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
        sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
    },
    item: {[key: string]: unknown},
) {
    const itemSortKeyEntries = [];
    for (const [attributeKey, attributeSchema] of Object.entries(indexConfig.sortKeyAttributes)) {
        const attributeValue = item[attributeKey];
        itemSortKeyEntries.push(attributeSchema.serialize(attributeValue));
    }

    return itemSortKeyEntries.join(dynamoKeySeparator);
}

function deserializeDynamoTableSchemaIndexKey(
    indexConfig: {
        name: string;
        partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
        sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
    },
    partitionKey: string,
    sortKey: string,
) {
    const partitionKeyEntries = partitionKey.split(dynamoKeySeparator);
    const sortKeyEntries = sortKey.split(dynamoKeySeparator);

    const indexName = partitionKeyEntries[0];
    assert(indexName === indexConfig.name, "Invalid index partition key");

    const key: any = {};

    let partitionKeyEntryIndex = 1;
    for (const [attributeKey, attributeSchema] of Object.entries(
        indexConfig.partitionKeyAttributes,
    )) {
        const partitionKeyEntry = partitionKeyEntries[partitionKeyEntryIndex++];
        assert(partitionKeyEntry !== undefined, "Invalid index partition key");
        key[attributeKey] = attributeSchema.deserialize(partitionKeyEntry as DynamoKeyAttribute);
    }

    let sortKeyEntryIndex = 0;
    for (const [attributeKey, attributeSchema] of Object.entries(indexConfig.sortKeyAttributes)) {
        const sortKeyEntry = sortKeyEntries[sortKeyEntryIndex++];
        assert(sortKeyEntry !== undefined, "Invalid index sort key");
        key[attributeKey] = attributeSchema.deserialize(sortKeyEntry as DynamoKeyAttribute);
    }

    return key;
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
function getAndCheckDynamoTableSchemaDescriptions(
    config: DynamoTableSchemaTypes.ConfigBase,
    indexDescriptions: ReadonlyArray<DynamoTableSchemaTypes.Index.Description>,
): {
    lastDescription: DynamoTableSchemaTypes.Description | null;
    description: DynamoTableSchemaTypes.Description;
    readCompatibilityError: Error | null;
    writeCompatibilityError: Error | null;
} {
    const lastDescription = dynamoGeneratedSchemaDescription.tableByName[config.name] ?? null;

    const description: DynamoTableSchemaTypes.Description = {
        name: config.name,
        partitionByType: Object.fromEntries(
            config.partitions.map(partitionConfig => {
                // Iterate through all our sort ranges, in order, finding contiguous subsets of
                // the list which do not have an `OrderKey` in the last description. For these
                // sort ranges generate new `OrderKey`s for our new description.
                const sortRangeOrderKeyByType = new Map<string, OrderKey>();
                let lastExistingSortRangeOrderKey: OrderKey | null = null;
                let sortRangeTypesWithoutExistingOrderKey = [];

                for (const sortRangeConfig of partitionConfig.sortRanges) {
                    const existingSortRangeOrderKey =
                        lastDescription?.partitionByType[partitionConfig.name]?.sortRangeByType[
                            sortRangeConfig.name
                        ]?.orderKey;

                    if (!existingSortRangeOrderKey) {
                        sortRangeTypesWithoutExistingOrderKey.push(sortRangeConfig.name);
                    } else {
                        // The order of `sortRanges` in our config object matters! It must be the same
                        // as the order key order. Throw an error if we detect the developer may have
                        // moved things around. That's a backwards incompatible change.
                        if (
                            lastExistingSortRangeOrderKey !== null &&
                            lastExistingSortRangeOrderKey >= existingSortRangeOrderKey
                        ) {
                            throw new InvalidArgumentError(
                                `Order key for sort range \`${sortRangeConfig.name}\` is less than a previous sort range order key. Did you reorder your sort range object?`,
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
                        sortRangeOrderKeyByType.set(
                            sortRangeConfig.name,
                            existingSortRangeOrderKey,
                        );
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

                const partitionDescription: DynamoTableSchemaTypes.Partition.Description = {
                    partitionKeyAttributeByKey: mapObjectValues(
                        partitionConfig.partitionKeyAttributes,
                        keyAttribute => keyAttribute.description,
                    ),
                    sortRangeByType: Object.fromEntries(
                        partitionConfig.sortRanges.map(sortRangeConfig => {
                            const sortRangeDescription: DynamoTableSchemaTypes.SortRange.Description =
                                {
                                    orderKey: sortRangeOrderKeyByType.get(sortRangeConfig.name)!,
                                    sortKeyAttributeByKey: mapObjectValues(
                                        sortRangeConfig.sortKeyAttributes,
                                        keyAttribute => keyAttribute.description,
                                    ),
                                    attributesSchema: sortRangeConfig.attributes.getDescription(),
                                };

                            return [sortRangeConfig.name, sortRangeDescription];
                        }),
                    ),
                };

                return [partitionConfig.name, partitionDescription];
            }),
        ),
        indexes: indexDescriptions,
    };

    // If we have a description saved, then verify our new description is backwards
    // compatible with the old description. We will save our new description the
    // first time an item is written to this table.
    let readCompatibilityError: Error | null = null;
    let writeCompatibilityError: Error | null = null;

    // Skip backwards compatibility checking in production for performance. Tests
    // should have already validated that our DynamoDB table schema is backwards
    // compatible.
    //
    // TODO(calebmer): Only doing this because Cloudflare Workers has strict
    // startup time limits. The plan is to eventually move this code into a Node.js
    // service in AWS. At that point we should re-enable backwards compatibility
    // checking in production since it's not that expensive. Or we should do
    // backwards compatibility checking lazily.
    if (process.env.NODE_ENV !== "production") {
        if (lastDescription !== null) {
            try {
                checkDynamoTableSchemaDescriptionBackwardsCompatibility(
                    lastDescription,
                    description,
                );
            } catch (error) {
                readCompatibilityError = InternalError.from(
                    error,
                    "Can not read from table with new schema",
                );
            }

            try {
                checkDynamoTableSchemaDescriptionBackwardsCompatibility(
                    description,
                    lastDescription,
                );
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
    }

    return {
        lastDescription,
        description,
        readCompatibilityError,
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
            checkDynamoTableSchemaPartitionDescriptionBackwardsCompatibility(
                partitionType,
                lastDescription.partitionByType[partitionType]!,
                nextPartitionSchemaDescription,
            );
        }
    }

    for (const partitionName of missingPartitionTypes)
        throw new InvalidArgumentError(`Partition \`${partitionName}\` is missing`);

    for (let i = 0; i < nextDescription.indexes.length; i++) {
        const number = i + 1;
        const nextIndexDescription = nextDescription.indexes[i]!;

        if (i >= lastDescription.indexes.length)
            throw new InvalidArgumentError(`Index number ${number} is missing`);

        const lastIndexDescription = lastDescription.indexes[i]!;

        checkDynamoTableSchemaIndexDescriptionBackwardsCompatibility(
            number,
            nextIndexDescription,
            lastIndexDescription,
        );
    }
}

function checkDynamoTableSchemaPartitionDescriptionBackwardsCompatibility(
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
            checkDynamoTableSchemaSortRangeDescriptionBackwardsCompatibility(
                sortRangeType,
                lastDescription.sortRangeByType[sortRangeType]!,
                nextSortRangeSchemaDescription,
            );
        }
    }

    for (const sortRange of missingSortRangeTypes)
        throw new InvalidArgumentError(`Sort range \`${sortRange}\` is missing`);
}

function checkDynamoTableSchemaSortRangeDescriptionBackwardsCompatibility(
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

function checkDynamoTableSchemaIndexDescriptionBackwardsCompatibility(
    number: number,
    lastDescription: DynamoTableSchemaTypes.Index.Description,
    nextDescription: DynamoTableSchemaTypes.Index.Description,
): void {
    const missingOverloadNames = new Set(Object.keys(lastDescription.overloadByName));

    for (const [overloadName, nextOverloadDescription] of Object.entries(
        nextDescription.overloadByName,
    )) {
        if (missingOverloadNames.delete(overloadName)) {
            checkDynamoTableSchemaIndexOverloadDescriptionBackwardsCompatibility(
                overloadName,
                lastDescription.overloadByName[overloadName]!,
                nextOverloadDescription,
            );
        }
    }

    for (const overloadName of missingOverloadNames)
        throw new InvalidArgumentError(`Index overload \`${overloadName}\` is missing`);
}

function checkDynamoTableSchemaIndexOverloadDescriptionBackwardsCompatibility(
    name: string,
    lastDescription: DynamoTableSchemaTypes.Index.OverloadDescription,
    nextDescription: DynamoTableSchemaTypes.Index.OverloadDescription,
): void {
    const lastPartitionKeyAttributeDescriptions = Object.values(
        lastDescription.partitionKeyAttributeByKey,
    );
    const nextPartitionKeyAttributeDescriptions = Object.values(
        nextDescription.partitionKeyAttributeByKey,
    );

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastPartitionKeyAttributeDescriptions, nextPartitionKeyAttributeDescriptions))
        throw new InvalidArgumentError(`Incompatible partition key for index overload \`${name}\``);

    const lastSortKeyAttributeDescriptions = Object.values(lastDescription.sortKeyAttributeByKey);
    const nextSortKeyAttributeDescriptions = Object.values(nextDescription.sortKeyAttributeByKey);

    // Require partition key to always be exactly what was initially configured. No
    // migrations!
    if (!isDeepEqual(lastSortKeyAttributeDescriptions, nextSortKeyAttributeDescriptions))
        throw new InvalidArgumentError(`Incompatible sort key for index overload \`${name}\``);
}
