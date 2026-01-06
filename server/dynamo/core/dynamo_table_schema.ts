import {AttributeValue} from "@aws-sdk/client-dynamodb";
import fs from "fs/promises";
import murmurhash from "murmurhash";
import {dirname, join as joinPath} from "path";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {
    DynamoKeyAttribute,
    DynamoKeyAttributeSchema,
    dynamoKeySeparator,
} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {
    intoDynamoAttributeValue,
    intoDynamoAttributeValueObject,
} from "~/server/dynamo/core/internal/dynamo_attribute_value.js";
import {DynamoClient} from "~/server/dynamo/core/internal/dynamo_client.js";
import {
    DynamoCondition,
    DynamoConditionExpression,
    DynamoConditionExpressionCompilationContext,
    DynamoConditionExpressionPrecedence,
} from "~/server/dynamo/core/internal/dynamo_condition.js";
import {dynamoGeneratedSchemaDescription} from "~/server/dynamo/core/internal/dynamo_generated_schema_description.js";
import {dynamoReservedWords} from "~/server/dynamo/core/internal/dynamo_reserved_words.js";
import {
    getDynamoClient,
    getDynamoExpectsStrongReadConsistency,
    getDynamoRetryTransactionIfExists,
} from "~/server/dynamo/core/internal/get_dynamo_client.js";
import {DynamoTableSchemaTypes} from "~/server/dynamo/core/internal/types/dynamo_table_schema_types.js";
import {isDynamoConditionCheckError} from "~/server/dynamo/core/is_dynamo_condition_check_error.js";
import {isDynamoResourceInUseError} from "~/server/dynamo/core/is_dynamo_resource_in_use_exception.js";
import {isDynamoResourceNotFoundError} from "~/server/dynamo/core/is_dynamo_resource_not_found_error.js";
import {isDynamoValidationError} from "~/server/dynamo/core/is_dynamo_validation_exception.js";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
    DynamoItemPartitionKey,
    DynamoItemSortKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    DataLossError,
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {OrderKey, generateOrderKeysBetween} from "~/shared/helpers/sort/order_key.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {PartialBy} from "~/shared/helpers/types/partial_by.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {checkSchemaBackwardsCompatibility} from "~/shared/schema/check_schema_backwards_compatibility.js";
import {
    ObjectSchema,
    Schema,
    SchemaDeserializationError,
    SchemaSerializedObjectValue,
    SchemaSerializedValue,
    objectSchemaMissingPropertySymbol,
} from "~/shared/schema/schema.js";

// Never actually used at runtime. Only used by the type system.
declare const typesSymbol: unique symbol;

export type DynamoTableSchemaGetTypes<Schema extends DynamoTableSchema<any>> =
    Schema[typeof typesSymbol];

export type DynamoTableItemKeyType<
    Schema extends DynamoTableSchema<any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    Extract<
        DynamoTableSchemaGetTypes<Schema>["ItemKey"],
        {
            readonly partitionType: PartitionType;
            readonly sortRangeType: SortRangeType;
        }
    >
>;

export type DynamoTableItemType<
    Schema extends DynamoTableSchema<any>,
    PartitionType extends string,
    SortRangeType extends string,
> = Extract<
    DynamoTableSchemaGetTypes<Schema>["Item"],
    {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

export type DynamoTableIndexItemType<Schema extends DynamoTableSchemaIndex<any, any, any, any>> =
    Schema extends DynamoTableSchemaIndex<
        infer QueryItem,
        any,
        infer IndexPartitionKey,
        infer IndexSortKey
    >
        ? Extract<QueryItem, IndexPartitionKey & IndexSortKey>
        : never;

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

type DynamoTableSchemaIndexConfig = {
    readonly indexNumber: number;
    readonly name: string;
    readonly partitionKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
    readonly sortKeyAttributes: DynamoTableSchemaTypes.KeyAttributes.ConfigBase;
    readonly includePrimaryKeyInSortKey: boolean;
    readonly projection: "KeysOnly" | "All";
    readonly filter: ((item: any) => boolean) | null;
};

type DynamoTableSchemaInitializationState =
    | {
          readonly isInitialized: false;

          /**
           * Indexes may be added before initialization.
           */
          readonly indexDescriptions: Array<{
              readonly projection: "KeysOnly" | "All";
              readonly overloadByName: {
                  [name: string]: DynamoTableSchemaTypes.Index.OverloadDescription & {
                      readonly canReusePartitionKey: boolean;
                  };
              };
          }>;

          /**
           * Index configs for a specified item type. The item type string is in the form
           * `${partitionType}#${sortRangeType}`.
           *
           * Mutable before initialization.
           */
          readonly indexConfigsByItemType: Map<string, Array<DynamoTableSchemaIndexConfig>>;
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
              ReadonlyArray<DynamoTableSchemaIndexConfig>
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

          /**
           * Names for a partition and its sort ranges by their integer ID.
           */
          readonly partitionNamesById: Map<
              number,
              {
                  readonly partitionName: string;
                  readonly sortRangeNameById: Map<number, string>;
              }
          >;
      };

export type DynamoTableSchemaTypesBase = Replace<
    DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>,
    // This types give TypeScript trouble when dealing with generics (try removing,
    // `accounts_table.ts` should have errors). So any them out to not deal with
    // it since we know it's safe.
    {QueryKeyMap: any}
>;

// Used specifically for testing to allow us to re-check if tables exist in a local DynamoDB instance.
// As long as this value stays the same, we only check if a table exists (and create it if not) the
// first time a call is made to a DynamoTableSchema instance; any subsequent calls skip the check.
// You probably don't need to increment this value manually if you are resetting the local DynamoDB
// instance as `resetDynamoLocal()` will increment it for you.
let localDynamoTableSchemaGeneration = 1;

export function incrementLocalDynamoTableSchemaGenerationForTest() {
    assert(import.meta.jest, "Can only increment local table generation in tests");
    localDynamoTableSchemaGeneration++;
}

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
export class DynamoTableSchema<Types extends DynamoTableSchemaTypesBase> {
    public declare readonly [typesSymbol]: Types;

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
            readonly sortRangeByName: Map<
                string,
                DynamoTableSchemaTypes.SortRange.ConfigBase & {
                    readonly index: number;
                    readonly childSortRangeByName: Map<
                        string,
                        DynamoTableSchemaTypes.SortRange.ChildConfigBase & {
                            readonly index: number;
                        }
                    >;
                }
            >;
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

                    function processAttributesSchema(
                        sortRangeConfig: DynamoTableSchemaTypes.SortRange.ChildConfigBase,
                    ): ObjectSchema<any> {
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
                                `Attribute names must be unique within an item`,
                            );
                            sortRangeAttributeNames.add(attributeName);
                        }

                        let attributesSchema: ObjectSchema<any> = sortRangeConfig.attributes.merge(
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
                                : sortRangeConfig.withExpirationTime === "RequiredNullable"
                                ? attributesSchema.merge(
                                      Schema.object({
                                          expirationTime:
                                              DynamoTableItemSharedExpirationTimeAttributeSchema.nullable(),
                                      }),
                                  )
                                : attributesSchema;

                        return attributesSchema;
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

                                const childSortRangeNames = new Set<string>();

                                return {
                                    ...sortRangeConfig,
                                    attributes: processAttributesSchema(sortRangeConfig),
                                    childSortRanges: sortRangeConfig.childSortRanges?.map(
                                        childSortRangeConfig => {
                                            assert(
                                                isIdentifier(childSortRangeConfig.name),
                                                "Child sort range name must be an identifier",
                                            );
                                            assert(
                                                childSortRangeConfig.name[0] ===
                                                    childSortRangeConfig.name[0]?.toUpperCase(),
                                                "Child sort range name must start with an uppercase letter",
                                            );
                                            assert(
                                                !childSortRangeNames.has(childSortRangeConfig.name),
                                                "Child sort range names must be unique within a sort range",
                                            );
                                            childSortRangeNames.add(childSortRangeConfig.name);

                                            return {
                                                ...childSortRangeConfig,
                                                attributes:
                                                    processAttributesSchema(childSortRangeConfig),
                                            };
                                        },
                                    ),
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
                Object.assign(partitionConfig, {
                    sortRangeByName: new Map(
                        partitionConfig.sortRanges.map((sortRange, index) => [
                            sortRange.name,
                            Object.assign(sortRange, {
                                index,
                                childSortRangeByName: new Map(
                                    (sortRange.childSortRanges ?? []).map(
                                        (childSortRange, index) => [
                                            childSortRange.name,
                                            Object.assign(childSortRange, {index}),
                                        ],
                                    ),
                                ),
                            }),
                        ]),
                    ),
                }),
            ]),
        );

        constructedDynamoTableSchemaCount++;
        if (recording) {
            assert(
                !recording.tableSchemas.has(this._name),
                "Table names in recording must be unique",
            );
            recording.tableSchemas.set(this._name, this);
        }

        // DynamoDB table schemas finish initializing a microtask after they're
        // constructed because functions like `addIndex()` will extend the table
        // schema.
        //
        // You may call `finishInitializingDynamoTableSchemas()` to synchronously
        // finish initializing schemas.

        if (dynamoTableSchemaInitializationCallbacks.length === 0) {
            scheduleMicrotask(() => {
                const callbacks = dynamoTableSchemaInitializationCallbacks;
                dynamoTableSchemaInitializationCallbacks = [];
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

            const partitionNamesById = new Map<
                number,
                {partitionName: string; sortRangeNameById: Map<number, string>}
            >();

            for (const [partitionName, partitionDescription] of Object.entries(
                description.partitionByType,
            )) {
                const sortRangeNameById = new Map<number, string>();

                for (const [sortRangeName, sortRangeDescription] of Object.entries(
                    partitionDescription.sortRangeByType,
                )) {
                    sortRangeNameById.set(sortRangeDescription.id, sortRangeName);
                }

                partitionNamesById.set(partitionDescription.id, {
                    partitionName,
                    sortRangeNameById,
                });
            }

            // The developer may disable compatibility errors in tests in order to unit
            // test functionality in `DynamoTableSchema` itself.
            let withoutCompatibilityErrors = false;
            if (config.withoutCompatibilityErrorsForTest) {
                assert(import.meta.jest);
                assert(config.name === "Test" || config.name.startsWith("Test_"));
                withoutCompatibilityErrors = true;
            }

            this._initializationState = {
                isInitialized: true,
                indexConfigsByItemType: this._initializationState.indexConfigsByItemType,
                description: description,
                readCompatibilityError: !withoutCompatibilityErrors ? readCompatibilityError : null,
                writeCompatibilityError: !withoutCompatibilityErrors
                    ? writeCompatibilityError
                    : null,
                partitionNamesById,
            };
        });
    }

    public getName() {
        return this._name;
    }

    public isInitialized() {
        return this._initializationState.isInitialized;
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

    /**
     * Return the partition key attributes for a given partition. Throws an error
     * if the partition doesn't exist.
     */
    public getPartitionKeyAttributes(partitionType: string) {
        return assertExists(this._partitionConfigByName.get(partitionType)).partitionKeyAttributes;
    }

    /**
     * Return the partition key attributes and sort key attributes for a given
     * partition. Throws an error if the partition or sort range doesn't exist.
     */
    public getKeyAttributes(partitionType: string, sortRangeType: string) {
        const partitionConfig = assertExists(this._partitionConfigByName.get(partitionType));

        return {
            partitionKeyAttributes: partitionConfig.partitionKeyAttributes,
            sortKeyAttributes: assertExists(partitionConfig.sortRangeByName.get(sortRangeType))
                .sortKeyAttributes,
        };
    }

    private _ensureLocalTablePromise: Promise<void> | null = null;
    private _ensureLocalTableGeneration: number = 0;

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
                if (
                    !this._ensureLocalTablePromise ||
                    this._ensureLocalTableGeneration !== localDynamoTableSchemaGeneration
                ) {
                    this._ensureLocalTableGeneration = localDynamoTableSchemaGeneration;
                    this._ensureLocalTablePromise = this._ensureLocalTable(context);
                }
                await this._ensureLocalTablePromise;
            }
        }

        return client;
    }

    /**
     * Called before executing a transaction. In development we need to make sure:
     *
     * 1. There are no write compatibility errors
     * 2. The table exists
     *
     * Before we can execute a transaction.
     */
    private _handleBeforeExecuteTransaction: ((context: DynamoContext) => Promise<void>) | null =
        process.env.NODE_ENV !== "production"
            ? async (context: DynamoContext) => {
                  await this._getClient(context, true);
              }
            : null;

    /**
     * Ensures that our table exists in DynamoDB local.
     */
    private async _ensureLocalTable(context: DynamoContext): Promise<void> {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const {description} = this._initializationState;

        const client = getDynamoClient(context);

        // We skip checking the cache in tests since we actually want to recheck if the table exists
        // if dynamo has been restarted.
        const shouldUseCache = !import.meta.jest;

        let ensureLocalCacheHash: string;
        let ensureLocalCachePath: string;

        if (shouldUseCache) {
            ensureLocalCachePath = joinPath(
                assertExists(
                    client.ensureLocalCachePath,
                    "Must have `ensureLocalCachePath` when running DynamoDB locally",
                ),
                `${this._name}.txt`,
            );

            ensureLocalCacheHash = murmurhash
                .v3(JSON.stringify([description.name, description.indexes.length]))
                .toString(16)
                .padStart(8, "0");
            try {
                if (
                    (await fs.readFile(ensureLocalCachePath, "utf8")).trim() ===
                    ensureLocalCacheHash
                ) {
                    return;
                }
            } catch (error) {
                if (isObject(error) && error.code === "ENOENT") {
                    // If the file doesn't exist, that's ok ensure the table...
                } else {
                    throw error;
                }
            }
        }

        return context.tracer.withSpan("Ensure local DynamoDB table", async context => {
            await retryWithExponentialBackoff(async retry => {
                const internalClient = client.getInternalClient();
                const tableName = this.getName();

                // Only allow creating tables in this way in local DynamoDB databases. In
                // production we should use the AWS CDK.
                assert(internalClient.isLocal());

                let doesTableExist: boolean;
                let existingIndexNames: Set<string>;
                let isTimeToLiveEnabled: boolean;
                try {
                    const [output, timeToLiveOutput] = await runAllPromises([
                        internalClient.DescribeTable(context.tracer.getTracer(), {
                            TableName: tableName,
                        }),
                        internalClient.DescribeTimeToLive(context.tracer.getTracer(), {
                            TableName: tableName,
                        }),
                    ]);

                    doesTableExist = true;
                    existingIndexNames = new Set(
                        output.Table?.GlobalSecondaryIndexes?.map(
                            indexOutput => indexOutput.IndexName ?? "",
                        ),
                    );
                    isTimeToLiveEnabled =
                        timeToLiveOutput.TimeToLiveDescription?.TimeToLiveStatus !== "DISABLED";
                } catch (error) {
                    if (
                        isDynamoResourceNotFoundError(error) ||
                        (error instanceof AggregateError &&
                            isDynamoResourceNotFoundError(error.errors[0]))
                    ) {
                        doesTableExist = false;
                        existingIndexNames = new Set();
                        isTimeToLiveEnabled = false;
                    } else {
                        throw error;
                    }
                }

                const attributeDefinitions = [
                    {
                        AttributeName: "partitionKey",
                        AttributeType: "S" as const,
                    },
                    {
                        AttributeName: "sortKey",
                        AttributeType: "S" as const,
                    },
                    ...description.indexes.flatMap((indexDescription, i) => {
                        const indexNumber = i + 1;

                        return [
                            ...(indexDescription.partitionKeyBehavior.type === "Reused"
                                ? []
                                : [
                                      {
                                          AttributeName: `index${indexNumber}PartitionKey`,
                                          AttributeType: "S" as const,
                                      },
                                  ]),
                            {
                                AttributeName: `index${indexNumber}SortKey`,
                                AttributeType: "S" as const,
                            },
                        ];
                    }),
                ];

                if (!doesTableExist) {
                    try {
                        await internalClient.CreateTable(context.tracer.getTracer(), {
                            TableName: tableName,
                            AttributeDefinitions: attributeDefinitions,
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
                                description.indexes.length > 0
                                    ? description.indexes.map((indexDescription, i) => {
                                          const indexNumber = i + 1;

                                          return {
                                              IndexName: `Index${indexNumber}`,
                                              KeySchema: [
                                                  {
                                                      AttributeName:
                                                          indexDescription.partitionKeyBehavior
                                                              .type === "Reused"
                                                              ? "partitionKey"
                                                              : `index${indexNumber}PartitionKey`,
                                                      KeyType: "HASH",
                                                  },
                                                  {
                                                      AttributeName: `index${indexNumber}SortKey`,
                                                      KeyType: "RANGE",
                                                  },
                                              ],
                                              Projection: {
                                                  ProjectionType: {
                                                      KeysOnly: "KEYS_ONLY" as const,
                                                      All: "ALL" as const,
                                                  }[indexDescription.projection],
                                              },
                                          };
                                      })
                                    : undefined,
                        });
                    } catch (error) {
                        // A concurrent process may be racing to create this table. Try again...
                        if (isDynamoResourceInUseError(error)) {
                            retry(error);
                        } else {
                            throw error;
                        }
                    }
                } else {
                    try {
                        const createIndexUpdates = filterMapArray(
                            description.indexes,
                            (indexDescription, i) => {
                                const indexNumber = i + 1;

                                if (existingIndexNames.has(`Index${indexNumber}`)) return;

                                return {
                                    Create: {
                                        IndexName: `Index${indexNumber}`,
                                        KeySchema: [
                                            {
                                                AttributeName:
                                                    indexDescription.partitionKeyBehavior.type ===
                                                    "Reused"
                                                        ? "partitionKey"
                                                        : `index${indexNumber}PartitionKey`,
                                                KeyType: "HASH" as const,
                                            },
                                            {
                                                AttributeName: `index${indexNumber}SortKey`,
                                                KeyType: "RANGE" as const,
                                            },
                                        ],
                                        Projection: {
                                            ProjectionType: {
                                                KeysOnly: "KEYS_ONLY" as const,
                                                All: "ALL" as const,
                                            }[indexDescription.projection],
                                        },
                                    },
                                };
                            },
                        );

                        await runAllPromises([
                            // It would appear that we can only create one index at a time. So issue
                            // `UpdateTable()` commands in sequence for each index.
                            (async () => {
                                for (const createIndexUpdate of createIndexUpdates) {
                                    await internalClient.UpdateTable(context.tracer.getTracer(), {
                                        TableName: tableName,
                                        AttributeDefinitions: attributeDefinitions,
                                        GlobalSecondaryIndexUpdates: [createIndexUpdate],
                                    });
                                }
                            })(),
                            !isTimeToLiveEnabled
                                ? internalClient.UpdateTimeToLive(context.tracer.getTracer(), {
                                      TableName: tableName,
                                      TimeToLiveSpecification: {
                                          Enabled: true,
                                          AttributeName: "expirationTime",
                                      },
                                  })
                                : null,
                        ]);
                    } catch (error) {
                        // A concurrent process may be racing to create this table. Try again...
                        if (
                            isDynamoValidationError(error) ||
                            (error instanceof AggregateError &&
                                isDynamoValidationError(error.errors[0]))
                        ) {
                            retry(error);
                        } else {
                            throw error;
                        }
                    }
                }
            });
            if (ensureLocalCachePath && ensureLocalCacheHash) {
                await fs.mkdir(dirname(ensureLocalCachePath), {recursive: true});
                await fs.writeFile(ensureLocalCachePath, ensureLocalCacheHash);
            }
        });
    }

    private _serializePartitionKey(
        key: Types["PartitionKey"] | Types["ItemKey"] | Types["Item"],
    ): string {
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
    ): string {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(partitionKey.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[partitionKey.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");

        if (!sortKey.sortRangeType.includes("#")) {
            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortKey.sortRangeType);
            const sortRangeDescription =
                partitionDescription.sortRangeByType[sortKey.sortRangeType];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

            const sortKeyEntries = [sortRangeDescription.orderKey, sortKey.sortRangeType];
            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(sortKey[attributeKey]));
            }

            return sortKeyEntries.join(dynamoKeySeparator);
        } else {
            const [sortRangeType, childSortRangeType] = sortKey.sortRangeType.split("#", 2) as [
                string,
                string,
            ];

            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeType);
            const sortRangeDescription = partitionDescription.sortRangeByType[sortRangeType];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

            const childSortRangeConfig =
                sortRangeConfig.childSortRangeByName.get(childSortRangeType);
            const childSortRangeDescription =
                sortRangeDescription.childSortRangeByType[childSortRangeType];
            assert(childSortRangeConfig && childSortRangeDescription, "Invalid child sort range");

            const sortKeyEntries = [sortRangeDescription.orderKey, sortRangeType];

            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(sortKey[attributeKey]));
            }

            sortKeyEntries.push(childSortRangeDescription.orderKey, childSortRangeType);

            for (const [attributeKey, attributeSchema] of Object.entries(
                childSortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(sortKey[attributeKey]));
            }

            const serializedSortKey = sortKeyEntries.join(dynamoKeySeparator);

            return serializedSortKey;
        }
    }

    private _serializeItemKey(key: Types["ItemKey"] | Types["Item"]): {
        partitionKey: string;
        sortKey: string;
        attributesSchema: DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"];
    } {
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

        const serializedPartitionKey = partitionKeyEntries.join(dynamoKeySeparator);

        if (!key.sortRangeType.includes("#")) {
            const sortRangeConfig = partitionConfig.sortRangeByName.get(key.sortRangeType);
            const sortRangeDescription = partitionDescription.sortRangeByType[key.sortRangeType];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

            const sortKeyEntries = [sortRangeDescription.orderKey, key.sortRangeType];
            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
            }

            const serializedSortKey = sortKeyEntries.join(dynamoKeySeparator);

            return {
                partitionKey: serializedPartitionKey,
                sortKey: serializedSortKey,
                attributesSchema: sortRangeConfig.attributes,
            };
        } else {
            const [sortRangeType, childSortRangeType] = key.sortRangeType.split("#", 2) as [
                string,
                string,
            ];

            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeType);
            const sortRangeDescription = partitionDescription.sortRangeByType[sortRangeType];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

            const childSortRangeConfig =
                sortRangeConfig.childSortRangeByName.get(childSortRangeType);
            const childSortRangeDescription =
                sortRangeDescription.childSortRangeByType[childSortRangeType];
            assert(childSortRangeConfig && childSortRangeDescription, "Invalid child sort range");

            const sortKeyEntries = [sortRangeDescription.orderKey, sortRangeType];

            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
            }

            sortKeyEntries.push(childSortRangeDescription.orderKey, childSortRangeType);

            for (const [attributeKey, attributeSchema] of Object.entries(
                childSortRangeConfig.sortKeyAttributes,
            )) {
                sortKeyEntries.push(attributeSchema.serialize(key[attributeKey]));
            }

            const serializedSortKey = sortKeyEntries.join(dynamoKeySeparator);

            return {
                partitionKey: serializedPartitionKey,
                sortKey: serializedSortKey,
                attributesSchema: childSortRangeConfig.attributes,
            };
        }
    }

    /**
     * Deserializes the two key attribute values we store in the database to our
     * key object.
     *
     * Also returns the `Schema` object for attributes of the key's sort range.
     */
    private _deserializeItemKeyInto(
        partitionKey: string,
        sortKey: string,
        key: any,
    ): DynamoTableSchemaTypes.SortRange.ConfigBase["attributes"] {
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

        key.partitionType = partitionType;

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

        assert(partitionKeyEntryIndex === partitionKeyEntries.length, "Invalid partition key");

        key.sortRangeType = sortRangeType;

        let sortKeyEntryIndex = 2;

        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            const sortKeyEntry = sortKeyEntries[sortKeyEntryIndex++];
            assert(sortKeyEntry !== undefined, "Invalid sort key");
            key[attributeKey] = attributeSchema.deserialize(sortKeyEntry as DynamoKeyAttribute);
        }

        if (sortKeyEntryIndex === sortKeyEntries.length) {
            return sortRangeConfig.attributes;
        } else {
            const childSortRangeType = sortKeyEntries[sortKeyEntryIndex + 1];
            assert(childSortRangeType, "Invalid sort key");

            const childSortRangeConfig =
                sortRangeConfig.childSortRangeByName.get(childSortRangeType);
            const childSortRangeDescription =
                sortRangeDescription.childSortRangeByType[childSortRangeType];
            assert(childSortRangeConfig && childSortRangeDescription, "Invalid sort key");

            assert(
                sortKeyEntries[sortKeyEntryIndex] === childSortRangeDescription.orderKey,
                "Invalid sort key",
            );

            key.sortRangeType += `#${childSortRangeType}`;

            sortKeyEntryIndex++;
            sortKeyEntryIndex++;

            for (const [attributeKey, attributeSchema] of Object.entries(
                childSortRangeConfig.sortKeyAttributes,
            )) {
                const sortKeyEntry = sortKeyEntries[sortKeyEntryIndex++];
                assert(sortKeyEntry !== undefined, "Invalid sort key");
                key[attributeKey] = attributeSchema.deserialize(sortKeyEntry as DynamoKeyAttribute);
            }

            assert(sortKeyEntryIndex === sortKeyEntries.length, "Invalid sort key");

            return childSortRangeConfig.attributes;
        }
    }

    private _serializeOpaqueItemKey(key: Types["ItemKey"] | Types["Item"]): {
        bytes: Uint8Array;
        partitionKeyByteCount: number;
    } {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(key.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(key.sortRangeType);
        const sortRangeDescription = partitionDescription.sortRangeByType[key.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        let totalByteCount = 0;

        totalByteCount++;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            totalByteCount += attributeSchema.binary.getByteCount(key[attributeKey]);
        }

        const partitionKeyByteCount = totalByteCount;

        totalByteCount += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );
        totalByteCount++;
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            totalByteCount += attributeSchema.binary.getByteCount(key[attributeKey]);
        }

        const bytes = new Uint8Array(totalByteCount);
        let byteIndex = 0;

        bytes[byteIndex++] = partitionDescription.id;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            const attributeValue = key[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
            byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        DynamoKeyAttributeSchema.orderKey.binary!.serializeBytes(
            sortRangeDescription.orderKey,
            bytes,
            byteIndex,
        );
        byteIndex += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );

        bytes[byteIndex++] = sortRangeDescription.id;

        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            const attributeValue = key[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
            byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        return {bytes, partitionKeyByteCount};
    }

    /**
     * Serialize the item key into an opaque string that can be conveniently shared
     * with clients.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's
     * primary key.
     */
    public serializeOpaqueItemKey(key: Types["ItemKey"] | Types["Item"]): DynamoItemKey {
        const {bytes} = this._serializeOpaqueItemKey(key);

        const opaqueString = encodeBase64(
            bytes,
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoItemKey;

        // In development and test environments, make sure we can deserialize our
        // opaque keys.
        if (process.env.NODE_ENV !== "production") {
            const deserializedKey = this.deserializeOpaqueItemKey(opaqueString);
            assert(
                isDeepEqual(pickObject(key, Object.keys(deserializedKey)), deserializedKey),
                "Couldn’t deserialize opaque item key",
            );
        }

        return opaqueString;
    }

    /**
     * Serialize the item key into an opaque string that can be conveniently shared
     * with clients. Also generates the partition key and sort key which may be
     * useful.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's
     * primary key.
     */
    public serializeOpaqueItemKeyAndMaybePartitionKeyOrSortKey(
        key: Types["ItemKey"] | Types["Item"],
    ): {
        getPartitionKey: () => DynamoItemPartitionKey;
        getSortKey: () => DynamoItemSortKey;
        key: DynamoItemKey;
    } {
        const {bytes, partitionKeyByteCount} = this._serializeOpaqueItemKey(key);

        const opaqueKeyString = encodeBase64(
            bytes,
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoItemKey;

        let opaquePartitionKeyString: DynamoItemPartitionKey | undefined;

        const getOpaquePartitionKeyString = () => {
            opaquePartitionKeyString ??= encodeBase64(
                bytes.subarray(0, partitionKeyByteCount),
                "Rfc4648UrlWithOrderPreservation",
            ) as DynamoItemPartitionKey;

            return opaquePartitionKeyString;
        };

        let opaqueSortKeyString: DynamoItemSortKey | undefined;

        const getOpaqueSortKeyString = () => {
            opaqueSortKeyString ??= encodeBase64(
                bytes.subarray(partitionKeyByteCount),
                "Rfc4648UrlWithOrderPreservation",
            ) as DynamoItemSortKey;

            return opaqueSortKeyString;
        };

        // In development and test environments, make sure we can deserialize our
        // opaque keys.
        if (process.env.NODE_ENV !== "production") {
            const deserializedKey = this.deserializeOpaqueItemKey(opaqueKeyString);
            assert(
                isDeepEqual(pickObject(key, Object.keys(deserializedKey)), deserializedKey),
                "Couldn’t deserialize opaque item key",
            );
        }

        return {
            getPartitionKey: getOpaquePartitionKeyString,
            getSortKey: getOpaqueSortKeyString,
            key: opaqueKeyString,
        };
    }

    /**
     * Serialize the item key into an opaque string that can be conveniently shared
     * with clients. Generates just the partition key and sort key which may be
     * useful.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's
     * primary key.
     */
    public serializeOpaqueItemPartitionKeyAndSortKey(key: Types["ItemKey"] | Types["Item"]): {
        partitionKey: DynamoItemPartitionKey;
        sortKey: DynamoItemSortKey;
    } {
        const {bytes, partitionKeyByteCount} = this._serializeOpaqueItemKey(key);

        const opaquePartitionKeyString = encodeBase64(
            bytes.subarray(0, partitionKeyByteCount),
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoItemPartitionKey;

        const opaqueSortKeyString = encodeBase64(
            bytes.subarray(partitionKeyByteCount),
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoItemSortKey;

        return {
            partitionKey: opaquePartitionKeyString,
            sortKey: opaqueSortKeyString,
        };
    }

    /**
     * Deserialize the item key from our opaque string format that is shared with
     * clients.
     */
    public deserializeOpaqueItemKey(opaqueString: DynamoItemKey): Types["ItemKey"] {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        try {
            const bytes = decodeBase64(opaqueString, "Rfc4648UrlWithOrderPreservation");

            const key: any = {};
            let bytesIndex = 0;

            const partitionNames = this._initializationState.partitionNamesById.get(
                bytes[bytesIndex++]!,
            );
            assert(partitionNames, "Invalid partition key");

            const partitionConfig = this._partitionConfigByName.get(partitionNames.partitionName);
            const partitionDescription =
                this._initializationState.description.partitionByType[partitionNames.partitionName];
            assert(partitionConfig && partitionDescription, "Invalid partition key");

            key.partitionType = partitionNames.partitionName;

            for (const [attributeKey, attributeSchema] of Object.entries(
                partitionConfig.partitionKeyAttributes,
            )) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }

                const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                bytesIndex += attributeSchema.binary.getByteCount(value);

                key[attributeKey] = value;
            }

            const orderKey = DynamoKeyAttributeSchema.orderKey.binary!.deserializeBytes(
                bytes,
                bytesIndex,
            );
            bytesIndex += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(orderKey);

            const sortRangeName = partitionNames.sortRangeNameById.get(bytes[bytesIndex++]!);
            assert(sortRangeName, "Invalid sort key");

            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeName);
            const sortRangeDescription = partitionDescription.sortRangeByType[sortRangeName];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort key");

            assert(orderKey === sortRangeDescription.orderKey, "Invalid sort key");

            key.sortRangeType = sortRangeName;

            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }

                const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                bytesIndex += attributeSchema.binary.getByteCount(value);

                key[attributeKey] = value;
            }

            assert(bytesIndex === bytes.length, "String has more bytes that weren’t used");

            return key;
        } catch (error) {
            throw InvalidArgumentError.from(error, "Invalid opaque item key");
        }
    }

    /**
     * Serialize just the partition key part of the item key into an opaque string
     * that can be conveniently shared with clients.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's
     * primary key.
     */
    public serializeOpaqueItemPartitionKey(
        key: Types["PartitionKey"] | Types["ItemKey"] | Types["Item"],
    ): DynamoItemPartitionKey {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(key.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");

        let totalByteCount = 0;

        totalByteCount++;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            totalByteCount += attributeSchema.binary.getByteCount(key[attributeKey]);
        }

        const bytes = new Uint8Array(totalByteCount);
        let bytesIndex = 0;

        bytes[bytesIndex++] = partitionDescription.id;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            const attributeValue = key[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, bytesIndex);
            bytesIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation") as DynamoItemPartitionKey;
    }

    /**
     * Serialize just the sort key part of the item key into an opaque string
     * that can be conveniently shared with clients.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's
     * primary key.
     */
    public serializeOpaqueItemSortKey(key: Types["ItemKey"] | Types["Item"]): DynamoItemSortKey {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        const partitionConfig = this._partitionConfigByName.get(key.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[key.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(key.sortRangeType);
        const sortRangeDescription = partitionDescription.sortRangeByType[key.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        let totalByteCount = 0;

        totalByteCount += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );
        totalByteCount++;
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            totalByteCount += attributeSchema.binary.getByteCount(key[attributeKey]);
        }

        const bytes = new Uint8Array(totalByteCount);
        let byteIndex = 0;

        DynamoKeyAttributeSchema.orderKey.binary!.serializeBytes(
            sortRangeDescription.orderKey,
            bytes,
            byteIndex,
        );
        byteIndex += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );

        bytes[byteIndex++] = sortRangeDescription.id;

        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            const attributeValue = key[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
            byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation") as DynamoItemSortKey;
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

        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(item);

        const serializedItem: {[key: string]: SchemaSerializedValue} = {partitionKey, sortKey};
        attributesSchema.serializeInto(item, serializedItem);

        // Serialize all the index properties for this item.
        const indexConfigs = this._initializationState.indexConfigsByItemType.get(
            `${item.partitionType}#${item.sortRangeType}`,
        );
        if (indexConfigs) {
            for (let i = 0; i < indexConfigs.length; i++) {
                const indexConfig = indexConfigs[i]!;
                const indexDescription = this._initializationState.description.indexes[i]!;

                // If a filter function is defined then don't add index keys for items that
                // return `false`. This will exclude those items from our index.
                if (indexConfig.filter === null || indexConfig.filter(item)) {
                    // If the index key is reused, don't add an index partition key attribute.
                    if (indexDescription.partitionKeyBehavior.type !== "Reused") {
                        const indexPartitionKey = this._serializeIndexPartitionKey(
                            indexConfig,
                            indexDescription,
                            item,
                        );

                        serializedItem[`index${indexConfig.indexNumber}PartitionKey`] =
                            indexPartitionKey;
                    }

                    const indexSortKey = this._serializeItemIndexSortKey(indexConfig, item);
                    serializedItem[`index${indexConfig.indexNumber}SortKey`] = indexSortKey;
                }
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
    public async getItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        {
            consistency = "Eventual",
            allowsEventualReadConsistency = false,
        }: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        } = {},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        const client = await this._getClient(context, false);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const serializedItem = await client.getItemIfExists(context, {
            tableName: this._name,
            key: {partitionKey, sortKey},
            // As a convenience, we support `DynamoCacheReadConsistency` even though this
            // method doesn't consult any cache. `Strong` provides more guarantees than
            // `StrongWithinCache` so it's safe to use without changing semantics.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            expectsStrongReadConsistency:
                !allowsEventualReadConsistency && getDynamoExpectsStrongReadConsistency(context),
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
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
     * Same as `getItemIfExists()` except we return a `DynamoItem` object.
     * Currently this is only used by `DynamoGeneralRealtimeTableSchema`. In the
     * future, however, we may use `DynamoItem` for all `getItem()` calls from
     * `DynamoTableSchema` too! Since it's core feature (keeping track of
     * `oldItem`) is useful for `directlyUpdateItem()` calls which need the old
     * item's `updateLockVersion`.
     */
    public async _getItemWithOldItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        {
            consistency = "Eventual",
            allowsEventualReadConsistency = false,
        }: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        } = {},
    ): Promise<DynamoItem<MergeObjectIntersection<Types["Item"] & Key>> | null> {
        const client = await this._getClient(context, false);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const serializedItem = await client.getItemIfExists(context, {
            tableName: this._name,
            key: {partitionKey, sortKey},
            // As a convenience, we support `DynamoCacheReadConsistency` even though this
            // method doesn't consult any cache. `Strong` provides more guarantees than
            // `StrongWithinCache` so it's safe to use without changing semantics.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            expectsStrongReadConsistency:
                !allowsEventualReadConsistency && getDynamoExpectsStrongReadConsistency(context),
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });

        if (!serializedItem) return null;

        // @ts-expect-error: `DynamoItem` has a private constructor but it's intended
        // to be used here.
        const item: any = new DynamoItem();
        Object.assign(item, key);
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
    public async getItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        const item = await this.getItemIfExists(context, key, options);

        if (!item) {
            throw new NotFoundError(
                `Item not found (partition type: \`${key.partitionType}\`, sort range type: \`${key.sortRangeType}\`)`,
            );
        }

        return item;
    }

    /**
     * Tries to get an item first with eventual consistency and if that doesn't
     * find the item tries again with strong consistency. Use this when:
     *
     * 1. You know an item definitely exists; AND
     * 2. You want to use a cheaper eventual consistency read in most cases; AND
     * 3. You expect the item may have been recently created so an eventually
     *    consistent read may be stale and not return an item
     */
    public async getItemWithEventualThenStrongConsistency<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        options?: {allowsEventualReadConsistency?: boolean},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        const item = await this.getItemIfExists(context, key, {
            ...options,
            consistency: "Eventual",
        });
        if (item) return item;

        return this.getItem(context, key, {
            ...options,
            consistency: "Strong",
        });
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Returns
     * `null` if the item does not exist.
     *
     * Corresponds to the [`GetItem`][1] command with `ProjectionExpression` set.
     * At this time we do not batch `getPartialItem()` commands.
     *
     * Generally, you should prefer calling `getItemIfExists()` since
     * `getPartialItemIfExists()` does not batch get requests! Whereas
     * `getItemIfExists()` will batch multiple requests into one network request.
     * Only call `getPartialItemIfExists()` if there's some large property on your
     * item you don't need that you have strong reason (ideally evidence) to
     * believe will hurt network performance. Even then, you still have to pay the
     * RCUs when reading this large item! So reaching for
     * `getPartialItemIfExists()` may be a sign of poor table design. Instead of
     * reading a small property on your large item with `getPartialItemIfExists()`
     * you should consider splitting the item into two so you can read small pieces
     * of metadata separately.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    public async getPartialItemIfExists<
        Key extends Types["ItemKey"],
        Attributes extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        context: DynamoContext,
        key: Key,
        {
            attributes,
            consistency = "Eventual",
            allowsEventualReadConsistency,
        }: {
            attributes: Array<Attributes>;
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<MergeObjectIntersection<
        Key & Pick<Extract<Types["Item"], Key>, Attributes>
    > | null> {
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

        const serializedItem = await client.getItemIfExists(context, {
            tableName: this._name,
            key: {partitionKey, sortKey},
            // As a convenience, we support `DynamoCacheReadConsistency` even though this
            // method doesn't consult any cache. `Strong` provides more guarantees than
            // `StrongWithinCache` so it's safe to use without changing semantics.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            projectionExpression:
                projectionExpressionEntries.length !== 0
                    ? projectionExpressionEntries.join(", ")
                    : "partitionKey",
            expressionAttributeNames: new Map(
                mapIterable(expressionAttributeNames, ([key, value]) => [value, key]),
            ),
            expectsStrongReadConsistency:
                !allowsEventualReadConsistency && getDynamoExpectsStrongReadConsistency(context),
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
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
                    propertyKey,
                );
                if (propertyValue !== objectSchemaMissingPropertySymbol) {
                    item[propertyKey] = propertyValue;
                }
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
     * Gets a few attributes of a single item by its key from the database. Throws
     * an error if the item does not exist.
     *
     * Corresponds to the [`GetItem`][1] command with `ProjectionExpression` set.
     * At this time we do not batch `getPartialItem()` commands.
     *
     * Generally, you should prefer calling `getItem()` since `getPartialItem()`
     * does not batch get requests! Whereas `getItem()` will batch multiple
     * requests into one network request. Only call `getPartialItem()` if there's
     * some large property on your item you don't need that you have strong reason
     * (ideally evidence) to believe will hurt network performance. Even then, you
     * still have to pay the RCUs when reading this large item! So reaching for
     * `getPartialItem()` may be a sign of poor table design. Instead of reading a
     * small property on your large item with `getPartialItem()` you should
     * consider splitting the item into two so you can read small pieces of
     * metadata separately.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_GetItem.html
     */
    public async getPartialItem<
        Key extends Types["ItemKey"],
        Attributes extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        context: DynamoContext,
        key: Key,
        options: {
            attributes: Array<Attributes>;
            consistency?: DynamoCacheReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Extract<Types["Item"], Key>, Attributes>>> {
        const item = await this.getPartialItemIfExists(context, key, options);

        if (!item) {
            throw new NotFoundError(
                `Item not found (partition type: \`${key.partitionType}\`, sort range type: \`${key.sortRangeType}\`)`,
            );
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
        {isConditionCheckErrorRetriable = false}: {isConditionCheckErrorRetriable?: boolean} = {},
    ): Promise<void> {
        await this._putItem(context, item, {
            condition: DynamoConditionExpression._unsafeRaw(
                "attribute_not_exists(partitionKey)",
                DynamoConditionExpressionPrecedence.Function,
            ),
            // Calling `createItem()` has the intent of there is a new item I want to
            // create. It should not be used to implement upserts. Use
            // `createOrReplaceItem()` or `updateItem()` for that.
            isConditionCheckErrorRetriable,
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
    ): Promise<{wasCreated: boolean}> {
        try {
            await this.createItem(context, item);

            return {wasCreated: true};
        } catch (error) {
            // If this item already exists, great! This is a noop.
            if (isDynamoConditionCheckError(error)) return {wasCreated: false};

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
            // Re-reading the item will continue to give us `null` so retrying the
            // operation won't fix it.
            //
            // If the user provides a condition then we assume they are manually
            // implementing an optimistic locking scheme so we allow this update to
            // be retriable.
            isConditionCheckErrorRetriable: !!condition,
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
     * and we will try again with `context.dynamo.retryTransaction()`.
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
    public updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key>,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key>>,
        options: {
            initialItem: Types["Item"] & Key;
            withNoopUpdateLockVersionConditionCheck?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>>;
    public updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key>,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key> | null>,
        options: {
            initialItem: Types["Item"] & Key;
            withNoopUpdateLockVersionConditionCheck?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null>;
    public updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key> | null>,
        options?: {
            initialItem?: Types["Item"] & Key;
            withNoopUpdateLockVersionConditionCheck?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null>;
    public updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        // Typed as `never` since a caller should always match one of the overloads,
        // not this base definition.
        update: never,
        {
            initialItem,
            withNoopUpdateLockVersionConditionCheck = false,
        }: {
            initialItem?: Types["Item"] & Key;
            withNoopUpdateLockVersionConditionCheck?: boolean;
        } = {},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        let hasAttempted = false;

        return context.dynamo.retryTransaction(async context => {
            const isInitialAttempt = !hasAttempted;
            hasAttempted = true;

            const item =
                isInitialAttempt && initialItem
                    ? initialItem
                    : await this.getItemIfExists(context, key);

            const newItem: Extract<Types["Item"], Key> | null = await (update as any)(item);

            // Noop update if item didn't change.
            if (item === newItem) {
                if (withNoopUpdateLockVersionConditionCheck) {
                    await DynamoTableSchema.executeTransaction(context, [
                        this.transactionUpdateLockVersionConditionCheck(
                            key,
                            item?.updateLockVersion,
                        ),
                    ]);
                }

                return item;
            }

            const condition = !item
                ? DynamoConditionExpression._unsafeRaw(
                      "attribute_not_exists(partitionKey)",
                      DynamoConditionExpressionPrecedence.Function,
                  )
                : DynamoConditionExpression._unsafeRaw(
                      "attribute_exists(partitionKey)",
                      DynamoConditionExpressionPrecedence.Function,
                  ).and(
                      DynamoConditionExpression.from({
                          // Verify that the lock version was not changed by a concurrent writer.
                          updateLockVersion:
                              typeof item.updateLockVersion === "number" &&
                              item.updateLockVersion !== 0
                                  ? DynamoConditionExpression.eq(item.updateLockVersion)
                                  : DynamoConditionExpression.exists().not(),
                      }),
                  );

            if (newItem !== null) {
                const actualNewItem = {
                    ...newItem,
                    // Increment the lock version in this new item.
                    //
                    // The `update()` function should not change the `updateLockVersion` property
                    // itself. If it does (e.g. creates a new item without the property instead of
                    // spreading the old object) then we override the change.
                    //
                    // An undefined lock version is the same as a lock version of 0. Except we
                    // can’t set to 0 because our conditional update looks for a lock version that
                    // does not exist for version 0.
                    updateLockVersion: !item
                        ? undefined
                        : typeof item.updateLockVersion === "number"
                        ? item.updateLockVersion + 1
                        : 1,
                };

                await this._putItem(context, actualNewItem, {
                    condition,
                    // This operation implements an optimistic locking scheme. Retrying the
                    // operation should read the latest item version and eventually succeed.
                    isConditionCheckErrorRetriable: true,
                });

                return actualNewItem;
            } else {
                await this._deleteItem(context, key, {
                    condition,
                    // This operation implements an optimistic locking scheme. Retrying the
                    // operation should read the latest item version and eventually succeed.
                    isConditionCheckErrorRetriable: true,
                });

                return null;
            }
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
     * `context.dynamo.retryTransaction()` call and you should call `getItem()`
     * inside that retry block so you get a new version of the item after a retry.
     * The `updateItem()` method handles this for you so generally prefer using
     * that method but sometimes you may need to create your own
     * `context.dynamo.retryTransaction()` loop. (Maybe you are executing a
     * transaction?)
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     */
    public async directlyUpdateItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
        {condition}: {condition?: DynamoCondition<Item>} = {},
    ): Promise<Item> {
        const newItem: Item = {
            ...item,
            // Increment the lock version in this new item.
            updateLockVersion:
                typeof item.updateLockVersion === "number" ? item.updateLockVersion + 1 : 1,
        };

        // Verify that the lock version was not changed by a concurrent writer.
        const updateLockVersionCondition = DynamoConditionExpression.from<Item>({
            updateLockVersion:
                typeof item.updateLockVersion === "number" && item.updateLockVersion !== 0
                    ? DynamoConditionExpression.eq(item.updateLockVersion)
                    : DynamoConditionExpression.exists().not(),
        });

        await this._putItem(context, newItem, {
            condition: condition
                ? updateLockVersionCondition.and(DynamoConditionExpression.from(condition))
                : updateLockVersionCondition,
            // This operation implements an optimistic locking scheme. Retrying the
            // operation should read the latest item version and eventually succeed.
            isConditionCheckErrorRetriable: true,
        });

        return newItem;
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
            isConditionCheckErrorRetriable,
        }:
            | {
                  condition: DynamoCondition<Item>;
                  /**
                   * Force `isConditionCheckErrorRetriable` to be provided when a `condition`
                   * is set.
                   *
                   * True only when the condition is for optimistic locking schemes like
                   * `updateLockVersion`. In these schemes retrying an operation which re-reads
                   * an item should eventually succeed.
                   *
                   * If the user provides a condition we assume they are implementing their own
                   * optimistic locking scheme and default this to true.
                   */
                  isConditionCheckErrorRetriable: boolean;
              }
            | {
                  condition?: undefined;
                  isConditionCheckErrorRetriable?: undefined;
              } = {},
    ): Promise<void> {
        const client = await this._getClient(context, true);

        const {partitionKey, sortKey, attributesSchema, serializedItem} = this._serializeItem(item);

        if (condition === undefined) {
            return client.putItem(context, {
                tableName: this._name,
                key: {partitionKey, sortKey},
                item: serializedItem,
                debugItemType: {
                    tableName: this._name,
                    partitionType: item.partitionType,
                    sortRangeType: item.sortRangeType,
                },
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return client.putItem(context, {
                tableName: this._name,
                key: {partitionKey, sortKey},
                item: serializedItem,
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
                retryConditionCheckError: isConditionCheckErrorRetriable
                    ? getDynamoRetryTransactionIfExists(context)
                    : null,
                debugItemType: {
                    tableName: this._name,
                    partitionType: item.partitionType,
                    sortRangeType: item.sortRangeType,
                },
            });
        }
    }

    /**
     * Deletes an item from the database. If the item doesn't exist or the item
     * does not match the item's update lock version, we throw a condition check
     * error.
     *
     * Corresponds to the [`DeleteItem`][1] command with a condition.
     *
     * `deleteItemWithKeyIfExists()` is slightly more efficient but is less safe
     * in general.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    public async deleteItem<Item extends Types["Item"]>(
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

        // Verify that the lock version was not changed by a concurrent writer.
        const updateLockVersionCondition = DynamoConditionExpression.from({
            updateLockVersion:
                typeof item.updateLockVersion === "number" && item.updateLockVersion !== 0
                    ? DynamoConditionExpression.eq(item.updateLockVersion)
                    : DynamoConditionExpression.exists().not(),
        });

        const baseCondition = itemExistsCondition.and(updateLockVersionCondition);

        await this._deleteItem(context, item as any, {
            condition: condition
                ? baseCondition.and(DynamoConditionExpression.from(condition))
                : baseCondition,
            // This operation implements an optimistic locking scheme. Retrying the
            // operation should read the latest item version and eventually succeed.
            isConditionCheckErrorRetriable: true,
        });
    }

    /**
     * Deletes an item from the database. If the item doesn't exist, we throw a
     * condition check error.
     *
     * Unlike `deleteItem()` we do not require you to have the whole item to
     * delete it. Just the key. This method does not consider concurrent writers.
     * If a concurrent writer updated the item you won't know about it.
     *
     * Corresponds to the [`DeleteItem`][1] command with a condition.
     *
     * If you don't need a condition, generally you should prefer to use
     * `deleteItemWithKeyIfExists()` because it is more efficient.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     */
    public async deleteItemWithKey<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Extract<Types["Item"], Key>>;
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
            // A plain delete is not implementing optimistic locking. Retrying this
            // operation does not re-read the full item to get a latest lock value.
            //
            // If the user provides a condition then we assume they are manually
            // implementing an optimistic locking scheme so we allow this update to
            // be retriable.
            isConditionCheckErrorRetriable: !!condition,
        });
    }

    /**
     * Deletes an item from the database. If the item doesn't exist, this is a noop.
     *
     * Corresponds to the [`DeleteItem`][1] command. If you call this function many
     * times in parallel (without a condition) then we will batch the writes
     * together into a [`BatchWriteItem`][2] command.
     *
     * This method is more efficient than `deleteItemWithKey()` because it does not
     * need a [read capacity unit (RCU), it only needs a write capacity unit (WCU)][3].
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_DeleteItem.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_BatchWriteItem.html
     * [3]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
     */
    public async deleteItemWithKeyIfExists<Key extends Types["ItemKey"]>(
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
            isConditionCheckErrorRetriable,
        }:
            | {
                  condition: DynamoCondition<Extract<Types["Item"], Key>>;
                  /**
                   * Force `isConditionCheckErrorRetriable` to be provided when a `condition`
                   * is set.
                   *
                   * True only when the condition is for optimistic locking schemes like
                   * `updateLockVersion`. In these schemes retrying an operation which re-reads
                   * an item should eventually succeed.
                   *
                   * If the user provides a condition we assume they are implementing their own
                   * optimistic locking scheme and default this to true.
                   */
                  isConditionCheckErrorRetriable: boolean;
              }
            | {
                  condition?: undefined;
                  isConditionCheckErrorRetriable?: undefined;
              } = {},
    ): Promise<void> {
        const client = await this._getClient(context, true);
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        if (condition === undefined) {
            return client.deleteItem(context, {
                tableName: this._name,
                key: {partitionKey, sortKey},
                debugItemType: {
                    tableName: this._name,
                    partitionType: key.partitionType,
                    sortRangeType: key.sortRangeType,
                },
            });
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            const retryTransaction = getDynamoRetryTransactionIfExists(context);

            return client.deleteItem(context, {
                tableName: this._name,
                key: {partitionKey, sortKey},
                conditionExpression: conditionExpressionString,
                expressionAttributeValues: new Map(conditionCompilationContext.iterateVariables()),
                expressionAttributeNames: new Map(
                    conditionCompilationContext.iterateAttributeNames(),
                ),
                retryConditionCheckError: isConditionCheckErrorRetriable ? retryTransaction : null,
                debugItemType: {
                    tableName: this._name,
                    partitionType: key.partitionType,
                    sortRangeType: key.sortRangeType,
                },
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
        {clientRequestToken}: {clientRequestToken?: string} = {},
    ): Promise<void> {
        const client = getDynamoClient(context);

        return client.executeTransaction(context, entries, {
            clientRequestToken,
            retryConditionCheckError: getDynamoRetryTransactionIfExists(context),
        });
    }

    /**
     * Transaction entry for creating an item in the database. Same semantics as
     * `createItem()` but can be part of a transaction that atomically succeeds
     * or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionCreateItem<Item extends Types["Item"]>(
        item: Item,
        {
            isConditionCheckErrorRetriable = false,
            onAfterTransactionExecutedSuccessfully,
        }: {
            isConditionCheckErrorRetriable?: boolean;
            onAfterTransactionExecutedSuccessfully?: () => MaybePromise<void>;
        } = {},
    ): DynamoTransactionEntry & {newItem: Item} {
        return this._transactionPutItem(item, {
            condition: DynamoConditionExpression._unsafeRaw(
                "attribute_not_exists(partitionKey)",
                DynamoConditionExpressionPrecedence.Function,
            ),
            // Calling `createItem()` has the intent of there is a new item I want to
            // create. It should not be used to implement upserts. Use
            // `createOrReplaceItem()` or `updateItem()` for that.
            isConditionCheckErrorRetriable,
            onAfterTransactionExecutedSuccessfully,
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
            onAfterTransactionExecutedSuccessfully,
        }: {
            condition?: DynamoCondition<Item>;
            onAfterTransactionExecutedSuccessfully?: () => MaybePromise<void>;
        } = {},
    ): DynamoTransactionEntry & {newItem: Item} {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        return this._transactionPutItem(item, {
            condition: condition
                ? itemExistsCondition.and(DynamoConditionExpression.from(condition))
                : itemExistsCondition,
            // Re-reading the item will continue to give us `null` so retrying the
            // operation won't fix it.
            //
            // If the user provides a condition then we assume they are manually
            // implementing an optimistic locking scheme so we allow this update to
            // be retriable.
            isConditionCheckErrorRetriable: !!condition,
            onAfterTransactionExecutedSuccessfully,
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
        options?: {onAfterTransactionExecutedSuccessfully?: () => MaybePromise<void>},
    ): DynamoTransactionEntry & {newItem: Item} {
        return this._transactionPutItem(item, options);
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
     * `context.dynamo.retryTransaction()` on your own! You must also make sure
     * that you read the item you are updating within that function so it may be
     * re-read when we retry.
     *
     * This method corresponds to `directlyUpdateItem()`.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
            onAfterTransactionExecutedSuccessfully,
        }: {
            condition?: DynamoCondition<Item>;
            onAfterTransactionExecutedSuccessfully?: () => MaybePromise<void>;
        } = {},
    ): DynamoTransactionEntry & {newItem: Item} {
        // Verify that the lock version was not changed by a concurrent writer.
        const updateLockVersionCondition = DynamoConditionExpression.from<Item>({
            updateLockVersion:
                typeof item.updateLockVersion === "number" && item.updateLockVersion !== 0
                    ? DynamoConditionExpression.eq(item.updateLockVersion)
                    : DynamoConditionExpression.exists().not(),
        });

        return this._transactionPutItem(
            {
                ...item,
                // Increment the lock version in this new item.
                updateLockVersion:
                    typeof item.updateLockVersion === "number" ? item.updateLockVersion + 1 : 1,
            },
            {
                condition: condition
                    ? updateLockVersionCondition.and(DynamoConditionExpression.from(condition))
                    : updateLockVersionCondition,
                // This operation implements an optimistic locking scheme. Retrying the
                // operation should read the latest item version and eventually succeed.
                isConditionCheckErrorRetriable: true,
                onAfterTransactionExecutedSuccessfully,
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
            onAfterTransactionExecutedSuccessfully,
            condition,
            isConditionCheckErrorRetriable,
        }: {
            onAfterTransactionExecutedSuccessfully?: () => MaybePromise<void>;
        } & (
            | {
                  condition: DynamoCondition<Item>;
                  /**
                   * Force `isConditionCheckErrorRetriable` to be provided when a `condition`
                   * is set.
                   *
                   * True only when the condition is for optimistic locking schemes like
                   * `updateLockVersion`. In these schemes retrying an operation which re-reads
                   * an item should eventually succeed.
                   *
                   * If the user provides a condition we assume they are implementing their own
                   * optimistic locking scheme and default this to true.
                   */
                  isConditionCheckErrorRetriable: boolean;
              }
            | {
                  condition?: undefined;
                  isConditionCheckErrorRetriable?: undefined;
              }
        ) = {},
    ): DynamoTransactionEntry & {newItem: Item} {
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
            return Object.assign(
                DynamoClient.transactionPutItem({
                    tableName: this._name,
                    item: serializedItem,
                    onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
                    onAfterTransactionExecutedSuccessfully,
                    debugItemType: {
                        tableName: this._name,
                        partitionType: item.partitionType,
                        sortRangeType: item.sortRangeType,
                    },
                }),
                {newItem: item},
            );
        } else {
            const conditionCompilationContext = DynamoConditionExpressionCompilationContext.new();
            const conditionExpression = DynamoConditionExpression.from(condition);
            const {string: conditionExpressionString} = conditionExpression.compile(
                attributesSchema,
                conditionCompilationContext,
            );

            return Object.assign(
                DynamoClient.transactionPutItem({
                    tableName: this._name,
                    item: serializedItem,
                    conditionExpression: conditionExpressionString,
                    expressionAttributeValues: new Map(
                        conditionCompilationContext.iterateVariables(),
                    ),
                    expressionAttributeNames: new Map(
                        conditionCompilationContext.iterateAttributeNames(),
                    ),
                    isConditionCheckErrorRetriable,
                    onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
                    onAfterTransactionExecutedSuccessfully,
                    debugItemType: {
                        tableName: this._name,
                        partitionType: item.partitionType,
                        sortRangeType: item.sortRangeType,
                    },
                }),
                {newItem: item},
            );
        }
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItem()` but can be part of a transaction that atomically
     * succeeds or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDeleteItem<Item extends Types["Item"]>(
        item: Item,
        {
            condition,
        }: {
            condition?: DynamoCondition<Item>;
        } = {},
    ) {
        const itemExistsCondition = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
            DynamoConditionExpressionPrecedence.Function,
        );

        // Verify that the lock version was not changed by a concurrent writer.
        const updateLockVersionCondition = DynamoConditionExpression.from({
            updateLockVersion:
                typeof item.updateLockVersion === "number" && item.updateLockVersion !== 0
                    ? DynamoConditionExpression.eq(item.updateLockVersion)
                    : DynamoConditionExpression.exists().not(),
        });

        const baseCondition = itemExistsCondition.and(updateLockVersionCondition);

        return this._transactionDeleteItem(item as any, {
            condition: condition
                ? baseCondition.and(DynamoConditionExpression.from(condition))
                : baseCondition,
            // This operation implements an optimistic locking scheme. Retrying the
            // operation should read the latest item version and eventually succeed.
            isConditionCheckErrorRetriable: true,
        });
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItemWithKey()` but can be part of a transaction that atomically
     * succeeds or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionDeleteItemWithKey<Key extends Types["ItemKey"]>(
        key: Key,
        {
            condition,
        }: {
            condition?: DynamoCondition<Extract<Types["Item"], Key>>;
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
            // A plain delete is not implementing optimistic locking. Retrying this
            // operation does not re-read the full item to get a latest lock value.
            //
            // If the user provides a condition then we assume they are manually
            // implementing an optimistic locking scheme so we allow this update to
            // be retriable.
            isConditionCheckErrorRetriable: !!condition,
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
            isConditionCheckErrorRetriable,
        }:
            | {
                  condition: DynamoCondition<Extract<Types["Item"], Key>>;
                  /**
                   * Force `isConditionCheckErrorRetriable` to be provided when a `condition`
                   * is set.
                   *
                   * True only when the condition is for optimistic locking schemes like
                   * `updateLockVersion`. In these schemes retrying an operation which re-reads
                   * an item should eventually succeed.
                   *
                   * If the user provides a condition we assume they are implementing their own
                   * optimistic locking scheme and default this to true.
                   */
                  isConditionCheckErrorRetriable: boolean;
              }
            | {
                  condition?: undefined;
                  isConditionCheckErrorRetriable?: undefined;
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
                onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
                debugItemType: {
                    tableName: this._name,
                    partitionType: key.partitionType,
                    sortRangeType: key.sortRangeType,
                },
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
                isConditionCheckErrorRetriable,
                onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
                debugItemType: {
                    tableName: this._name,
                    partitionType: key.partitionType,
                    sortRangeType: key.sortRangeType,
                },
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
        condition?: DynamoCondition<Extract<Types["Item"], Key>>,
        {isConditionCheckErrorRetriable = false}: {isConditionCheckErrorRetriable?: boolean} = {},
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
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Creates a transaction entry that checks the provided item exists and checks
     * the item has the version provided by `updateLockVersion`.
     *
     * Convenience method on top of `transactionConditionCheck()`.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionUpdateLockVersionConditionCheck(
        key: Types["ItemKey"],
        updateLockVersion: number | undefined,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        // Verify that the lock version was not changed by a concurrent writer.
        const conditionExpression = DynamoConditionExpression.from({
            updateLockVersion:
                typeof updateLockVersion === "number" && updateLockVersion !== 0
                    ? DynamoConditionExpression.eq(updateLockVersion)
                    : DynamoConditionExpression.exists().not(),
        });

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
            // This operation implements an optimistic locking scheme. Retrying the
            // operation should read the latest item version and eventually succeed.
            isConditionCheckErrorRetriable: true,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Creates a transaction entry that checks whether an item with the provided
     * key exists.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     */
    public transactionExistsConditionCheck<Key extends Types["ItemKey"]>(
        key: Key,
        {isConditionCheckErrorRetriable = false}: {isConditionCheckErrorRetriable?: boolean} = {},
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey, attributesSchema} = this._serializeItemKey(key);

        const conditionExpression = DynamoConditionExpression._unsafeRaw(
            "attribute_exists(partitionKey)",
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
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
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
        {isConditionCheckErrorRetriable = false}: {isConditionCheckErrorRetriable?: boolean} = {},
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
            isConditionCheckErrorRetriable,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Update a single attribute on the item with the specified key. The update is
     * serialized with all other updates of this item with `updateLockVersion`.
     *
     * You are expected to load the current `updateLockVersion` and pass it into
     * this function. Probably with `getPartialItem()`. If you pass in an incorrect
     * `updateLockVersion` there will be a condition check error. Probably what you
     * want to do is to run a `context.dynamo.retryTransaction()` loop that loads
     * the old version of the property and the `updateLockVersion`. Then apply an
     * update and create this transaction entry. Or you can use
     * `updateItemAttribute()` which handles the retry loop for you.
     */
    public transactionDirectlyUpdateItemAttribute<
        Key extends Types["ItemKey"],
        Attribute extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        key: Key,
        attribute: Attribute,
        attributeValue: Extract<Types["Item"], Key>[Attribute],
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
        propertySchema.serializeProperty(
            serializedObject,
            serializedKey,
            attributeValue,
            attribute,
        );

        // We don't support optional properties or properties that serialize to
        // multiple keys (e.g. `wrapOriginalPropertyInObject()`) in
        // `transactionDirectlyUpdateItemAttribute()`. We only support attributes
        // that serialize to a single property.
        const serializedObjectEntries = Object.entries(serializedObject);
        assert(serializedObjectEntries.length === 1);
        assert(serializedObjectEntries[0]![0] === serializedKey);
        const serializedValue = serializedObjectEntries[0]![1];

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
            transactItem: {
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
            },
            isConditionCheckErrorRetriable: true,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully: null,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Update just the `updateLockVersion` on the item with the specified key.
     * This is useful if you have a transaction you want to force to be serialized
     * with other updates on this item but you don't have an update you want to
     * make to the item.
     *
     * You are expected to load the current `updateLockVersion` and pass it into
     * this function. Probably with `getPartialItem()`. If you pass in an incorrect
     * `updateLockVersion` there will be a condition check error. Probably what you
     * want to do is to run a `context.dynamo.retryTransaction()` loop that loads
     * the old version of the property and the `updateLockVersion`. Then apply an
     * update and create this transaction entry.
     */
    public transactionDirectlyUpdateItemLockVersion(
        key: Types["ItemKey"],
        updateLockVersion: number | undefined,
    ): DynamoTransactionEntry {
        const {partitionKey, sortKey} = this._serializeItemKey(key);

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
                    indexConfig.partitionKeyAttributes.updateLockVersion === undefined,
                    "Can not directly update an indexed attribute",
                );
                assert(
                    indexConfig.sortKeyAttributes.updateLockVersion === undefined,
                    "Can not directly update an indexed attribute",
                );
            }
        }

        const expressionAttributeValues: {[key: string]: AttributeValue} = {};

        if (typeof updateLockVersion === "number") {
            expressionAttributeValues[":oldUpdateLockVersion"] =
                intoDynamoAttributeValue(updateLockVersion);
        }

        expressionAttributeValues[":newUpdateLockVersion"] = intoDynamoAttributeValue(
            (updateLockVersion ?? 0) + 1,
        );

        return DynamoTransactionEntry._newFromClient(DynamoClient, {
            transactItem: {
                Update: {
                    TableName: this._name,
                    Key: intoDynamoAttributeValueObject({partitionKey, sortKey}),
                    UpdateExpression: "SET updateLockVersion = :newUpdateLockVersion",
                    ConditionExpression:
                        typeof updateLockVersion === "number"
                            ? "updateLockVersion = :oldUpdateLockVersion"
                            : "attribute_not_exists(updateLockVersion)",
                    ExpressionAttributeValues: expressionAttributeValues,
                },
            },
            isConditionCheckErrorRetriable: true,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully: null,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Create a DynamoDB transaction entry with a custom update expression. Useful
     * if you want to write a custom atomic update that doesn't require a condition
     * check.
     *
     * However, using this method is dangerous! It doesn't update
     * `updateLockVersion`. You usually want to update `updateLockVersion` or else
     * a concurrent writer may write over your update.
     */
    public dangerousTransactionUpdateItemWithCustomUpdateExpression(
        key: Types["ItemKey"],
        {
            updateExpression,
            expressionAttributeValues,
        }: {
            updateExpression: string;
            expressionAttributeValues: {[key: string]: SchemaSerializedValue};
        },
    ) {
        const {partitionKey, sortKey} = this._serializeItemKey(key);

        return DynamoTransactionEntry._newFromClient(DynamoClient, {
            transactItem: {
                Update: {
                    TableName: this._name,
                    Key: intoDynamoAttributeValueObject({partitionKey, sortKey}),
                    UpdateExpression: updateExpression,
                    ExpressionAttributeValues:
                        intoDynamoAttributeValueObject(expressionAttributeValues),
                },
            },
            isConditionCheckErrorRetriable: false,
            onBeforeExecuteTransaction: this._handleBeforeExecuteTransaction,
            onAfterTransactionExecutedSuccessfully: null,
            debugItemType: {
                tableName: this._name,
                partitionType: key.partitionType,
                sortRangeType: key.sortRangeType,
            },
        });
    }

    /**
     * Gets multiple items from DynamoDB with a serializable transaction isolation
     * level. Corresponds to the [`TransactGetItems`][1] command. Each item in the
     * returned array corresponds to the provided key. If there was no item for the
     * provided key then that slot in the array is null.
     *
     * Read more about DynamoDB transactions [here][2].
     *
     * If this function is wrapped in a `context.dynamo.retryTransaction()` then
     * when there is a conflict we will retry the entire transaction. If this
     * function is not wrapped in `context.dynamo.retryTransaction()` then we will
     * run our own retry loop for this function.
     *
     * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_TransactGetItems.html
     * [2]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/transaction-apis.html
     */
    public executeGetItemsTransaction<const Keys extends ReadonlyArray<Types["ItemKey"]>>(
        context: DynamoContext,
        keys: Keys,
    ): Promise<{
        [Index in keyof Keys]: Extract<Types["Item"], Keys[Index]> | null;
    }> {
        const run = async (retry: (error?: unknown) => never) => {
            const client = await this._getClient(context, false);
            const serializedKeys = keys.map(key => this._serializeItemKey(key));

            const serializedItems = await client.executeGetItemsTransaction(
                context.tracer.getTracer(),
                {
                    tableName: this._name,
                    keys: serializedKeys.map(({partitionKey, sortKey}) => ({
                        partitionKey,
                        sortKey,
                    })),
                    retryTransactionConflictError: retry,
                    debugItemTypes: keys.map(key => ({
                        tableName: this._name,
                        partitionType: key.partitionType,
                        sortRangeType: key.sortRangeType,
                    })),
                },
            );

            assert(serializedItems.length === serializedKeys.length);

            return serializedItems.map((serializedItem, index) => {
                if (!serializedItem) return null;

                const key = keys[index]!;
                const {attributesSchema} = serializedKeys[index]!;

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
            }) as any;
        };

        // NOTE(calebmer): Maybe it's always better to always run our own nested
        // `retryWithExponentialBackoff()` for this function? Instead of plugging into
        // the full DynamoDB transaction. Unclear to me.
        const retryTransaction = getDynamoRetryTransactionIfExists(context);
        if (retryTransaction) return run(retryTransaction);
        return retryWithExponentialBackoff(run);
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
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: DynamoContext,
        {
            partitionKey,
            startSortKey,
            endSortKey,
            isStartSortKeyExclusive,
            isEndSortKeyExclusive,
            afterItemKey,
            limit,
            pageLimit,
            descending,
            consistency = "Eventual",
            allowsEventualReadConsistency = false,
        }: {
            partitionKey: PartitionKey;
            startSortKey?: StartSortKey | undefined;
            endSortKey?: EndSortKey | undefined;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            afterItemKey?: Extract<
                Types["ItemKey"],
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                }
            >;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): AsyncIterableIterator<
        Extract<
            Types["Item"],
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

        const partitionConfig = this._partitionConfigByName.get(partitionKey.partitionType)!;

        const startSortRangeIndex = startSortKey
            ? partitionConfig.sortRangeByName.get(startSortKey.sortRangeType)?.index
            : undefined;
        const endSortRangeIndex = endSortKey
            ? partitionConfig.sortRangeByName.get(endSortKey.sortRangeType)?.index
            : undefined;

        const sortRanges = partitionConfig.sortRanges.slice(
            startSortRangeIndex,
            endSortRangeIndex !== undefined ? endSortRangeIndex + 1 : undefined,
        );

        let lastEvaluatedKey: SchemaSerializedObjectValue | undefined;
        if (afterItemKey) {
            const {partitionKey, sortKey} = this._serializeItemKey(afterItemKey);
            lastEvaluatedKey = {partitionKey, sortKey};
        }

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
            lastEvaluatedKey,
            // As a convenience, we support `DynamoCacheReadConsistency` even though this
            // method doesn't consult any cache. `Strong` provides more guarantees than
            // `StrongWithinCache` so it's safe to use without changing semantics.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            limit: limit !== "All" ? limit : undefined,
            pageLimit,
            descending,
            expectsStrongReadConsistency:
                !allowsEventualReadConsistency && getDynamoExpectsStrongReadConsistency(context),
            debugItemTypes: sortRanges.map(sortRange => ({
                tableName: this._name,
                partitionType: partitionKey.partitionType,
                sortRangeType: sortRange.name,
            })),
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            const item: any = {};

            const attributesSchema = this._deserializeItemKeyInto(
                serializedItem.partitionKey,
                serializedItem.sortKey,
                item,
            );

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
     * Same as `query()` except we return a `DynamoItem` object. Currently this is
     * only used by `DynamoGeneralRealtimeTableSchema`. In the future, however, we
     * may use `DynamoItem` for all `query()` calls from `DynamoTableSchema` too!
     * Since it's core feature (keeping track of `oldItem`) is useful for
     * `directlyUpdateItem()` calls which need the old item's `updateLockVersion`.
     */
    public async *_queryWithOldItems<
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: DynamoContext,
        {
            partitionKey,
            startSortKey,
            endSortKey,
            isStartSortKeyExclusive,
            isEndSortKeyExclusive,
            afterItemKey,
            limit,
            pageLimit,
            descending,
            consistency = "Eventual",
            allowsEventualReadConsistency = false,
        }: {
            partitionKey: PartitionKey;
            startSortKey?: StartSortKey | undefined;
            endSortKey?: EndSortKey | undefined;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            afterItemKey?: Extract<
                Types["ItemKey"],
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                }
            >;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): AsyncIterableIterator<
        DynamoItem<
            Extract<
                Types["Item"],
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                }
            >
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

        const partitionConfig = this._partitionConfigByName.get(partitionKey.partitionType)!;

        const startSortRangeIndex = startSortKey
            ? partitionConfig.sortRangeByName.get(startSortKey.sortRangeType)?.index
            : undefined;
        const endSortRangeIndex = endSortKey
            ? partitionConfig.sortRangeByName.get(endSortKey.sortRangeType)?.index
            : undefined;

        const sortRanges = partitionConfig.sortRanges.slice(
            startSortRangeIndex,
            endSortRangeIndex !== undefined ? endSortRangeIndex + 1 : undefined,
        );

        let lastEvaluatedKey: SchemaSerializedObjectValue | undefined;
        if (afterItemKey) {
            const {partitionKey, sortKey} = this._serializeItemKey(afterItemKey);
            lastEvaluatedKey = {partitionKey, sortKey};
        }

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
            lastEvaluatedKey,
            // As a convenience, we support `DynamoCacheReadConsistency` even though this
            // method doesn't consult any cache. `Strong` provides more guarantees than
            // `StrongWithinCache` so it's safe to use without changing semantics.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            limit: limit !== "All" ? limit : undefined,
            pageLimit,
            descending,
            expectsStrongReadConsistency:
                !allowsEventualReadConsistency && getDynamoExpectsStrongReadConsistency(context),
            debugItemTypes: sortRanges.map(sortRange => ({
                tableName: this._name,
                partitionType: partitionKey.partitionType,
                sortRangeType: sortRange.name,
            })),
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            // @ts-expect-error: `DynamoItem` has a private constructor but it's intended
            // to be used here.
            const item: any = new DynamoItem();

            const attributesSchema = this._deserializeItemKeyInto(
                serializedItem.partitionKey,
                serializedItem.sortKey,
                item,
            );

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
    public async *expensiveScan(
        context: DynamoContext,
        {
            limit,
            consistency = "Eventual",
            segmentIndex,
            totalSegmentCount,
            filter,
        }: {
            limit?: number;
            consistency?: DynamoReadConsistency;
            segmentIndex?: number;
            totalSegmentCount?: number;
            filter?: Types["ItemType"] | Array<Types["ItemType"]>;
        } = {},
    ): AsyncIterableIterator<MergeObjectIntersection<Types["Item"]>> {
        const client = await this._getClient(context, false);

        const filterCompilationContext = DynamoConditionExpressionCompilationContext.new();
        let filterExpressionString: string | undefined;

        if (filter) {
            const filters = Array.isArray(filter) ? filter : [filter];

            const filterExpressionStrings = filters.map(filter => {
                assert(
                    this._initializationState.isInitialized,
                    "Schema has not finished initializing",
                );

                const partitionDescription =
                    this._initializationState.description.partitionByType[filter.partitionType];
                assert(partitionDescription, "Invalid partition");

                // NOTE(calebmer): There's no reason we couldn't support a child sort range
                // here. We just haven't needed it yet. To support we'd need to use the
                // `contains(sortKey, childSortRangeType)` DynamoDB filter expression with the
                // child sort range and we'd probably also need to double check the filter when
                // iterating over items since `contains(sortKey, childSortRangeType)` might
                // catch the sort range type in a string key attribute.
                if (filter.sortRangeType.includes("#")) {
                    throw new UnimplementedError(
                        "Child sort range support isn’t implemented for filters in `expensiveScan()`",
                    );
                }

                const sortRangeDescription =
                    partitionDescription.sortRangeByType[filter.sortRangeType];
                assert(sortRangeDescription, "Invalid sort range");

                const hasSortKeyAttributes =
                    Object.keys(sortRangeDescription.sortKeyAttributeByKey).length > 0;

                const partitionTypeString = filterCompilationContext.addVariable(
                    `${filter.partitionType}${dynamoKeySeparator}`,
                );
                const sortRangeTypeString = filterCompilationContext.addVariable(
                    hasSortKeyAttributes
                        ? `${sortRangeDescription.orderKey}${dynamoKeySeparator}${filter.sortRangeType}${dynamoKeySeparator}`
                        : `${sortRangeDescription.orderKey}${dynamoKeySeparator}${filter.sortRangeType}`,
                );

                return `begins_with(partitionKey, ${partitionTypeString}) and ${
                    hasSortKeyAttributes
                        ? `begins_with(sortKey, ${sortRangeTypeString})`
                        : `sortKey = ${sortRangeTypeString}`
                }`;
            });

            filterExpressionString =
                filterExpressionStrings.length !== 1
                    ? filterExpressionStrings
                          .map(filterExpressionString => `(${filterExpressionString})`)
                          .join(" or ")
                    : filterExpressionStrings[0]!;
        }

        const iterator = client.expensiveScan(context.tracer.getTracer(), {
            tableName: this._name,
            consistency,
            limit,
            segment: segmentIndex,
            totalSegments: totalSegmentCount,
            filterExpression: filterExpressionString,
            expressionAttributeValues: new Map(filterCompilationContext.iterateVariables()),
            expressionAttributeNames: new Map(filterCompilationContext.iterateAttributeNames()),
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            const item: any = {};

            const attributesSchema = this._deserializeItemKeyInto(
                serializedItem.partitionKey,
                serializedItem.sortKey,
                item,
            );

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
     * Same as `expensiveScan()` except we return a `DynamoItem` object. Currently
     * this is only used by `DynamoGeneralRealtimeTableSchema`. In the future,
     * however, we may use `DynamoItem` for all `expensiveScan()` calls from
     * `DynamoTableSchema` too! Since it's core feature (keeping track of
     * `oldItem`) is useful for `directlyUpdateItem()` calls which need the old
     * item's `updateLockVersion`.
     */
    public async *_expensiveScanWithOldItems(
        context: DynamoContext,
        {
            limit,
            consistency = "Eventual",
            segmentIndex,
            totalSegmentCount,
            filter,
        }: {
            limit?: number;
            consistency?: DynamoReadConsistency;
            segmentIndex?: number;
            totalSegmentCount?: number;
            filter?: Types["ItemType"] | Array<Types["ItemType"]>;
        } = {},
    ): AsyncIterableIterator<DynamoItem<MergeObjectIntersection<Types["Item"]>>> {
        const client = await this._getClient(context, false);

        const filterCompilationContext = DynamoConditionExpressionCompilationContext.new();
        let filterExpressionString: string | undefined;

        if (filter) {
            const filters = Array.isArray(filter) ? filter : [filter];

            const filterExpressionStrings = filters.map(filter => {
                assert(
                    this._initializationState.isInitialized,
                    "Schema has not finished initializing",
                );

                const partitionDescription =
                    this._initializationState.description.partitionByType[filter.partitionType];
                assert(partitionDescription, "Invalid partition");

                // NOTE(calebmer): There's no reason we couldn't support a child sort range
                // here. We just haven't needed it yet. To support we'd need to use the
                // `contains(sortKey, childSortRangeType)` DynamoDB filter expression with the
                // child sort range and we'd probably also need to double check the filter when
                // iterating over items since `contains(sortKey, childSortRangeType)` might
                // catch the sort range type in a string key attribute.
                if (filter.sortRangeType.includes("#")) {
                    throw new UnimplementedError(
                        "Child sort range support isn’t implemented for filters in `expensiveScan()`",
                    );
                }

                const sortRangeDescription =
                    partitionDescription.sortRangeByType[filter.sortRangeType];
                assert(sortRangeDescription, "Invalid sort range");

                const hasSortKeyAttributes =
                    Object.keys(sortRangeDescription.sortKeyAttributeByKey).length > 0;

                const partitionTypeString = filterCompilationContext.addVariable(
                    `${filter.partitionType}${dynamoKeySeparator}`,
                );
                const sortRangeTypeString = filterCompilationContext.addVariable(
                    hasSortKeyAttributes
                        ? `${sortRangeDescription.orderKey}${dynamoKeySeparator}${filter.sortRangeType}${dynamoKeySeparator}`
                        : `${sortRangeDescription.orderKey}${dynamoKeySeparator}${filter.sortRangeType}`,
                );

                return `begins_with(partitionKey, ${partitionTypeString}) and ${
                    hasSortKeyAttributes
                        ? `begins_with(sortKey, ${sortRangeTypeString})`
                        : `sortKey = ${sortRangeTypeString}`
                }`;
            });

            filterExpressionString =
                filterExpressionStrings.length !== 1
                    ? filterExpressionStrings
                          .map(filterExpressionString => `(${filterExpressionString})`)
                          .join(" or ")
                    : filterExpressionStrings[0]!;
        }

        const iterator = client.expensiveScan(context.tracer.getTracer(), {
            tableName: this._name,
            consistency,
            limit,
            segment: segmentIndex,
            totalSegments: totalSegmentCount,
            filterExpression: filterExpressionString,
            expressionAttributeValues: new Map(filterCompilationContext.iterateVariables()),
            expressionAttributeNames: new Map(filterCompilationContext.iterateAttributeNames()),
        });

        for await (const serializedItem of iterator) {
            assert(typeof serializedItem.partitionKey === "string");
            assert(typeof serializedItem.sortKey === "string");

            // @ts-expect-error: `DynamoItem` has a private constructor but it's intended
            // to be used here.
            const item: any = new DynamoItem();

            const attributesSchema = this._deserializeItemKeyInto(
                serializedItem.partitionKey,
                serializedItem.sortKey,
                item,
            );

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
     * - This method only supports `KEYS_ONLY` index attribute projections. You may
     *   use `addExpensiveFullIndex()` if you want an `ALL` attribute projection.
     *   Be careful since an `ALL` attribute projection doubles storage costs for
     *   items in the index! We don't support an `INCLUDE` attribute projection for
     *   now because it means we couldn’t overload multiple logical indexes onto
     *   one physical index.
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
        PartitionKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
        SortKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
    >(
        config: DynamoTableSchemaIndexConfigOptions<
            Types,
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >,
    ): DynamoTableSchemaIndex<
        Types["ItemKey"] & ItemTypes,
        Types["ItemKey"] & ItemTypes,
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        const indexConfig = this._defineIndex<
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >({
            ...config,
            projection: "KeysOnly",
        });

        const schema = this;

        return {
            partitionKeyAttributes: config.partitionKeyAttributes as any,
            sortKeyAttributes: config.sortKeyAttributes as any,

            serializeOpaquePartitionKey: partitionKey =>
                this._serializeOpaqueIndexPartitionKey(indexConfig, partitionKey),
            deserializeOpaquePartitionKey: partitionKey =>
                this._deserializeOpaqueIndexPartitionKey(indexConfig, partitionKey) as any,
            serializeOpaqueCursor: itemKey =>
                this._serializeOpaqueIndexCursor(indexConfig, itemKey),
            deserializeOpaqueCursor: (partitionKey, cursor) =>
                this._deserializeOpaqueIndexCursor(indexConfig, partitionKey, cursor),
            serializeOpaqueCursorBound: (itemKey, boundType) =>
                this._serializeOpaqueIndexCursorBound(indexConfig, itemKey, boundType),

            async *query(
                context,
                {
                    partitionKey,
                    startSortKey,
                    endSortKey,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    afterItemKey,
                    limit,
                    pageLimit,
                    descending,
                    allowsEventualReadConsistency = false,
                },
            ) {
                assert(schema._initializationState.isInitialized);
                const indexDescription =
                    schema._initializationState.description.indexes[indexConfig.indexNumber - 1]!;

                const client = await schema._getClient(context, false);

                const serializedPartitionKey =
                    indexDescription.partitionKeyBehavior.type === "Reused"
                        ? schema._serializePartitionKey({
                              ...partitionKey,
                              partitionType: indexDescription.partitionKeyBehavior.partitionType,
                          })
                        : schema._serializeIndexPartitionKey(
                              indexConfig,
                              indexDescription,
                              partitionKey,
                          );

                const serializedStartSortKey = startSortKey
                    ? schema._serializeIndexSortKeyBoundWithoutPrimaryKey(
                          indexConfig,
                          startSortKey,
                          isStartSortKeyExclusive ? "StartExclusive" : "StartInclusive",
                      )
                    : undefined;
                const serializedEndSortKey = endSortKey
                    ? schema._serializeIndexSortKeyBoundWithoutPrimaryKey(
                          indexConfig,
                          endSortKey,
                          isEndSortKeyExclusive ? "EndExclusive" : "EndInclusive",
                      )
                    : undefined;

                const partitionKeyAttributeName =
                    indexDescription.partitionKeyBehavior.type === "Reused"
                        ? "partitionKey"
                        : `index${indexConfig.indexNumber}PartitionKey`;

                const sortKeyAttributeName = `index${indexConfig.indexNumber}SortKey`;

                let lastEvaluatedKey: SchemaSerializedObjectValue | undefined;
                if (afterItemKey) {
                    const serializedAfterPrimaryKey = schema._serializeItemKey(afterItemKey);

                    const serializedAfterPartitionKey =
                        indexDescription.partitionKeyBehavior.type === "Reused"
                            ? serializedAfterPrimaryKey.partitionKey
                            : schema._serializeIndexPartitionKey(
                                  indexConfig,
                                  indexDescription,
                                  afterItemKey,
                              );

                    const serializedAfterSortKey = schema._serializeItemIndexSortKey(
                        indexConfig,
                        afterItemKey,
                    );

                    lastEvaluatedKey = {
                        partitionKey: serializedAfterPrimaryKey.partitionKey,
                        sortKey: serializedAfterPrimaryKey.sortKey,
                        [partitionKeyAttributeName]: serializedAfterPartitionKey,
                        [sortKeyAttributeName]: serializedAfterSortKey,
                    };
                }

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
                    lastEvaluatedKey,
                    consistency: "Eventual",
                    limit: limit !== "All" ? limit : undefined,
                    pageLimit,
                    descending,
                    expectsStrongReadConsistency:
                        !allowsEventualReadConsistency &&
                        getDynamoExpectsStrongReadConsistency(context),
                    debugIndexName: indexConfig.name,
                    debugItemTypes: config.itemTypes.map(itemType => ({
                        tableName: schema._name,
                        partitionType: itemType.partitionType,
                        sortRangeType: itemType.sortRangeType,
                    })),
                });

                for await (const serializedItem of iterator) {
                    assert(typeof serializedItem.partitionKey === "string");
                    assert(typeof serializedItem.sortKey === "string");

                    const indexPartitionKey = serializedItem[partitionKeyAttributeName];
                    const indexSortKey = serializedItem[sortKeyAttributeName];
                    assert(typeof indexPartitionKey === "string");
                    assert(typeof indexSortKey === "string");

                    const item: any = {};

                    schema._deserializeItemKeyInto(
                        serializedItem.partitionKey,
                        serializedItem.sortKey,
                        item,
                    );

                    schema._deserializeIndexKeyInto(
                        indexConfig,
                        indexDescription,
                        indexPartitionKey,
                        indexSortKey,
                        item,
                    );

                    yield item;
                }
            },
        };
    }

    /**
     * Adds an index to the table that projects the entire item into the index
     * instead of just the item's keys. This is labeled as expensive than
     * `addIndex()` since it doubles the storage cost of items in the index! Only
     * use when you're absolutely sure it makes sense for your workload.
     *
     * See `addIndex()` for more documentation on this function.
     */
    public addExpensiveFullIndex<
        ItemTypes extends Types["ItemType"],
        PartitionKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
        SortKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
    >(
        config: DynamoTableSchemaIndexConfigOptions<
            Types,
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >,
    ): DynamoTableSchemaIndex<
        Types["Item"] & ItemTypes,
        Types["ItemKey"] & ItemTypes,
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        const indexConfig = this._defineIndex<
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >({
            ...config,
            projection: "All",
        });

        const schema = this;

        return {
            partitionKeyAttributes: config.partitionKeyAttributes as any,
            sortKeyAttributes: config.sortKeyAttributes as any,

            serializeOpaquePartitionKey: partitionKey =>
                this._serializeOpaqueIndexPartitionKey(indexConfig, partitionKey),
            deserializeOpaquePartitionKey: partitionKey =>
                this._deserializeOpaqueIndexPartitionKey(indexConfig, partitionKey) as any,
            serializeOpaqueCursor: itemKey =>
                this._serializeOpaqueIndexCursor(indexConfig, itemKey),
            deserializeOpaqueCursor: (partitionKey, cursor) =>
                this._deserializeOpaqueIndexCursor(indexConfig, partitionKey, cursor),
            serializeOpaqueCursorBound: (itemKey, boundType) =>
                this._serializeOpaqueIndexCursorBound(indexConfig, itemKey, boundType),

            async *query(
                context,
                {
                    partitionKey,
                    startSortKey,
                    endSortKey,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    afterItemKey,
                    limit,
                    pageLimit,
                    descending,
                    allowsEventualReadConsistency = false,
                },
            ) {
                assert(schema._initializationState.isInitialized);
                const indexDescription =
                    schema._initializationState.description.indexes[indexConfig.indexNumber - 1]!;

                const client = await schema._getClient(context, false);

                const serializedPartitionKey =
                    indexDescription.partitionKeyBehavior.type === "Reused"
                        ? schema._serializePartitionKey({
                              ...partitionKey,
                              partitionType: indexDescription.partitionKeyBehavior.partitionType,
                          })
                        : schema._serializeIndexPartitionKey(
                              indexConfig,
                              indexDescription,
                              partitionKey,
                          );

                const serializedStartSortKey = startSortKey
                    ? schema._serializeIndexSortKeyBoundWithoutPrimaryKey(
                          indexConfig,
                          startSortKey,
                          isStartSortKeyExclusive ? "StartExclusive" : "StartInclusive",
                      )
                    : undefined;
                const serializedEndSortKey = endSortKey
                    ? schema._serializeIndexSortKeyBoundWithoutPrimaryKey(
                          indexConfig,
                          endSortKey,
                          isEndSortKeyExclusive ? "EndExclusive" : "EndInclusive",
                      )
                    : undefined;

                const partitionKeyAttributeName =
                    indexDescription.partitionKeyBehavior.type === "Reused"
                        ? "partitionKey"
                        : `index${indexConfig.indexNumber}PartitionKey`;

                const sortKeyAttributeName = `index${indexConfig.indexNumber}SortKey`;

                let lastEvaluatedKey: SchemaSerializedObjectValue | undefined;
                if (afterItemKey) {
                    const serializedAfterPrimaryKey = schema._serializeItemKey(afterItemKey);

                    const serializedAfterPartitionKey =
                        indexDescription.partitionKeyBehavior.type === "Reused"
                            ? serializedAfterPrimaryKey.partitionKey
                            : schema._serializeIndexPartitionKey(
                                  indexConfig,
                                  indexDescription,
                                  afterItemKey,
                              );

                    const serializedAfterSortKey = schema._serializeItemIndexSortKey(
                        indexConfig,
                        afterItemKey,
                    );

                    lastEvaluatedKey = {
                        partitionKey: serializedAfterPrimaryKey.partitionKey,
                        sortKey: serializedAfterPrimaryKey.sortKey,
                        [partitionKeyAttributeName]: serializedAfterPartitionKey,
                        [sortKeyAttributeName]: serializedAfterSortKey,
                    };
                }

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
                    lastEvaluatedKey,
                    consistency: "Eventual",
                    limit: limit !== "All" ? limit : undefined,
                    pageLimit,
                    descending,
                    expectsStrongReadConsistency:
                        !allowsEventualReadConsistency &&
                        getDynamoExpectsStrongReadConsistency(context),
                    debugIndexName: indexConfig.name,
                    debugItemTypes: config.itemTypes.map(itemType => ({
                        tableName: schema._name,
                        partitionType: itemType.partitionType,
                        sortRangeType: itemType.sortRangeType,
                    })),
                });

                for await (const serializedItem of iterator) {
                    assert(typeof serializedItem.partitionKey === "string");
                    assert(typeof serializedItem.sortKey === "string");

                    const indexPartitionKey = serializedItem[partitionKeyAttributeName];
                    const indexSortKey = serializedItem[sortKeyAttributeName];
                    assert(typeof indexPartitionKey === "string");
                    assert(typeof indexSortKey === "string");

                    const item: any = {};

                    const attributesSchema = schema._deserializeItemKeyInto(
                        serializedItem.partitionKey,
                        serializedItem.sortKey,
                        item,
                    );

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

                    schema._deserializeIndexKeyInto(
                        indexConfig,
                        indexDescription,
                        indexPartitionKey,
                        indexSortKey,
                        item,
                    );

                    yield item;
                }
            },
        };
    }

    private _defineIndex<
        ItemTypes extends Types["ItemType"],
        PartitionKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
        SortKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
            Types,
            ItemTypes
        >,
    >({
        name,
        itemTypes,
        partitionKeyAttributes,
        sortKeyAttributes,
        includePrimaryKeyInSortKey = false,
        projection,
        filter,
    }: DynamoTableSchemaIndexConfigOptions<
        Types,
        ItemTypes,
        PartitionKeyAttributesConfig,
        SortKeyAttributesConfig
    > & {
        projection: "KeysOnly" | "All";
    }): DynamoTableSchemaIndexConfig {
        assert(
            !this._initializationState.isInitialized,
            "Can not add indexes after schema has finished initializing",
        );

        assert(
            !this._partitionConfigByName.has(name),
            "Index should not have the same name as a partition",
        );

        for (const indexDescription of this._initializationState.indexDescriptions) {
            for (const indexOverloadName of Object.keys(indexDescription.overloadByName)) {
                assert(name !== indexOverloadName, "Index names must be unique within a table");
            }
        }

        const itemTypeSet = new Set<string>();
        const partitionTypeSet = new Set<string>();
        let canReusePartitionKey = true;

        for (const {partitionType, sortRangeType} of itemTypes) {
            const partitionConfig = this._partitionConfigByName.get(partitionType);
            assert(partitionConfig, "Invalid partition");

            // NOTE(calebmer): There's no reason we couldn't support a child sort range
            // here. We just haven't needed it yet. To support we'd need to look at the
            // child sort range's attributes instead of `sortRangeConfig.attributes`.
            if (sortRangeType.includes("#")) {
                throw new UnimplementedError(
                    "Child sort range support isn’t implemented for `addIndex()`",
                );
            }

            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeType);
            assert(sortRangeConfig, "Invalid sort range");

            const itemType = `${partitionType}#${sortRangeType}`;

            assert(!itemTypeSet.has(itemType), "Item types must be unique");
            itemTypeSet.add(itemType);
            partitionTypeSet.add(partitionType);

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

            canReusePartitionKey &&=
                isDeepEqual(
                    Object.keys(partitionKeyAttributes),
                    Object.keys(partitionConfig.partitionKeyAttributes),
                ) &&
                Object.entries(partitionKeyAttributes).every(([key, keyAttribute]) =>
                    isDeepEqual(
                        keyAttribute.description,
                        partitionConfig.partitionKeyAttributes[key]!.description,
                    ),
                );
        }

        // Can only reuse the partition key if only one type of partition is
        // represented in the index.
        canReusePartitionKey &&= partitionTypeSet.size === 1;

        const indexOverloadDescription: DynamoTableSchemaTypes.Index.OverloadDescription & {
            readonly canReusePartitionKey: boolean;
        } = {
            itemTypes,
            partitionKeyAttributeByKey: mapObjectValues(
                partitionKeyAttributes,
                keyAttribute => keyAttribute!.description,
            ),
            sortKeyAttributeByKey: mapObjectValues(
                sortKeyAttributes,
                keyAttribute => keyAttribute!.description,
            ),
            canReusePartitionKey,
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
            const targetPartitionTypeSet = new Set<string>();

            // Can’t reuse a physical index with a different projection.
            if (targetIndexDescription.projection !== projection) continue;

            let targetCanReusePartitionKey = true;

            for (const targetIndexOverloadDescription of Object.values(
                targetIndexDescription.overloadByName,
            )) {
                targetCanReusePartitionKey &&= targetIndexOverloadDescription.canReusePartitionKey;

                for (const {
                    partitionType,
                    sortRangeType,
                } of targetIndexOverloadDescription.itemTypes) {
                    targetItemTypeSet.add(`${partitionType}#${sortRangeType}`);
                    targetPartitionTypeSet.add(partitionType);
                }
            }

            if (
                iterableEvery(itemTypeSet, itemType => !targetItemTypeSet.has(itemType)) &&
                // Can only reuse an index if we have the same reuse partition key setting AND
                // the index is for the same partition type as us.
                canReusePartitionKey === targetCanReusePartitionKey &&
                (!canReusePartitionKey ||
                    iterableEvery(partitionTypeSet, partitionType =>
                        targetPartitionTypeSet.has(partitionType),
                    ))
            ) {
                targetIndexDescription.overloadByName[name] = indexOverloadDescription;
                addedToIndexNumber = targetIndexNumber;
                break;
            }
        }

        // Create a new physical index if we couldn’t overload an existing
        // physical index.
        if (addedToIndexNumber === null) {
            addedToIndexNumber = this._initializationState.indexDescriptions.length + 1;
            this._initializationState.indexDescriptions.push({
                projection,
                overloadByName: {[name]: indexOverloadDescription},
            });
        }

        const indexConfig: DynamoTableSchemaIndexConfig = {
            indexNumber: addedToIndexNumber,
            name,
            partitionKeyAttributes:
                partitionKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
            sortKeyAttributes: sortKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
            includePrimaryKeyInSortKey,
            projection,
            filter: filter ?? null,
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

        if (recording) {
            getOrSetDefaultMapValue(
                recording.indexNamesByTableName,
                this._name,
                () => new Set(),
            ).add(`Index${indexConfig.indexNumber}`);
        }

        return indexConfig;
    }

    private _serializeIndexPartitionKey(
        indexConfig: DynamoTableSchemaIndexConfig,
        indexDescription: DynamoTableSchemaTypes.Index.Description,
        item: {[key: string]: unknown},
    ) {
        // Should handle reused partition keys in the caller of this function.
        assert(indexDescription.partitionKeyBehavior.type !== "Reused");

        const indexPartitionKeyEntries = [indexConfig.name];
        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.partitionKeyAttributes,
        )) {
            const attributeValue = item[attributeKey];
            indexPartitionKeyEntries.push(attributeSchema.serialize(attributeValue));
        }

        return indexPartitionKeyEntries.join(dynamoKeySeparator);
    }

    private _serializeIndexSortKeyBoundWithoutPrimaryKey(
        indexConfig: DynamoTableSchemaIndexConfig,
        item: {[key: string]: unknown},
        boundType: "StartExclusive" | "StartInclusive" | "EndExclusive" | "EndInclusive",
    ) {
        const itemSortKeyEntries = [];
        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            const attributeValue = item[attributeKey];
            itemSortKeyEntries.push(attributeSchema.serialize(attributeValue));
        }

        const key = itemSortKeyEntries.join(dynamoKeySeparator);

        // If we are not including the primary key in our sort key then we can ignore
        // `boundType` since the operator we use on the query will do all the work.
        if (!indexConfig.includePrimaryKeyInSortKey) return key;

        // So here we are serializing the bound of an index query. The index sort key
        // contains the primary key but we do not know the primary key here, only the
        // declared index sort key. In practice, the index sort key will always be
        // followed by the partition type identifier (ASCII alphanumeric string).
        //
        // To figure out the return for each of these cases we need to think about how
        // the key will be used as a bounds check in the presence of a longer key that
        // includes the primary key.
        switch (boundType) {
            // `"${key}#${partitionType}" < "${key}~"` is true. We correctly exclude items
            // before `key`.
            //
            // This works since `~` is larger than `#`. `~` should not conflict with key
            // attribute values since it is compared against the `#` separator character.
            case "StartExclusive": {
                return key + "~";
            }
            // `"${key}" < "${key}#${partitionType}"` is true. We correctly include items
            // that start with `key`.
            case "StartInclusive": {
                return key;
            }
            // `"${key}" > "${key}#${partitionType}"` is true. We correctly include items
            // that start with `key`.
            case "EndExclusive": {
                return key;
            }
            // `"${key}#${partitionType}" < "${key}~"` is true. We correctly exclude items
            // that start with `key`.
            //
            // This works since `~` is larger than `#`. `~` should not conflict with key
            // attribute values since it is compared against the `#` separator character.
            case "EndInclusive": {
                return key + "~";
            }
            default:
                throw exhaustive(boundType);
        }
    }

    /**
     * Serializes the index sort key for a full DynamoDB item. The sort key for a
     * full DynamoDB item sometimes includes the primary key to help sort index
     * items in a well understood way (instead of relying on undocumented
     * DynamoDB internals).
     */
    private _serializeItemIndexSortKey(
        indexConfig: DynamoTableSchemaIndexConfig,
        item: {[key: string]: unknown},
    ) {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        assert(typeof item.partitionType === "string");
        assert(typeof item.sortRangeType === "string");
        const partitionConfig = this._partitionConfigByName.get(item.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[item.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(item.sortRangeType);
        const sortRangeDescription = partitionDescription.sortRangeByType[item.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        const sortKeyEntries = [];
        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            const attributeValue = item[attributeKey];
            sortKeyEntries.push(attributeSchema.serialize(attributeValue));
        }

        // If this index sort key includes the primary key then add any attributes not
        // in our index key already to the sort key.
        if (indexConfig.includePrimaryKeyInSortKey) {
            sortKeyEntries.push(item.partitionType);
            for (const [attributeKey, attributeSchema] of Object.entries(
                partitionConfig.partitionKeyAttributes,
            )) {
                if (
                    !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                    !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
                ) {
                    sortKeyEntries.push(attributeSchema.serialize(item[attributeKey]));
                }
            }

            sortKeyEntries.push(sortRangeDescription.orderKey);
            sortKeyEntries.push(item.sortRangeType);
            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                if (
                    !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                    !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
                ) {
                    sortKeyEntries.push(attributeSchema.serialize(item[attributeKey]));
                }
            }
        }

        // Sort keys may not be empty. If we have no sort key attributes then only
        // return `!` as the sort key. We use `!` since it's less than all valid
        // DynamoDB attribute characters.
        if (sortKeyEntries.length === 0) {
            return "!";
        }

        return sortKeyEntries.join(dynamoKeySeparator);
    }

    private _deserializeIndexKeyInto(
        indexConfig: DynamoTableSchemaIndexConfig,
        indexDescription: DynamoTableSchemaTypes.Index.Description,
        partitionKey: string,
        sortKey: string,
        key: any,
    ) {
        // The main `partitionKey` should be deserialized by the caller to this function.
        if (indexDescription.partitionKeyBehavior.type !== "Reused") {
            const partitionKeyEntries = partitionKey.split(dynamoKeySeparator);

            const indexName = partitionKeyEntries[0];
            assert(indexName === indexConfig.name, "Invalid index partition key");

            let partitionKeyEntryIndex = 1;
            for (const [attributeKey, attributeSchema] of Object.entries(
                indexConfig.partitionKeyAttributes,
            )) {
                const partitionKeyEntry = partitionKeyEntries[partitionKeyEntryIndex++];
                assert(partitionKeyEntry !== undefined, "Invalid index partition key");
                key[attributeKey] = attributeSchema.deserialize(
                    partitionKeyEntry as DynamoKeyAttribute,
                );
            }
        }

        const sortKeyEntries = sortKey.split(dynamoKeySeparator);

        let sortKeyEntryIndex = 0;
        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            const sortKeyEntry = sortKeyEntries[sortKeyEntryIndex++];
            assert(sortKeyEntry !== undefined, "Invalid index sort key");
            key[attributeKey] = attributeSchema.deserialize(sortKeyEntry as DynamoKeyAttribute);
        }

        return key;
    }

    private _serializeOpaqueIndexPartitionKey(
        indexConfig: DynamoTableSchemaIndexConfig,
        partitionKey: {[key: string]: unknown},
    ): DynamoIndexPartitionKey {
        let totalByteCount = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.partitionKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            totalByteCount += attributeSchema.binary.getByteCount(partitionKey[attributeKey]);
        }

        const bytes = new Uint8Array(totalByteCount);
        let bytesIndex = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.partitionKeyAttributes,
        )) {
            const attributeValue = partitionKey[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, bytesIndex);
            bytesIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        const partitionKeyString = encodeBase64(
            bytes,
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoIndexPartitionKey;

        // In development and test environments, make sure we can deserialize our
        // opaque keys.
        if (process.env.NODE_ENV !== "production") {
            const deserializedKey = this._deserializeOpaqueIndexPartitionKey(
                indexConfig,
                partitionKeyString,
            );
            assert(
                isDeepEqual(
                    pickObject(partitionKey, Object.keys(deserializedKey)),
                    deserializedKey,
                ),
                "Couldn’t deserialize opaque item key",
            );
        }

        return partitionKeyString;
    }

    private _deserializeOpaqueIndexPartitionKey(
        indexConfig: DynamoTableSchemaIndexConfig,
        partitionKeyString: DynamoIndexPartitionKey,
    ): {[key: string]: unknown} {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        try {
            const bytes = decodeBase64(partitionKeyString, "Rfc4648UrlWithOrderPreservation");

            const partitionKey: any = {};
            let bytesIndex = 0;

            for (const [attributeKey, attributeSchema] of Object.entries(
                indexConfig.partitionKeyAttributes,
            )) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }

                const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                bytesIndex += attributeSchema.binary.getByteCount(value);

                partitionKey[attributeKey] = value;
            }

            assert(bytesIndex === bytes.length, "String has more bytes that weren’t used");

            return partitionKey;
        } catch (error) {
            throw InvalidArgumentError.from(error, "Invalid opaque index partition key");
        }
    }

    // NOTE(calebmer): We don't include the index partition key in the cursor! Only
    // the sort key. We use cursors for:
    //
    // 1. Let clients resume pagination from a specific item. A cursor is better to
    //    use than the index sort key alone since it uniquely identifies an item in
    //    the list.
    //
    // 2. When `includePrimaryKeyInSortKey` is enabled you can use cursors to sort
    //    items relative to each other on the client.
    //
    // Both these use cases do not need a partition key. For 1 we should provide
    // the partition key alongside the cursor anyway and for 2 the partition key
    // does not contribute to order.
    private _serializeOpaqueIndexCursor(
        indexConfig: DynamoTableSchemaIndexConfig,
        item: {[key: string]: unknown},
    ): DynamoIndexCursor {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");
        assert(typeof item.partitionType === "string");
        assert(typeof item.sortRangeType === "string");
        const partitionConfig = this._partitionConfigByName.get(item.partitionType);
        const partitionDescription =
            this._initializationState.description.partitionByType[item.partitionType];
        assert(partitionConfig && partitionDescription, "Invalid partition");
        const sortRangeConfig = partitionConfig.sortRangeByName.get(item.sortRangeType);
        const sortRangeDescription = partitionDescription.sortRangeByType[item.sortRangeType];
        assert(sortRangeConfig && sortRangeDescription, "Invalid sort range");

        let totalByteCount = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            const attributeValue = item[attributeKey];
            totalByteCount += attributeSchema.binary.getByteCount(attributeValue);
        }

        // We insert a byte for sorting relative to a bounds cursor which only includes
        // sort key attributes.
        totalByteCount += 1;

        totalByteCount += 1;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            // We need the primary key to be included in our cursor to correctly resume
            // pagination from the right place. But only include attributes from our
            // primary key that are not already included in the index key attributes to
            // avoid duplicating data.
            if (
                !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
            ) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }
                totalByteCount += attributeSchema.binary.getByteCount(item[attributeKey]);
            }
        }

        totalByteCount += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );
        totalByteCount += 1;
        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            // We need the primary key to be included in our cursor to correctly resume
            // pagination from the right place. But only include attributes from our
            // primary key that are not already included in the index key attributes to
            // avoid duplicating data.
            if (
                !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
            ) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }
                totalByteCount += attributeSchema.binary.getByteCount(item[attributeKey]);
            }
        }

        const bytes = new Uint8Array(totalByteCount);
        let byteIndex = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            const attributeValue = item[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
            byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        // We insert a byte for sorting relative to a bounds cursor which only includes
        // sort key attributes.
        bytes[byteIndex++] = 1;

        bytes[byteIndex++] = partitionDescription.id;
        for (const [attributeKey, attributeSchema] of Object.entries(
            partitionConfig.partitionKeyAttributes,
        )) {
            // We need the primary key to be included in our cursor to correctly resume
            // pagination from the right place. But only include attributes from our
            // primary key that are not already included in the index key attributes to
            // avoid duplicating data.
            if (
                !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
            ) {
                const attributeValue = item[attributeKey];
                attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
                byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
            }
        }

        DynamoKeyAttributeSchema.orderKey.binary!.serializeBytes(
            sortRangeDescription.orderKey,
            bytes,
            byteIndex,
        );
        byteIndex += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(
            sortRangeDescription.orderKey,
        );

        bytes[byteIndex++] = sortRangeDescription.id;

        for (const [attributeKey, attributeSchema] of Object.entries(
            sortRangeConfig.sortKeyAttributes,
        )) {
            // We need the primary key to be included in our cursor to correctly resume
            // pagination from the right place. But only include attributes from our
            // primary key that are not already included in the index key attributes to
            // avoid duplicating data.
            if (
                !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
            ) {
                const attributeValue = item[attributeKey];
                attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
                byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
            }
        }

        const opaqueString = encodeBase64(
            bytes,
            "Rfc4648UrlWithOrderPreservation",
        ) as DynamoIndexCursor;

        // In development and test environments, make sure we can deserialize our
        // opaque keys.
        if (process.env.NODE_ENV !== "production") {
            const deserializedKey = this._deserializeOpaqueIndexCursor(
                indexConfig,
                item,
                opaqueString,
            );
            assert(
                isDeepEqual(pickObject(item, Object.keys(deserializedKey)), deserializedKey),
                "Couldn’t deserialize opaque index cursor",
            );
        }

        return opaqueString;
    }

    private _deserializeOpaqueIndexCursor(
        indexConfig: DynamoTableSchemaIndexConfig,
        partitionKey: {[key: string]: any},
        opaqueString: DynamoIndexCursor,
    ) {
        assert(this._initializationState.isInitialized, "Schema has not finished initializing");

        try {
            const bytes = decodeBase64(opaqueString, "Rfc4648UrlWithOrderPreservation");

            const key: any = {};
            let bytesIndex = 0;

            // Copy index partition key attributes to the key object we're deserializing.
            for (const attributeKey of Object.keys(indexConfig.partitionKeyAttributes)) {
                key[attributeKey] = partitionKey[attributeKey];
            }

            for (const [attributeKey, attributeSchema] of Object.entries(
                indexConfig.sortKeyAttributes,
            )) {
                if (!attributeSchema.binary) {
                    throw new UnimplementedError(
                        quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                    );
                }

                const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                bytesIndex += attributeSchema.binary.getByteCount(value);

                key[attributeKey] = value;
            }

            assert(bytes[bytesIndex++]! === 1, "Expected byte after index attributes");

            const partitionNames = this._initializationState.partitionNamesById.get(
                bytes[bytesIndex++]!,
            );
            assert(partitionNames, "Invalid partition key");

            const partitionConfig = this._partitionConfigByName.get(partitionNames.partitionName);
            const partitionDescription =
                this._initializationState.description.partitionByType[partitionNames.partitionName];
            assert(partitionConfig && partitionDescription, "Invalid partition key");

            key.partitionType = partitionNames.partitionName;

            for (const [attributeKey, attributeSchema] of Object.entries(
                partitionConfig.partitionKeyAttributes,
            )) {
                // We need the primary key to be included in our cursor to correctly resume
                // pagination from the right place. But only include attributes from our
                // primary key that are not already included in the index key attributes to
                // avoid duplicating data.
                if (
                    !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                    !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
                ) {
                    if (!attributeSchema.binary) {
                        throw new UnimplementedError(
                            quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                        );
                    }

                    const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                    bytesIndex += attributeSchema.binary.getByteCount(value);

                    key[attributeKey] = value;
                }
            }

            const orderKey = DynamoKeyAttributeSchema.orderKey.binary!.deserializeBytes(
                bytes,
                bytesIndex,
            );
            bytesIndex += DynamoKeyAttributeSchema.orderKey.binary!.getByteCount(orderKey);

            const sortRangeName = partitionNames.sortRangeNameById.get(bytes[bytesIndex++]!);
            assert(sortRangeName, "Invalid sort key");

            const sortRangeConfig = partitionConfig.sortRangeByName.get(sortRangeName);
            const sortRangeDescription = partitionDescription.sortRangeByType[sortRangeName];
            assert(sortRangeConfig && sortRangeDescription, "Invalid sort key");

            assert(orderKey === sortRangeDescription.orderKey, "Invalid sort key");

            key.sortRangeType = sortRangeName;

            for (const [attributeKey, attributeSchema] of Object.entries(
                sortRangeConfig.sortKeyAttributes,
            )) {
                // We need the primary key to be included in our cursor to correctly resume
                // pagination from the right place. But only include attributes from our
                // primary key that are not already included in the index key attributes to
                // avoid duplicating data.
                if (
                    !hasOwnProperty(indexConfig.partitionKeyAttributes, attributeKey) &&
                    !hasOwnProperty(indexConfig.sortKeyAttributes, attributeKey)
                ) {
                    if (!attributeSchema.binary) {
                        throw new UnimplementedError(
                            quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                        );
                    }

                    const value = attributeSchema.binary.deserializeBytes(bytes, bytesIndex);
                    bytesIndex += attributeSchema.binary.getByteCount(value);

                    key[attributeKey] = value;
                }
            }

            assert(bytesIndex === bytes.length, "String has more bytes that weren’t used");

            return key;
        } catch (error) {
            throw InvalidArgumentError.from(error, "Invalid opaque index cursor");
        }
    }

    private _serializeOpaqueIndexCursorBound(
        indexConfig: DynamoTableSchemaIndexConfig,
        item: {[key: string]: unknown},
        boundType: "StartExclusive" | "StartInclusive" | "EndExclusive" | "EndInclusive",
    ): string {
        let totalByteCount = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            if (!attributeSchema.binary) {
                throw new UnimplementedError(
                    quote`Can’t use opaque keys unless all item key attributes support binary encoding, ${attributeKey} does not support binary encoding`,
                );
            }
            const attributeValue = item[attributeKey];
            totalByteCount += attributeSchema.binary.getByteCount(attributeValue);
        }

        totalByteCount += 1;

        const bytes = new Uint8Array(totalByteCount);
        let byteIndex = 0;

        for (const [attributeKey, attributeSchema] of Object.entries(
            indexConfig.sortKeyAttributes,
        )) {
            const attributeValue = item[attributeKey];
            attributeSchema.binary!.serializeBytes(attributeValue, bytes, byteIndex);
            byteIndex += attributeSchema.binary!.getByteCount(attributeValue);
        }

        // An opaque cursor includes a byte with value 1 in this spot. So we can
        // include 0 or 2 depending on whether we want to sort above or below cursors
        // with the same index sort key.
        switch (boundType) {
            case "StartExclusive": {
                bytes[byteIndex++] = 2;
                break;
            }
            case "StartInclusive": {
                bytes[byteIndex++] = 0;
                break;
            }
            case "EndExclusive": {
                bytes[byteIndex++] = 0;
                break;
            }
            case "EndInclusive": {
                bytes[byteIndex++] = 2;
                break;
            }
            default:
                throw exhaustive(boundType);
        }

        return encodeBase64(bytes, "Rfc4648UrlWithOrderPreservation");
    }
}

/**
 * An item returned from DynamoDB that keeps track of the `oldItem` originally
 * loaded from the database. Useful if you need the `oldItem` to perform some
 * diffing with the current item.
 */
export type DynamoItem<Item extends object> = Item & DynamoItemClass<Item>;

class DynamoItemClass<Item extends object> {
    /**
     * The item we originally loaded from the database.
     */
    public readonly oldItem: Item | null;

    // Should only be instantiated by the `DynamoTableSchema` class.
    private constructor(oldItem: Item | null = this as any) {
        this.oldItem = oldItem;
    }

    /**
     * Creates a `DynamoItem` with `oldItem` set to `null`.
     */
    public static create<Item extends object>(item: Item) {
        const actualItem = new DynamoItemClass<Item>(null);
        Object.assign(actualItem, item);
        return actualItem as DynamoItem<Item>;
    }

    /**
     * Calls `DynamoItem.create()` if `oldItem` is `null` otherwise calls
     * `DynamoItem.fullUpdate()`.
     */
    public static createOrUpdate<Item extends object>(
        oldItem: DynamoItem<Item> | null,
        item: Item,
    ): DynamoItem<Item> {
        if (oldItem !== null) {
            return oldItem.fullUpdate(item);
        } else {
            return DynamoItem.create(item);
        }
    }

    /**
     * Update the item with some new properties. We copy the existing properties of
     * the item and then override those properties with any new ones from the
     * `Partial<Item>`.
     */
    public update(item: Partial<Item>): DynamoItem<Item> {
        const newItem = new DynamoItem(this.oldItem);

        for (const [key, value] of Object.entries(this)) {
            if (key === "oldItem") continue;
            (newItem as any)[key] = value;
        }

        for (const [key, value] of Object.entries(item)) {
            (newItem as any)[key] = value;
        }

        return newItem as DynamoItem<Item>;
    }

    /**
     * Fully replace all properties in the item.
     *
     * Useful if there are some optional properties in the item you need to get rid
     * of. Though you could also call `update({optionalProperty: undefined})` to
     * override an optional property with `undefined`.
     */
    public fullUpdate(item: Item): DynamoItem<Item> {
        const newItem = new DynamoItem(this.oldItem);

        for (const [key, value] of Object.entries(item)) {
            (newItem as any)[key] = value;
        }

        return newItem as DynamoItem<Item>;
    }
}

// Update the name of `DynamoItemClass` at runtime if code isn't minified.
if (DynamoItemClass.name === "DynamoItemClass") {
    Object.defineProperty(DynamoItemClass, "name", {writable: false, value: "DynamoItem"});
}

// We use this `const DynamoItem = DynamoItemClass` syntax so we can override
// the `DynamoItem` type.
export const DynamoItem = DynamoItemClass;

let constructedDynamoTableSchemaCount = 0;

/**
 * How many DynamoDB table schemas have been created? Can be used with
 * `recordConstructedDynamoTableSchemas()` to make sure you've recorded all
 * constructed DynamoDB table schemas.
 *
 * We can’t add every DynamoDB table schemas ever constructed to an array since
 * the array would grow indefinitely in our Vite dev server which re-evaluates
 * modules whenever they update.
 */
export function getConstructedDynamoTableSchemaCount() {
    return constructedDynamoTableSchemaCount;
}

let recording: {
    tableSchemas: Map<
        string,
        DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
    >;
    indexNamesByTableName: Map<string, Set<string>>;
} | null = null;

/**
 * Record all DynamoDB table schemas and indexes constructed during the provided
 * action. Doesn't record any DynamoDB table schemas constructed before or
 * after this.
 */
export async function recordConstructedDynamoTableSchemas<Value>(
    action: () => Promise<Value>,
): Promise<
    [
        {
            tableSchemas: Map<
                string,
                DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
            >;
            indexNamesByTableName: Map<string, Set<string>>;
        },
        Value,
    ]
> {
    assert(recording === null);

    const tableSchemas = new Map<
        string,
        DynamoTableSchema<DynamoTableSchemaTypes.Types<DynamoTableSchemaTypes.ConfigBase>>
    >();
    const indexNamesByTableName = new Map<string, Set<string>>();

    let value: Value;
    recording = {tableSchemas, indexNamesByTableName};
    try {
        value = await action();
        finishInitializingDynamoTableSchemas();
    } finally {
        recording = null;
    }

    return [{tableSchemas, indexNamesByTableName}, value];
}

let dynamoTableSchemaInitializationCallbacks: Array<() => void> = [];

/**
 * Finish initializing all our `DynamoTableSchema`s immediately instead of
 * waiting for a microtask callback.
 */
export function finishInitializingDynamoTableSchemas() {
    assert(
        dynamoTableSchemaInitializationCallbacks !== null,
        "DynamoDB schemas already initialized",
    );
    const callbacks = dynamoTableSchemaInitializationCallbacks;
    dynamoTableSchemaInitializationCallbacks = [];
    for (const callback of callbacks) callback();
}

export type DynamoTableSchemaIndexKeyAttributesConfigBase<
    Types extends DynamoTableSchemaTypesBase,
    ItemTypes extends Types["ItemType"],
> = {
    [K in keyof Extract<Types["Item"], ItemTypes>]?: DynamoKeyAttributeSchema<
        Extract<Types["Item"], ItemTypes>[K]
    >;
};

export type DynamoTableSchemaIndexKeyAttributesType<
    KeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<any, any>,
> = DynamoTableSchemaTypes.KeyAttributes.Type<{
    [K in keyof KeyAttributesConfig]: NonNullable<KeyAttributesConfig[K]>;
}>;

export type DynamoTableSchemaIndexConfigOptions<
    Types extends DynamoTableSchemaTypesBase,
    ItemTypes extends Types["ItemType"],
    PartitionKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<
        Types,
        ItemTypes
    >,
    SortKeyAttributesConfig extends DynamoTableSchemaIndexKeyAttributesConfigBase<Types, ItemTypes>,
> = {
    name: string;
    itemTypes: ReadonlyArray<ItemTypes>;
    partitionKeyAttributes: PartitionKeyAttributesConfig;
    sortKeyAttributes: SortKeyAttributesConfig;

    /**
     * Filter some items out of the index. When you query the index, items that
     * returned false from this function will not be available. If this function is
     * not defined then all items are included in the index.
     *
     * By default, only items that match `itemTypes` are included in the index.
     * This function lets you go a step further and filter out items that match the
     * expected item type.
     *
     * We apply the filter at serialization time so it can only depend on the item.
     * It can’t depend on external state such as the current time since if that
     * state changes we won't re-filter the item.
     *
     * Since this is a function we can’t do backwards compatibility checking on it!
     * You'll have to be careful about backwards compatibility when updating this
     * function implementation yourself. Remember since this runs at serialization
     * time, if you change the implementation then existing items in the database
     * won't be re-indexed.
     *
     * In the types, we only allow properties in the item key or index key. This is
     * so we don't break `transactionDirectlyUpdateItemAttribute()`.
     * `transactionDirectlyUpdateItemAttribute()` currently throws if you try to
     * update an attribute in an index key. That's because when updating an
     * attribute in an index key we also need to update the index key. If we could
     * filter based on any property in the item then
     * `transactionDirectlyUpdateItemAttribute()` would have to fail on _all_
     * attribute updates because we don't know which attributes `filter`
     * depends on.
     */
    filter?: (
        item: MergeObjectIntersection<
            Extract<Types["ItemKey"], ItemTypes> &
                DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig> &
                DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
        >,
    ) => boolean;

    /**
     * Include an item's primary key in the index sort key. This makes sure you
     * never have two items with identical index keys. DynamoDB [does not
     * specify][1] how items are sorted when they have the same index key, it's
     * implementation dependent. Including the primary key in the index sort key
     * allows us to sort items in userspace with the same order as the database.
     *
     * If an attribute in the item's primary key is already included in the index
     * key then we don't include it in the sort key.
     *
     * [1]: https://stackoverflow.com/questions/51135606/dynamodb-sorting-order-on-duplicate-global-secondary-indexes
     */
    includePrimaryKeyInSortKey?: boolean;

    // NOTE(calebmer): It may be useful to add computed index attributes in the
    // future. Where instead of relying on an attribute to exist in all item types
    // you provide a function to compute the attribute from item types. In fact I
    // thought I'd need this when implementing notifications so I built it out!
    // Then I settled on a different schema design for notifications and removed
    // computed attributes. My computed attributes implementation had a couple
    // caveats so needed to be used carefully. If we want to add this feature back
    // here is the commit where I removed it:
    //
    // https://github.com/cyberworlds/cyberworlds/commit/66f569c9b7aa8757a83d646d38f182b504bb476d
};

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface DynamoTableSchemaIndex<QueryItem, ItemKey, IndexPartitionKey, IndexSortKey> {
    readonly partitionKeyAttributes: {
        readonly [Key in keyof IndexPartitionKey]: DynamoKeyAttributeSchema<IndexPartitionKey[Key]>;
    };

    readonly sortKeyAttributes: {
        readonly [Key in keyof IndexSortKey]: DynamoKeyAttributeSchema<IndexSortKey[Key]>;
    };

    /**
     * Query the index.
     */
    query(
        context: DynamoContext,
        options: {
            partitionKey: IndexPartitionKey;
            startSortKey?: IndexSortKey;
            endSortKey?: IndexSortKey;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            /**
             * Our query will return all values after this item. Behaves the same as
             * `startSortKey` but is more precise since an index can contain multiple items
             * with the same sort key.
             *
             * The item key contains both the key of the item and the index attributes.
             */
            afterItemKey?: MergeObjectIntersection<ItemKey & IndexPartitionKey & IndexSortKey>;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            allowsEventualReadConsistency?: boolean;
        },
    ): AsyncIterableIterator<MergeObjectIntersection<QueryItem & IndexPartitionKey & IndexSortKey>>;

    /**
     * Serialize the index partition key into an opaque string that can be
     * conveniently shared with clients.
     *
     * Remember this data is not secured in any way! If you want to share this with
     * a client then the client should be able to see all data in the item's index
     * partition key.
     */
    serializeOpaquePartitionKey(
        // Allow method to be dereferenced without binding `this`.
        this: void,
        partitionKey: IndexPartitionKey,
    ): DynamoIndexPartitionKey;

    /**
     * Deserialize the index partition key from an opaque string received from the
     * client back to an object containing all of the partition key's properties.
     */
    deserializeOpaquePartitionKey(
        // Allow method to be dereferenced without binding `this`.
        this: void,
        partitionKey: DynamoIndexPartitionKey,
    ): IndexPartitionKey;

    /**
     * Serialize the item key into an opaque string that can be conveniently shared
     * with clients. This item key can be used for resuming pagination with the
     * `afterItemKey` option on `query()`.
     *
     * Remember this data is not secured in any way! If you share this with a
     * client then the client should be able to see all data in the item's index
     * key AND primary key.
     */
    serializeOpaqueCursor(
        // Allow method to be dereferenced without binding `this`.
        this: void,
        itemKey:
            | MergeObjectIntersection<ItemKey & IndexPartitionKey & IndexSortKey>
            | MergeObjectIntersection<QueryItem & IndexPartitionKey & IndexSortKey>,
    ): DynamoIndexCursor;

    /**
     * Deserialize the cursor from our opaque string format that is shared with
     * clients.
     */
    deserializeOpaqueCursor(
        partitionKey: IndexPartitionKey,
        cursor: DynamoIndexCursor,
    ): MergeObjectIntersection<ItemKey & IndexPartitionKey & IndexSortKey>;

    /**
     * Serializes a string with just the index sort key you can compare to a cursor
     * generated by `serializeOpaqueCursor()`.
     *
     * You can use with `startSortKey` or `endSortKey` if you'd like to share those
     * bounds with a client with a string that has the right relative order
     * compared to cursors.
     */
    serializeOpaqueCursorBound(
        itemKey: IndexSortKey,
        boundType: "StartExclusive" | "StartInclusive" | "EndExclusive" | "EndInclusive",
    ): string;
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
    indexDescriptions: ReadonlyArray<{
        readonly projection: "KeysOnly" | "All";
        readonly overloadByName: {
            [name: string]: DynamoTableSchemaTypes.Index.OverloadDescription & {
                readonly canReusePartitionKey: boolean;
            };
        };
    }>,
): {
    lastDescription: DynamoTableSchemaTypes.Description | null;
    description: DynamoTableSchemaTypes.Description;
    readCompatibilityError: Error | null;
    writeCompatibilityError: Error | null;
} {
    const lastDescription = dynamoGeneratedSchemaDescription.tableByName[config.name] ?? null;

    const description: DynamoTableSchemaTypes.Description = {
        name: config.name,
        partitionByType: getDynamoTableSchemaPartitionDescriptionByType(
            lastDescription?.partitionByType,
            config.partitions,
        ),
        indexes: indexDescriptions.map((indexDescription, index) =>
            getDynamoTableSchemaIndexDescription(lastDescription, indexDescription, index),
        ),
    };

    // If we have a description saved, then verify our new description is backwards
    // compatible with the old description. We will save our new description the
    // first time an item is written to this table.
    let readCompatibilityError: Error | null = null;
    let writeCompatibilityError: Error | null = null;

    if (lastDescription !== null) {
        try {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(lastDescription, description);
        } catch (error) {
            readCompatibilityError = InternalError.from(
                error,
                "Can not read from table with new schema",
            );
        }

        try {
            checkDynamoTableSchemaDescriptionBackwardsCompatibility(description, lastDescription);
        } catch (error) {
            writeCompatibilityError = InternalError.from(
                error,
                "Can not write to table with new schema until you run `bazel run //admin/dynamo:write_schema`",
            );
        }
    } else {
        writeCompatibilityError = new InternalError(
            "Can not write to table with new schema until you run `bazel run //admin/dynamo:write_schema`",
        );
    }

    return {
        lastDescription,
        description,
        readCompatibilityError,
        writeCompatibilityError,
    };
}

function getDynamoTableSchemaPartitionDescriptionByType(
    lastPartitionDescriptionByType:
        | {[key: string]: DynamoTableSchemaTypes.Partition.Description}
        | undefined,
    partitionConfigs: ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
): {[key: string]: DynamoTableSchemaTypes.Partition.Description} {
    const partitionIds = new Set<number>();

    // Add all of the last partition IDs to a set so we don't reuse them for new
    // partitions...
    for (const lastPartitionDescription of Object.values(lastPartitionDescriptionByType ?? {})) {
        assert(
            !partitionIds.has(lastPartitionDescription.id),
            "Found duplicate partition ID in table",
        );
        partitionIds.add(lastPartitionDescription.id);
    }

    return Object.fromEntries(
        partitionConfigs.map(partitionConfig => {
            const lastPartitionDescription = lastPartitionDescriptionByType?.[partitionConfig.name];

            // Assign our partition an ID if one was not already assigned. IDs are used in
            // binary encodings related to the table.
            let partitionId;
            if (lastPartitionDescription && typeof lastPartitionDescription.id === "number") {
                // We already tested that `lastDescription` has unique partition IDs.
                partitionId = lastPartitionDescription.id;
            } else {
                // Generate a new, unique, partition ID.
                partitionId = 0;
                while (partitionIds.has(partitionId)) {
                    partitionId++;
                }
                partitionIds.add(partitionId);
            }

            // Partition IDs should be a valid uint8 so we can write it into a byte.
            assert(
                Number.isInteger(partitionId) && partitionId >= 0 && partitionId <= 2 ** 8 - 1,
                "Invalid partition ID",
            );

            const partitionDescription: DynamoTableSchemaTypes.Partition.Description = {
                id: partitionId,
                partitionKeyAttributeByKey: mapObjectValues(
                    partitionConfig.partitionKeyAttributes,
                    keyAttribute => keyAttribute.description,
                ),
                sortRangeByType: getDynamoTableSchemaSortRangeDescriptionByType(
                    lastPartitionDescription?.sortRangeByType,
                    partitionConfig.sortRanges,
                    {withChildSortRanges: true},
                ),
            };

            return [partitionConfig.name, partitionDescription];
        }),
    );
}

function getDynamoTableSchemaSortRangeDescriptionByType(
    lastSortRangeDescriptionByType:
        | {[key: string]: DynamoTableSchemaTypes.SortRange.Description}
        | undefined,
    sortRangeConfigs: ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
    options: {withChildSortRanges: true},
): {
    [name: string]: DynamoTableSchemaTypes.SortRange.Description;
};
function getDynamoTableSchemaSortRangeDescriptionByType(
    lastSortRangeDescriptionByType:
        | {
              [key: string]: Omit<
                  DynamoTableSchemaTypes.SortRange.Description,
                  "childSortRangeByType"
              >;
          }
        | undefined,
    sortRangeConfigs: ReadonlyArray<DynamoTableSchemaTypes.SortRange.ChildConfigBase>,
    options: {withChildSortRanges: false},
): {
    [name: string]: Omit<DynamoTableSchemaTypes.SortRange.Description, "childSortRangeByType">;
};
function getDynamoTableSchemaSortRangeDescriptionByType(
    lastSortRangeDescriptionByType:
        | {
              [key: string]: PartialBy<
                  DynamoTableSchemaTypes.SortRange.Description,
                  "childSortRangeByType"
              >;
          }
        | undefined,
    sortRangeConfigs: ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
    {withChildSortRanges}: {withChildSortRanges: boolean},
): {
    [name: string]: PartialBy<DynamoTableSchemaTypes.SortRange.Description, "childSortRangeByType">;
} {
    // Iterate through all our sort ranges, in order, finding contiguous subsets of
    // the list which do not have an `OrderKey` in the last description. For these
    // sort ranges generate new `OrderKey`s for our new description.
    const sortRangeOrderKeyByType = new Map<string, OrderKey>();
    let lastExistingSortRangeOrderKey: OrderKey | null = null;
    let sortRangeTypesWithoutExistingOrderKey = [];

    for (const sortRangeConfig of sortRangeConfigs) {
        const existingSortRangeOrderKey =
            lastSortRangeDescriptionByType?.[sortRangeConfig.name]?.orderKey;

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

            for (let index = 0; index < sortRangeTypesWithoutExistingOrderKey.length; index++) {
                sortRangeOrderKeyByType.set(
                    sortRangeTypesWithoutExistingOrderKey[index]!,
                    newSortRangeOrderKeys[index]!,
                );
            }

            lastExistingSortRangeOrderKey = existingSortRangeOrderKey;
            sortRangeTypesWithoutExistingOrderKey = [];
            sortRangeOrderKeyByType.set(sortRangeConfig.name, existingSortRangeOrderKey);
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

    const sortRangeIds = new Set<number>();

    for (const {id: sortRangeId} of Object.values(lastSortRangeDescriptionByType ?? {})) {
        assert(!sortRangeIds.has(sortRangeId), "Found duplicate sort range ID in partition");

        sortRangeIds.add(sortRangeId);
    }

    return Object.fromEntries(
        sortRangeConfigs.map(sortRangeConfig => {
            const lastSortRangeDescription = lastSortRangeDescriptionByType?.[sortRangeConfig.name];

            // Assign our sort range an ID if one was not already assigned. IDs are used in
            // binary encodings related to the partition.
            let sortRangeId;
            if (lastSortRangeDescription && typeof lastSortRangeDescription.id === "number") {
                sortRangeId = lastSortRangeDescription.id;
            } else {
                sortRangeId = 0;
                while (sortRangeIds.has(sortRangeId)) {
                    sortRangeId++;
                }

                assert(
                    !sortRangeIds.has(sortRangeId),
                    "Found duplicate sort range ID in partition",
                );

                sortRangeIds.add(sortRangeId);
            }

            // Partition IDs should be a valid uint8 so we can write it into a byte.
            assert(
                Number.isInteger(sortRangeId) && sortRangeId >= 0 && sortRangeId <= 2 ** 8 - 1,
                "Invalid sort range ID",
            );

            const sortRangeDescription: PartialBy<
                DynamoTableSchemaTypes.SortRange.Description,
                "childSortRangeByType"
            > = {
                id: sortRangeId,
                orderKey: assertExists(sortRangeOrderKeyByType.get(sortRangeConfig.name)),
                sortKeyAttributeByKey: mapObjectValues(
                    sortRangeConfig.sortKeyAttributes,
                    keyAttribute => keyAttribute.description,
                ),
                attributesSchema: sortRangeConfig.attributes.getDescription(),
                childSortRangeByType: withChildSortRanges
                    ? getDynamoTableSchemaSortRangeDescriptionByType(
                          lastSortRangeDescription?.childSortRangeByType,
                          sortRangeConfig.childSortRanges ?? [],
                          {withChildSortRanges: false},
                      )
                    : undefined,
            };

            return [sortRangeConfig.name, sortRangeDescription];
        }),
    );
}

function getDynamoTableSchemaIndexDescription(
    lastDescription: DynamoTableSchemaTypes.Description | null,
    indexDescription: {
        readonly projection: "KeysOnly" | "All";
        readonly overloadByName: {
            [name: string]: DynamoTableSchemaTypes.Index.OverloadDescription & {
                readonly canReusePartitionKey: boolean;
            };
        };
    },
    index: number,
): DynamoTableSchemaTypes.Index.Description {
    const lastIndexDescription = lastDescription?.indexes[index];

    // If the last index description uses a `Separate` partition key (e.g. indexes
    // created before we added this reused partition key feature) then continue to
    // use a `Separate` partition key.
    const doesLastIndexDescriptionHaveSeparatePartitionKey =
        !!lastIndexDescription &&
        (lastIndexDescription.partitionKeyBehavior?.type ?? "Separate") === "Separate";

    const canReusePartitionKeySet = new Set(
        Object.values(indexDescription.overloadByName).map(
            indexOverloadDescription => indexOverloadDescription.canReusePartitionKey,
        ),
    );
    assert(
        canReusePartitionKeySet.size === 1,
        "All overloads in index must have the same `canReusePartitionKey` setting",
    );

    const partitionTypeSet = new Set(
        Object.values(indexDescription.overloadByName).flatMap(indexOverloadDescription =>
            indexOverloadDescription.itemTypes.map(({partitionType}) => partitionType),
        ),
    );

    let partitionKeyBehavior: {type: "Separate"} | {type: "Reused"; partitionType: string};

    if (!canReusePartitionKeySet.has(true)) {
        partitionKeyBehavior = {type: "Separate"};
    } else {
        assert(
            partitionTypeSet.size === 1,
            "All overloads in index reusing partition key must have the same `partitionType`",
        );

        if (doesLastIndexDescriptionHaveSeparatePartitionKey) {
            partitionKeyBehavior = {type: "Separate"};
        } else {
            partitionKeyBehavior = {
                type: "Reused",
                partitionType: Array.from(partitionTypeSet)[0]!,
            };
        }
    }

    return {
        projection: indexDescription.projection,
        partitionKeyBehavior,
        overloadByName: mapObjectValues(
            indexDescription.overloadByName,
            ({canReusePartitionKey, ...indexOverloadDescription}) => indexOverloadDescription,
        ),
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

        // If our description is adding an index, you may only add the index to item
        // types the new description itself adds.
        if (i >= lastDescription.indexes.length) {
            for (const [nextIndexOverloadName, nextIndexOverloadDescription] of Object.entries(
                nextIndexDescription.overloadByName,
            )) {
                for (const nextIndexOverloadItemType of nextIndexOverloadDescription.itemTypes) {
                    if (
                        lastDescription.partitionByType[nextIndexOverloadItemType.partitionType]
                            ?.sortRangeByType[nextIndexOverloadItemType.sortRangeType]
                    ) {
                        throw new InvalidArgumentError(
                            quote`Index overload ${nextIndexOverloadName} can’t be added to existing items with partition type ${nextIndexOverloadItemType.partitionType} and sort range type ${nextIndexOverloadItemType.sortRangeType}`,
                        );
                    }
                }
            }
            continue;
        }

        const lastIndexDescription = lastDescription.indexes[i]!;

        checkDynamoTableSchemaIndexDescriptionBackwardsCompatibility(
            number,
            lastIndexDescription,
            nextIndexDescription,
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

    for (const sortRangeType of missingSortRangeTypes) {
        throw new InvalidArgumentError(`Sort range \`${sortRangeType}\` is missing`);
    }
}

function checkDynamoTableSchemaSortRangeDescriptionBackwardsCompatibility(
    type: string,
    lastDescription: PartialBy<
        DynamoTableSchemaTypes.SortRange.Description,
        "childSortRangeByType"
    >,
    nextDescription: PartialBy<
        DynamoTableSchemaTypes.SortRange.Description,
        "childSortRangeByType"
    >,
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

    if (lastDescription.childSortRangeByType) {
        const missingChildSortRangeTypes = new Set(
            Object.keys(lastDescription.childSortRangeByType),
        );

        for (const [childSortRangeType, nextSortRangeSchemaDescription] of Object.entries(
            nextDescription.childSortRangeByType ?? {},
        )) {
            if (missingChildSortRangeTypes.delete(childSortRangeType)) {
                checkDynamoTableSchemaSortRangeDescriptionBackwardsCompatibility(
                    `${type}#${childSortRangeType}`,
                    lastDescription.childSortRangeByType[childSortRangeType]!,
                    nextSortRangeSchemaDescription,
                );
            }
        }

        for (const childSortRangeType of missingChildSortRangeTypes) {
            throw new InvalidArgumentError(`Child sort range \`${childSortRangeType}\` is missing`);
        }
    }
}

function checkDynamoTableSchemaIndexDescriptionBackwardsCompatibility(
    number: number,
    lastDescription: DynamoTableSchemaTypes.Index.Description,
    nextDescription: DynamoTableSchemaTypes.Index.Description,
): void {
    if (lastDescription.projection !== nextDescription.projection) {
        throw new InvalidArgumentError(
            `Can’t change index attribute projection from \`${lastDescription.projection}\` to \`${nextDescription.projection}\``,
        );
    }

    if (
        (lastDescription.partitionKeyBehavior?.type ?? "Separate") !==
        (nextDescription.partitionKeyBehavior?.type ?? "Separate")
    ) {
        throw new InvalidArgumentError(
            `Can’t change index partition key from \`${
                lastDescription.partitionKeyBehavior?.type ?? "Separate"
            }\` to \`${nextDescription.partitionKeyBehavior?.type ?? "Separate"}\``,
        );
    }

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

    for (const overloadName of missingOverloadNames) {
        throw new InvalidArgumentError(`Index overload \`${overloadName}\` is missing`);
    }
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
