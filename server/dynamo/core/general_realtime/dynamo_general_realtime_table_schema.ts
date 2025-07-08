import {addDays, subDays, subMinutes} from "date-fns";
import {
    ServerContentActionContext,
    ServerContentActionContextModules,
} from "~/server/context/server_content_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    DynamoTableSchema,
    DynamoTableSchemaIndexConfigOptions,
    DynamoTableSchemaIndexKeyAttributesConfigBase,
    DynamoTableSchemaIndexKeyAttributesType,
    DynamoTableSchemaTypesBase,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {DynamoCondition} from "~/server/dynamo/core/internal/dynamo_condition.js";
import {DynamoTableSchemaTypes} from "~/server/dynamo/core/internal/types/dynamo_table_schema_types.js";
import {EdgeServiceContextModuleBase} from "~/server/tokens/edge_service_context_module.js";
import {Context} from "~/shared/context/context.js";
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimePutItemEvent,
    DynamoGeneralRealtimePutItemEventIndexes,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
    DynamoItemKeySchema,
    DynamoItemPartitionKey,
    DynamoItemSortKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {NonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries.js";
import {Schema, SchemaWithoutValidation} from "~/shared/schema/schema.js";

// Intentionally not exported. We encourage users of
// `dynamo_general_realtime_table_schema.ts` to create their own named context
// types. e.g. `ForumActionContext` in `forum_table.ts`.
type ServerActionContextModulesWithBroadcast = ServerContentActionContextModules & {
    edge: EdgeServiceContextModuleBase;
};

type ServerActionContextWithBroadcast = Context<ServerActionContextModulesWithBroadcast>;

export type DynamoGeneralRealtimeTableSchemaGetTypes<
    Schema extends DynamoGeneralRealtimeTableSchema<any, any>,
> = Schema extends DynamoGeneralRealtimeTableSchema<infer Types, any> ? Types : never;

export type DynamoGeneralRealtimeTableItemKeyType<
    Schema extends DynamoGeneralRealtimeTableSchema<any, any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    DynamoGeneralRealtimeTableSchemaGetTypes<Schema>["ItemKey"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

export type DynamoGeneralRealtimeTableItemType<
    Schema extends DynamoGeneralRealtimeTableSchema<any, any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    DynamoGeneralRealtimeTableSchemaGetTypes<Schema>["Item"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

type DynamoGeneralRealtimeTableSchemaPartitionShallowFeatureConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof PartitionsConfig]: [PartitionsConfig[Index]["name"], boolean];
    }>
>;

type DynamoGeneralRealtimeTableSchemaPartitionFeatureConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof PartitionsConfig]: [
            PartitionsConfig[Index]["name"],
            DynamoGeneralRealtimeTableSchemaSortRangeFeatureConfigType<
                PartitionsConfig[Index]["sortRanges"]
            >,
        ];
    }>
>;

type DynamoGeneralRealtimeTableSchemaSortRangeFeatureConfigType<
    SortRangesConfig extends ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof SortRangesConfig]: [SortRangesConfig[Index]["name"], boolean];
    }>
>;

type DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof PartitionsConfig]: [
        PartitionsConfig[Index]["name"],
        DynamoGeneralRealtimeTableSchemaSortRangeModelConfigType<
            PartitionsConfig[Index],
            PartitionsConfig[Index]["sortRanges"]
        >,
    ];
}>;

type DynamoGeneralRealtimeTableSchemaSortRangeModelConfigType<
    PartitionConfig extends DynamoTableSchemaTypes.Partition.ConfigBase,
    SortRangesConfig extends ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof SortRangesConfig]: [
        SortRangesConfig[Index]["name"],
        {
            build: (
                context: ServerContentActionContext,
                item: DynamoTableSchemaTypes.ItemType<PartitionConfig, SortRangesConfig[Index]>,
            ) => Promise<unknown>;
        },
    ];
}>;

type DynamoGeneralRealtimeTableSchemaModelMapType<
    ModelsConfig extends {
        [partitionType: string]: {[sortRangeType: string]: {build: () => Promise<any>}};
    },
> = {
    [Key1 in keyof ModelsConfig]: {
        [Key2 in keyof ModelsConfig[Key1]]: Awaited<ReturnType<ModelsConfig[Key1][Key2]["build"]>>;
    };
};

type DynamoGeneralRealtimeTableSchemaModelType<
    ModelsConfig extends {
        [partitionType: string]: {[sortRangeType: string]: {build: () => Promise<any>}};
    },
> = {
    [Key1 in keyof ModelsConfig]: {
        [Key2 in keyof ModelsConfig[Key1]]: Awaited<ReturnType<ModelsConfig[Key1][Key2]["build"]>>;
    }[keyof ModelsConfig[Key1]];
}[keyof ModelsConfig];

type DynamoGeneralRealtimePrivateRealtimePartitionItem = DynamoTableSchemaTypes.Partition.ItemTypes<
    [typeof dynamoGeneralRealtimePrivateRealtimePartitionConfig]
>;

type DynamoGeneralRealtimePrivateRealtimePartitionEvent =
    DynamoGeneralRealtimePrivateRealtimePartitionItem["eventTransaction"][number];

const dynamoGeneralRealtimePrivateRealtimePartitionName = "Realtime";

const dynamoGeneralRealtimePrivateRealtimePartitionConfig = {
    name: dynamoGeneralRealtimePrivateRealtimePartitionName,
    partitionKeyAttributes: {
        realtimeKey: DynamoKeyAttributeSchema.labelString,
    },
    sortRanges: [
        {
            name: "Events",
            sortKeyAttributes: {
                eventTime: DynamoKeyAttributeSchema.date,
            },
            withExpirationTime: "Required",
            attributes: Schema.object({
                eventTransaction: Schema.array(
                    Schema.union({
                        PutItem: Schema.object({
                            type: Schema.value("PutItem"),
                            key: DynamoItemKeySchema,
                            version: Schema.integer,
                        }),
                        DeleteItem: Schema.object({
                            type: Schema.value("DeleteItem"),
                            key: DynamoItemKeySchema,
                            version: Schema.integer,
                        }),
                    }),
                ),
            }),
        },
    ],
} as const satisfies DynamoTableSchemaTypes.Partition.ConfigBase;

type DynamoGeneralRealtimePrivateGraveyardPartitionItem =
    DynamoTableSchemaTypes.Partition.ItemTypes<
        [typeof dynamoGeneralRealtimePrivateGraveyardPartitionConfig]
    >;

type DynamoGeneralRealtimePrivateGraveyardPartitionItemKey =
    DynamoTableSchemaTypes.Partition.ItemKeyTypes<
        [typeof dynamoGeneralRealtimePrivateGraveyardPartitionConfig]
    >;

const dynamoGeneralRealtimePrivateGraveyardPartitionName = "Graveyard";

const dynamoGeneralRealtimePrivateGraveyardPartitionConfig = {
    name: dynamoGeneralRealtimePrivateGraveyardPartitionName,
    partitionKeyAttributes: {
        deletedPartitionKey:
            DynamoKeyAttributeSchema.labelString as DynamoKeyAttributeSchema<any> as DynamoKeyAttributeSchema<DynamoItemPartitionKey>,
    },
    sortRanges: [
        {
            name: "Gravestone",
            sortKeyAttributes: {
                deletedSortKey:
                    DynamoKeyAttributeSchema.labelString as DynamoKeyAttributeSchema<any> as DynamoKeyAttributeSchema<DynamoItemSortKey>,
            },
            attributes: Schema.object({}),
        },
    ],
} as const satisfies DynamoTableSchemaTypes.Partition.ConfigBase;

/**
 * How many days does it take for events stored in our private realtime
 * partition to expire?
 *
 * We set to a week. That way if a client goes offline for the weekend then
 * comes back online we will be able to backfill.
 */
const dynamoGeneralRealtimePrivatePartitionEventExpirationDays = 7;

/**
 * The maximum number of minutes we expect DynamoDB to return stale data from
 * an eventually consistent read.
 *
 * [DynamoDB says][1] reads are usually consistent "within one second or less".
 * So three minutes should be more than a sufficient window.
 *
 * [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
 */
export const dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes = 3;

type DynamoGeneralRealtimeInternalIndex = {
    readonly canReuseTablePartitionKeyForRealtimeKey: boolean;
    readonly dynamicPartitionKeyAttributeNames: ReadonlyArray<string>;
    readonly serializeOpaquePartitionKey: (partitionKey: unknown) => DynamoIndexPartitionKey;
    readonly serializeOpaqueCursor: (itemKey: unknown) => DynamoIndexCursor;
};

type DynamoGeneralRealtimeInternalEvent<ItemKey, Model> =
    | {
          readonly type: "PutItem";
          readonly partitionType: string;
          readonly sortRangeType: string;
          readonly itemKey: ItemKey;
          readonly partitionKey: DynamoItemPartitionKey;
          readonly key: DynamoItemKey;
          readonly version: number;
          readonly getEvent: (
              context: ServerContentActionContext,
          ) => Promise<DynamoGeneralRealtimePutItemEvent<Model>>;
          readonly indexByName: ReadonlyMap<string, DynamoGeneralRealtimeInternalIndex> | undefined;
          readonly oldPartitionKeyByIndexName:
              | ReadonlyMap<string, DynamoIndexPartitionKey>
              | undefined;
          readonly newPartitionKeyByIndexName:
              | ReadonlyMap<string, DynamoIndexPartitionKey>
              | undefined;
      }
    | {
          readonly type: "DeleteItem";
          readonly partitionType: string;
          readonly sortRangeType: string;
          readonly itemKey: ItemKey;
          readonly partitionKey: DynamoItemPartitionKey;
          readonly key: DynamoItemKey;
          readonly version: number;
          readonly indexByName: ReadonlyMap<string, DynamoGeneralRealtimeInternalIndex> | undefined;
          readonly oldPartitionKeyByIndexName:
              | ReadonlyMap<string, DynamoIndexPartitionKey>
              | undefined;
          readonly newPartitionKeyByIndexName:
              | ReadonlyMap<string, DynamoIndexPartitionKey>
              | undefined;
      };

/**
 * Abstraction on top of `DynamoTableSchema` for creating DynamoDB tables where
 * clients can not only load data but also subscribe to all future changes to
 * that data.
 *
 * This abstraction is great if you have some simple data that needs realtime
 * updates but you may need a custom realtime implementation for more advanced
 * collaborative use cases. This is where the name comes from. The abstraction
 * is "general" purpose but by trying to serve a general use case it may not be
 * good for specific applications.
 *
 * This DynamoDB realtime implementation is:
 *
 * - General purpose. This realtime implementation works with any arbitrary
 *   data you put into DynamoDB. While sometimes you may have pretty custom
 *   realtime needs and choose to use a regular table with your own realtime
 *   implementation (like for documents and messaging), this abstraction can
 *   support many simple cases where you have a list of data you need updated
 *   in realtime.
 *
 * - Preserves the speed of DynamoDB. You still design your tables in such a
 *   way that related data is collated so it can be read at once. Realtime adds
 *   no overhead to reads. (But some overhead to writes.)
 *
 * - Eventually correct. Every single update to data you've queried can be
 *   observed. While updates may arrive out of order they include a version
 *   number so clients can serialize updates on a given item.
 *
 * - Works with stale reads. You can read data on the server then a second
 *   later connect to a WebSocket on the client and any updates during that
 *   time will be backfilled. Similarly, we support have realtime updates for
 *   DynamoDB global secondary indexes that only have eventually
 *   consistent reads.
 *
 * This implementation does have some limitations you need to keep in mind
 * before using:
 *
 * - Does not support all DynamoDB actions. For example, there is no
 *   `replaceItem()`. All item updates must have a version number so if clients
 *   receive out-of-order events they can use the version number to
 *   serialize them.
 *
 * - Shares the primary key and index key of an item with the client. While
 *   this data is base64 encoded, that's not secure! Any attacker can trivially
 *   get this data from the opaque string keys we send to the client to
 *   maintain data in realtime. This data must not be sensitive.
 *
 * - You are still responsible for broadcasting update events to clients and
 *   authorizing that clients have access to an update event stream. Similarly,
 *   clients need to know the right channel to subscribe to in order to receive
 *   realtime events for the data it's displaying.
 *
 * - Clients may skip update events. Because events may arrive out-of-order if
 *   you have an item at version N and an update to N+1 and N+2 but the event
 *   for N+2 arrives on the client first them the client will update their item
 *   to N+2 and ignore the N+1 event when it arrives. Make sure it's not
 *   essential that a client sees every update.
 *
 * - Item-centric. The smallest granularity of realtime update is the item.
 *   There are no realtime updates for item attributes and we send the entire
 *   item on updates instead of a diff. There are no consistency guarantees for
 *   updates across items (unless you use a transaction). Forces you to think
 *   of items as individual entities all the way down to the client (which
 *   makes some table designs harder, for example a document table design is
 *   harder where there are many step items that comprise a document entity).
 */
// TODO(calebmer, 2022-04-28): Features from `DynamoTableSchema` I'm leaving
// unimplemented for now since I don't have a test case. There are TODO
// comments throughout this class but here's a list in one place:
//
// - `addExpensiveFullIndex()` with items in different partitions
// - Certain `DynamoKeyAttributeSchema`s which don't support binary encoding
export class DynamoGeneralRealtimeTableSchema<
    Types extends DynamoTableSchemaTypesBase,
    ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
> {
    private readonly _table: DynamoTableSchema<Types>;
    private readonly _features:
        | {
              readonly realtimeQuery?: {readonly [partitionType: string]: boolean | undefined};
              readonly deleteItem?: {
                  readonly [partitionType: string]:
                      | {readonly [sortRangeType: string]: boolean | undefined}
                      | undefined;
              };
          }
        | undefined;
    private readonly _models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
        DynamoTableSchemaTypes.ConfigBase["partitions"]
    >;
    private readonly _broadcastEventTransactionCallback: (
        context: ServerActionContextWithBroadcast,
        readTime: Date,
        eventTransaction: ReadonlyArray<{
            itemKey: Types["ItemKey"];
            event: DynamoGeneralRealtimeEvent<ModelMap[string][string]>;
            oldPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
            newPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
        }>,
    ) => Promise<void>;

    private readonly _indexByNameByItemType = new Map<
        string,
        Map<string, DynamoGeneralRealtimeInternalIndex>
    >();

    public static new<
        const PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
        const ModelsConfig extends DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<PartitionsConfig>,
    >({
        name,
        partitions,
        withoutCompatibilityErrorsForTest,
        features,
        models,
        modelSchema,
        broadcastEventTransaction,
    }: {
        name: string;
        partitions: PartitionsConfig;
        withoutCompatibilityErrorsForTest?: boolean;

        /**
         * Enable features by partition. By default we disable these features since
         * they incur some overhead so should only be enabled if you know they're
         * needed and you're comfortable with the overhead.
         */
        features?: {
            /**
             * Enable `realtimeQuery()` for a partition. If you don't enable
             * `realtimeQuery()` for the partition you can still create an index on the
             * table which may have a `realtimeQuery()` method.
             *
             * Enabling `realtimeQuery()` means we need to write an additional event
             * transaction item to the database every update so the realtime query can be
             * backfilled. In other words, enabling `realtimeQuery()` incurs an additional
             * 1 WCU minimum on every update.
             */
            realtimeQuery?: DynamoGeneralRealtimeTableSchemaPartitionShallowFeatureConfigType<PartitionsConfig>;

            /**
             * Enable `deleteItem()` for a partition. By default items aren't deletable.
             * When you delete an item we need to keep a gravestone in the database so if
             * the item is ever undeleted the undeleted item can have a version greater
             * than the last item's version so clients will accept the undeleted item as
             * the latest.
             *
             * Enabling `deleteItem()` means we need to check in `createItem()` (and
             * `transactionCreateItem()`) that a gravestone doesn't exist. This turns
             * `createItem()` from a 1 WCU and 1 RCU minimum request into a transaction
             * that consumes 2 WCU and 4 RCU minimum (2 RCU for the gravestone condition
             * check).
             *
             * You could still use a method like
             * `transactionDangerouslyCreateItemWithoutExistenceConditionCheck()` which
             * skips the existence condition check to avoid extra RCUs that check for a
             * gravestone.
             */
            deleteItem?: DynamoGeneralRealtimeTableSchemaPartitionFeatureConfigType<PartitionsConfig>;
        };

        /**
         * Every partition in a realtime DynamoDB table needs a model. A model is the
         * object we share with the client. It removes any internal server information
         * and may load related data from different tables.
         *
         * We create a model whenever you update data and broadcast the model to any
         * realtime subscribers.
         */
        models: ModelsConfig;

        /**
         * A schema that can serialize/deserialize every model object.
         */
        // NOTE(calebmer, 2023-04-24): For whatever reason, TypeScript doesn't seem to
        // like the full `Schema` type here but works just fine with an interface that
        // has a limited set of methods. I think it has something to do with
        // variance. Shrug.
        modelSchema: SchemaWithoutValidation<
            DynamoGeneralRealtimeTableSchemaModelType<ModelsConfig>
        >;

        /**
         * Whenever data within the realtime DynamoDB table is updated we call this
         * broadcast function. It is your responsibility to make realtime events make
         * it to connected clients. This abstraction does not do realtime event
         * delivery for you.
         *
         * It's important that you make sure only authorized clients can subscribe to
         * realtime event streams! Otherwise they may get access to data they're not
         * allowed to see.
         */
        broadcastEventTransaction: (
            context: ServerActionContextWithBroadcast,
            readTime: Date,
            eventTransaction: ReadonlyArray<{
                itemKey: DynamoTableSchemaTypes.Partition.ItemKeyTypes<PartitionsConfig>;
                event: DynamoGeneralRealtimeEvent<
                    DynamoGeneralRealtimeTableSchemaModelType<ModelsConfig>
                >;
                oldPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
                newPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
            }>,
        ) => Promise<void>;
    }): DynamoGeneralRealtimeTableSchema<
        DynamoTableSchemaTypes.Types<{name: string; partitions: PartitionsConfig}>,
        DynamoGeneralRealtimeTableSchemaModelMapType<ModelsConfig>
    > {
        assert(modelSchema instanceof Schema);

        return new DynamoGeneralRealtimeTableSchema({
            table: DynamoTableSchema.new({
                name,
                // Add a private partition for storing realtime information but don't include
                // it in the types. Users of this abstraction should not be able to access the
                // realtime partition so we don't include it in the types.
                partitions: [
                    ...partitions,
                    dynamoGeneralRealtimePrivateRealtimePartitionConfig,
                    dynamoGeneralRealtimePrivateGraveyardPartitionConfig,
                ] as any as PartitionsConfig,
                withoutCompatibilityErrorsForTest,
            }),
            features,
            models,
            broadcastEventTransaction,
        });
    }

    private constructor({
        table,
        features,
        models,
        broadcastEventTransaction,
    }: {
        table: DynamoTableSchema<Types>;
        features:
            | {
                  readonly realtimeQuery?: {readonly [partitionType: string]: boolean | undefined};
                  readonly deleteItem?: {
                      readonly [partitionType: string]:
                          | {readonly [sortRangeType: string]: boolean | undefined}
                          | undefined;
                  };
              }
            | undefined;
        models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >;
        broadcastEventTransaction: (
            context: ServerActionContextWithBroadcast,
            readTime: Date,
            eventTransaction: ReadonlyArray<{
                itemKey: Types["ItemKey"];
                event: DynamoGeneralRealtimeEvent<ModelMap[string][string]>;
                oldPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
                newPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
            }>,
        ) => Promise<void>;
    }) {
        this._table = table;
        this._features = features;
        this._models = models;
        this._broadcastEventTransactionCallback = broadcastEventTransaction;
    }

    public getName() {
        return this._table.getName();
    }

    public isInitialized() {
        return this._table.isInitialized();
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
        return this._table.serializeOpaqueItemKey(key);
    }

    private _buildModel<Item extends Types["Item"]>(
        context: ServerContentActionContext,
        item: Item,
    ): Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]> {
        return this._models[item.partitionType]![item.sortRangeType]!.build(
            context,
            item,
        ) as Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>;
    }

    private _getDeleteItemEventIndexes(itemType: Types["ItemType"]): ReadonlySet<string> {
        const indexes = new Set<string>();

        const itemTypeString = `${itemType.partitionType}#${itemType.sortRangeType}`;
        for (const [indexName] of this._indexByNameByItemType.get(itemTypeString) ?? []) {
            indexes.add(indexName);
        }

        return indexes;
    }

    private _getPutItemEventIndexes({
        item,
        indexByName,
        partitionKeyByIndexName,
    }: {
        item: Types["Item"];
        indexByName: ReadonlyMap<string, DynamoGeneralRealtimeInternalIndex> | undefined;
        partitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    }): DynamoGeneralRealtimePutItemEventIndexes {
        // In development and test environments make sure the `indexByName` and
        // `partitionKeyByIndexName` arguments that were passed in are correct. We
        // could compute these arguments ourselves but given they've usually already
        // been computed by this point as an optimization we accept them as an
        // argument.
        if (process.env.NODE_ENV !== "production") {
            const actualIndexByName = this._indexByNameByItemType.get(
                `${item.partitionType}#${item.sortRangeType}`,
            );
            assert(actualIndexByName === indexByName);

            let actualPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

            if (indexByName) {
                for (const [indexName, index] of indexByName) {
                    actualPartitionKeyByIndexName ??= new Map();
                    actualPartitionKeyByIndexName.set(
                        indexName,
                        index.serializeOpaquePartitionKey(item),
                    );
                }
            }

            assert(isDeepEqual(actualPartitionKeyByIndexName, partitionKeyByIndexName));
        }

        const indexes = new Map<
            string,
            {partitionKey: DynamoIndexPartitionKey; cursor: DynamoIndexCursor}
        >();

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                const partitionKey = assertExists(partitionKeyByIndexName?.get(indexName));
                const cursor = index.serializeOpaqueCursor(item);
                indexes.set(indexName, {partitionKey, cursor});
            }
        }

        return indexes;
    }

    private _createGetPutItemEvent<Item extends Types["Item"]>(options: {
        key: DynamoItemKey;
        version: number;
        item: Item;
        indexByName: ReadonlyMap<string, DynamoGeneralRealtimeInternalIndex> | undefined;
        partitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    }): (
        context: ServerContentActionContext,
    ) => Promise<
        DynamoGeneralRealtimePutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
    > {
        let eventPromise: Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        > | null = null;

        return context => {
            eventPromise ??= (async () => ({
                type: "PutItem",
                item: {
                    key: options.key,
                    version: options.version,
                    model: await this._buildModel(context, options.item),
                },
                indexes: this._getPutItemEventIndexes(options),
            }))();

            return eventPromise;
        };
    }

    /**
     * Broadcast an event transaction to any realtime clients listening for
     * updates. Also writes the event transaction to the database which will allow
     * us to backfill queries if a realtime client has been disconnected from
     * realtime updates for a bit.
     *
     * This method is called in `context.process.waitUntil()` after a successful
     * write. This means it's not guaranteed to run in scenarios where the service
     * crashes (e.g. because of an out-of-memory exception or other infrastructure
     * failure). Since we may finish the write then after the service crashes
     * before we can broadcast the realtime event. We're ok with this for now. The
     * impact is clients won't get realtime updates. But if the client reloads
     * their browser they're going to pick up the new data.
     */
    private _broadcastEventTransaction(
        context: ServerActionContextWithBroadcast,
        readTime: Date,
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeInternalEvent<Types["ItemKey"], ModelMap[string][string]>
        >,
    ): Promise<void> {
        return context.tracer.withSpan("Send general realtime event transaction", async context => {
            const [actualEventTransaction] = await runAllPromises([
                runAllPromises(
                    eventTransaction.map(
                        async (
                            event,
                        ): Promise<{
                            itemKey: Types["ItemKey"];
                            event: DynamoGeneralRealtimeEvent<ModelMap[string][string]>;
                            oldPartitionKeyByIndexName:
                                | ReadonlyMap<string, DynamoIndexPartitionKey>
                                | undefined;
                            newPartitionKeyByIndexName:
                                | ReadonlyMap<string, DynamoIndexPartitionKey>
                                | undefined;
                        }> => {
                            switch (event.type) {
                                case "PutItem": {
                                    return {
                                        itemKey: event.itemKey,
                                        event: await event.getEvent(context),
                                        oldPartitionKeyByIndexName:
                                            event.oldPartitionKeyByIndexName,
                                        newPartitionKeyByIndexName:
                                            event.newPartitionKeyByIndexName,
                                    };
                                }
                                case "DeleteItem": {
                                    return {
                                        itemKey: event.itemKey,
                                        event: {
                                            type: "DeleteItem",
                                            item: {
                                                key: event.key,
                                                version: event.version,
                                            },
                                            indexes: this._getDeleteItemEventIndexes(event),
                                        },
                                        oldPartitionKeyByIndexName:
                                            event.oldPartitionKeyByIndexName,
                                        newPartitionKeyByIndexName:
                                            event.newPartitionKeyByIndexName,
                                    };
                                }
                                default:
                                    throw exhaustive(event);
                            }
                        },
                    ),
                ),
                (async () => {
                    const realtimeKeys = new Set<string>();

                    const dynamoEventTransaction = eventTransaction.map(
                        (event): DynamoGeneralRealtimePrivateRealtimePartitionEvent => {
                            // Add the realtime event transaction to every partition affected by the
                            // transaction. That way we can search to find the transaction later using any
                            // partition key implicated in the transaction.
                            //
                            // We use an opaque partition key to avoid conflicting characters in this
                            // realtime item's partition key.
                            //
                            // If `realtimeQuery()` is disabled then we won't need to backfill a realtime
                            // query so we don't need to save event transactions under our table's
                            // partition key.
                            if (this._features?.realtimeQuery?.[event.partitionType]) {
                                realtimeKeys.add(event.partitionKey);
                            }

                            for (const [indexName, partitionKey] of concatIterables(
                                event.oldPartitionKeyByIndexName ?? emptyArray,
                                event.newPartitionKeyByIndexName ?? emptyArray,
                            )) {
                                const index = assertExists(event.indexByName?.get(indexName));

                                // If our index's partition key is the same as our table's partition key then
                                // we can save some WCUs by writing all updates under the table's partition key
                                // (which is used for `table.realtimeQuery()`).
                                if (index.canReuseTablePartitionKeyForRealtimeKey) {
                                    realtimeKeys.add(event.partitionKey);
                                } else {
                                    realtimeKeys.add(`${indexName}:${partitionKey}`);
                                }
                            }

                            return {
                                type: event.type,
                                key: event.key,
                                version: event.version,
                            };
                        },
                    );

                    const eventTime = new Date();

                    // Expire events after a couple days. If we are trying to backfill data from
                    // longer ago then we'll need a full refresh.
                    const expirationTime = addDays(
                        eventTime,
                        dynamoGeneralRealtimePrivatePartitionEventExpirationDays,
                    );

                    // Add the event transaction to every affected realtime key. When backfilling,
                    // we only query events from realtime keys we care about. If a transaction
                    // affected two realtime keys then it needs to be present in both to show up in a
                    // backfill query.
                    await runAllPromises(
                        mapIterable(realtimeKeys, realtimeKey => {
                            const item: DynamoGeneralRealtimePrivateRealtimePartitionItem = {
                                partitionType: dynamoGeneralRealtimePrivateRealtimePartitionName,
                                sortRangeType: "Events",
                                realtimeKey,
                                eventTime,
                                expirationTime,
                                eventTransaction: dynamoEventTransaction,
                            };
                            return this._table.createOrReplaceItem(context, item);
                        }),
                    );
                })(),
            ]);

            // Wait to send our events to clients until we've confirmed our events have
            // been written to DynamoDB.
            //
            // That way a strong consistency read of events in DynamoDB will give you all
            // events sent before the start of the read.
            await this._broadcastEventTransactionCallback(
                context,
                readTime,
                actualEventTransaction,
            );
        });
    }

    /**
     * Create an item in the database.
     *
     * An item with the same key must not already exist. If it does this method
     * will throw an error. We do not support replacing items in realtime table
     * schemas because we need to maintain the item's version number across updates
     * to correctly order events received out-of-order on the client.
     */
    public async createItem<Item extends Types["Item"]>(
        context: ServerActionContextWithBroadcast,
        item: Item,
        options?: {isConditionCheckErrorRetriable?: boolean},
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        >;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);

        // We backfill realtime updates to `readTime` so the `readTime` of our event
        // transaction should be before the data is written from the database to avoid
        // missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            await this._table.createItem(context, item, options);
        } else {
            await DynamoTableSchema.executeTransaction(context, [
                this._table.transactionCreateItem(item, options),
                this._table.transactionDoesNotExistConditionCheck(
                    cast<DynamoGeneralRealtimePrivateGraveyardPartitionItemKey>({
                        partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: partitionKey,
                        deletedSortKey: sortKey,
                    }),
                ),
            ]);
        }

        const version = item.updateLockVersion ?? 0;

        const indexByName = this._indexByNameByItemType.get(itemType);
        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        context.process.waitUntil(
            this._broadcastEventTransaction(context, readTime, [
                {
                    type: "PutItem",
                    partitionType: item.partitionType,
                    sortRangeType: item.sortRangeType,
                    itemKey: item as Types["ItemKey"],
                    partitionKey,
                    key,
                    version,
                    getEvent,
                    indexByName,
                    oldPartitionKeyByIndexName: undefined,
                    newPartitionKeyByIndexName,
                },
            ]),
        );

        return {getEvent};
    }

    /**
     * Create an item in the database but only if an item with the same key does
     * not already exist. If an item with the same key does exist then this will
     * not do anything.
     *
     * Dangerous since we don't send a realtime event if this succeeds. Useful
     * when seeding the database and we aren't in an action context.
     */
    public async dangerouslyCreateItemIfNoneExistsWithoutEvent<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<{
        wasCreated: boolean;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.createItemIfNoneExists(context, item);
    }

    /**
     * Directly update an item in the database with the new item object.
     *
     * The new item object must have an `updateLockVersion` that matches the
     * `updateLockVersion` of the item currently in the database. Otherwise this
     * function will throw an error. If you wrap your action in
     * `context.dynamo.retryTransaction()` then `updateLockVersion` errors will be
     * retried so you can attempt reading the latest value from the database.
     *
     * If you're updating an attribute in one of the table's index partition keys
     * then you must provide an `oldItem`. This is because we need to know the
     * previous values of indexed attributes so we can send a realtime event that
     * removes the item from any queries it was previously in.
     *
     * If you don't want to write a retry loop yourself, consider using
     * `updateItem()` which does it for you.
     */
    public async directlyUpdateItem<Item extends Types["Item"]>(
        context: ServerActionContextWithBroadcast,
        item: Item,
        {oldItem = item}: {oldItem?: Item} = {},
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        >;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, key} = this._table.serializeOpaqueItemKeyAndPartitionKey(item);

        let condition: DynamoCondition<Item> | undefined;

        if (oldItem !== item) {
            assert(key === this._table.serializeOpaqueItemKey(oldItem));
            assert(oldItem.updateLockVersion === item.updateLockVersion);
        }

        const indexByName = this._indexByNameByItemType.get(itemType);

        // We need to test to make sure the attributes in the index partition keys of
        // `oldItem` are what's actually in the database. Since we use these attributes
        // from `oldItem` in `oldPartitionKeyByIndexName` which is used to generate
        // diffs that tell the client whether an item has left a particular query.
        if (indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};
                        actualCondition[attributeName] = oldItem[attributeName];
                    }
                }
            }

            condition = actualCondition as any;
        }

        // We backfill realtime updates to `readTime` so the `readTime` of our event
        // transaction should be before the data is written from the database to avoid
        // missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        const newItem = await this._table.directlyUpdateItem(context, item, {condition});

        const version = newItem.updateLockVersion ?? 0;

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;
        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                oldPartitionKeyByIndexName ??= new Map();
                oldPartitionKeyByIndexName.set(
                    indexName,
                    index.serializeOpaquePartitionKey(oldItem),
                );

                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(
                    indexName,
                    index.serializeOpaquePartitionKey(newItem),
                );
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item: newItem,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        context.process.waitUntil(
            this._broadcastEventTransaction(context, readTime, [
                {
                    type: "PutItem",
                    partitionType: newItem.partitionType,
                    sortRangeType: newItem.sortRangeType,
                    itemKey: newItem as Types["ItemKey"],
                    partitionKey,
                    key,
                    version,
                    getEvent,
                    indexByName,
                    oldPartitionKeyByIndexName,
                    newPartitionKeyByIndexName,
                },
            ]),
        );

        return {getEvent};
    }

    /**
     * Update an item in the database based on its previous value.
     *
     * Uses [optimistic concurrency control][1] to make sure we don't clobber
     * other updates. If a concurrent process updated the same item before we
     * did then we will discard our update and retry the provided `update`
     * function.
     *
     * If you want to manually implement an update retry loop (perhaps to perform
     * your update in a transaction) then you may use `directlyUpdateItem()` or
     * `transactionDirectlyUpdateItem()` with `context.dynamo.retryTransaction()`.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     */
    public async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContextWithBroadcast,
        itemKey: ItemKey,
        update: (
            item: MergeObjectIntersection<Types["Item"] & ItemKey>,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & ItemKey>>,
        options: {initialItem: Types["Item"] & ItemKey},
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]
            >
        >;
    }>;
    public async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContextWithBroadcast,
        itemKey: ItemKey,
        update: (
            item: MergeObjectIntersection<Types["Item"] & ItemKey> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & ItemKey>>,
        options?: {initialItem?: Types["Item"] & ItemKey},
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]
            >
        >;
    }>;
    public async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContextWithBroadcast,
        itemKey: ItemKey,
        // Typed as `never` since a caller should always match one of the overloads,
        // not this base definition.
        update: never,
        {initialItem}: {initialItem?: Types["Item"] & ItemKey} = {},
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]
            >
        >;
    }> {
        let hasAttempted = false;

        return context.dynamo.retryTransaction(async context => {
            const isInitialAttempt = !hasAttempted;
            hasAttempted = true;

            const item =
                isInitialAttempt && initialItem
                    ? initialItem
                    : await this.getItemIfExists(context, itemKey);

            const newItem: Types["Item"] & ItemKey = await (update as any)(item);

            // We don't currently support deleting items from this method. We can easily
            // add this eventually though now that we have the `deleteItem()` method.
            assert(newItem !== null);

            // Update was short-circuited.
            if (item === newItem) {
                const key = this._table.serializeOpaqueItemKey(item);
                const version = item.updateLockVersion ?? 0;

                const itemType = `${item.partitionType}#${item.sortRangeType}`;
                const indexByName = this._indexByNameByItemType.get(itemType);
                let partitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

                if (indexByName) {
                    for (const [indexName, index] of indexByName) {
                        partitionKeyByIndexName ??= new Map();
                        partitionKeyByIndexName.set(
                            indexName,
                            index.serializeOpaquePartitionKey(item),
                        );
                    }
                }

                const getEvent = this._createGetPutItemEvent({
                    key,
                    version,
                    item,
                    indexByName,
                    partitionKeyByIndexName,
                });

                return {getEvent};
            }

            if (item === null) {
                return this.createItem(context, newItem, {isConditionCheckErrorRetriable: true});
            } else {
                return this.directlyUpdateItem(context, newItem, {oldItem: item});
            }
        });
    }

    /**
     * Deletes an item from the database. If the item doesn't exist or the item
     * doesn't match the item's update lock version, we throw a condition check
     * error.
     *
     * This action leaves a gravestone in the database with the `updateLockVersion`
     * of the deleted item incremented by one. If you want to undelete the item
     * then you must get this `updateLockVersion` value
     * (`getDeletedItemIfExists()`) and pass it into `undeleteItem()`. You may not
     * `createItem()` with the same key if there's a deleted item gravestone.
     *
     * This way if you delete an item then undelete it the client will know to use
     * the undeleted item over the previous item since the undeleted item has a
     * higher version number.
     *
     * To use this function you must enable it with the `features.deleteItem`
     * object passed into `DynamoGeneralRealtimeTableSchema`.
     */
    public async deleteItem<Item extends Types["Item"]>(
        context: ServerActionContextWithBroadcast,
        item: Item,
    ): Promise<void> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);

        let condition: DynamoCondition<Item> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        // We need to test to make sure the attributes in the index partition keys of
        // `item` are what's actually in the database. Since we use these attributes
        // from `item` in `oldPartitionKeyByIndexName` which is used to generate
        // diffs that tell the client whether an item has left a particular query.
        if (indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};
                        actualCondition[attributeName] = item[attributeName];
                    }
                }
            }

            condition = actualCondition as any;
        }

        // We backfill realtime updates to `readTime` so the `readTime` of our event
        // transaction should be before the data is written from the database to avoid
        // missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        await DynamoTableSchema.executeTransaction(context, [
            this._table.transactionDeleteItem(item, {condition}),
            this._table.transactionCreateOrReplaceItem(
                cast<DynamoGeneralRealtimePrivateGraveyardPartitionItem>({
                    partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                    sortRangeType: "Gravestone",
                    deletedPartitionKey: partitionKey,
                    deletedSortKey: sortKey,
                    updateLockVersion: (item.updateLockVersion ?? 0) + 1,
                }),
            ),
        ]);

        const version = (item.updateLockVersion ?? 0) + 1;

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                oldPartitionKeyByIndexName ??= new Map();
                oldPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        context.process.waitUntil(
            this._broadcastEventTransaction(context, readTime, [
                {
                    type: "DeleteItem",
                    partitionType: item.partitionType,
                    sortRangeType: item.sortRangeType,
                    itemKey: item as Types["ItemKey"],
                    partitionKey,
                    key,
                    version,
                    indexByName,
                    oldPartitionKeyByIndexName,
                    newPartitionKeyByIndexName: undefined,
                },
            ]),
        );
    }

    /**
     * If the item with the provided key was deleted then this returns the
     * gravestone for the item. You need this gravestone to call `undeleteItem()`.
     *
     * See `deleteItem()` for more information.
     *
     * To use this function you must enable it with the `features.deleteItem`
     * object passed into `DynamoGeneralRealtimeTableSchema`.
     */
    public async getDeletedItemIfExists<ItemKey extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: ItemKey,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<{updateLockVersion: number | undefined} | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        if (!this._features?.deleteItem?.[itemKey.partitionType]?.[itemKey.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${itemKey.partitionType}\`, sort range type: \`${itemKey.sortRangeType}\`)`,
            );
        }

        const {partitionKey, sortKey} =
            this._table.serializeOpaqueItemPartitionKeyAndSortKey(itemKey);

        const gravestoneItem = await this._table.getItemIfExists(
            context,
            cast<DynamoGeneralRealtimePrivateGraveyardPartitionItemKey>({
                partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                sortRangeType: "Gravestone",
                deletedPartitionKey: partitionKey,
                deletedSortKey: sortKey,
            }),
            options,
        );
        if (!gravestoneItem) return null;

        return {updateLockVersion: gravestoneItem.updateLockVersion};
    }

    /**
     * Undeletes an item previously deleted with `deleteItem()`. If you want to
     * re-create a previously deleted item you may not use `createItem()` since
     * that restarts the item's `updateLockVersion` at 0. Instead you must call
     * `getDeletedItemIfExists()` then `undeleteItem()` with the gravestone
     * returned by that function.
     *
     * See `deleteItem()` for more information.
     *
     * To use this function you must enable it with the `features.deleteItem`
     * object passed into `DynamoGeneralRealtimeTableSchema`.
     */
    public async undeleteItem<Item extends Types["Item"]>(
        context: ServerActionContextWithBroadcast,
        deletedItem: {updateLockVersion: number | undefined},
        item: Item,
    ): Promise<{
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        >;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);

        // We backfill realtime updates to `readTime` so the `readTime` of our event
        // transaction should be before the data is written from the database to avoid
        // missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        await DynamoTableSchema.executeTransaction(context, [
            this._table.transactionDeleteItem(
                cast<DynamoGeneralRealtimePrivateGraveyardPartitionItem>({
                    partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                    sortRangeType: "Gravestone",
                    deletedPartitionKey: partitionKey,
                    deletedSortKey: sortKey,
                    updateLockVersion: deletedItem.updateLockVersion,
                }),
            ),
            this._table.transactionCreateOrReplaceItem({
                ...item,
                updateLockVersion: (deletedItem.updateLockVersion ?? 0) + 1,
            }),
        ]);

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const version = (deletedItem.updateLockVersion ?? 0) + 1;

        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        context.process.waitUntil(
            this._broadcastEventTransaction(context, readTime, [
                {
                    type: "PutItem",
                    partitionType: item.partitionType,
                    sortRangeType: item.sortRangeType,
                    itemKey: item as Types["ItemKey"],
                    partitionKey,
                    key,
                    version,
                    getEvent,
                    indexByName,
                    oldPartitionKeyByIndexName: undefined,
                    newPartitionKeyByIndexName,
                },
            ]),
        );

        return {getEvent};
    }

    /**
     * Perform multiple actions atomically. Either all actions in the transaction
     * succeed or if one action fails then none of the actions in the transaction
     * will be applied.
     *
     * Supports realtime transaction entries from this class unlike
     * `DynamoTableSchema`. But may also include non-realtime transaction entries
     * from `DynamoTableSchema`.
     */
    public static async executeTransaction(
        context: ServerActionContextWithBroadcast,
        entries: ReadonlyArray<DynamoTransactionEntry | DynamoGeneralRealtimeTransactionEntry>,
        options?: {clientRequestToken?: string},
    ): Promise<{
        getEventTransaction: <
            Types extends DynamoTableSchemaTypesBase,
            ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
        >(
            context: ServerContentActionContext,
            schema: DynamoGeneralRealtimeTableSchema<Types, ModelMap>,
        ) => Promise<Array<DynamoGeneralRealtimeEvent<ModelMap[string][string]>>>;
    }> {
        const eventsBySchema = new Map<
            DynamoGeneralRealtimeTableSchema<
                DynamoTableSchemaTypesBase,
                {[partitionType: string]: {[sortRangeType: string]: any}}
            >,
            Array<DynamoGeneralRealtimeInternalEvent<any, any>>
        >();

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        await DynamoTableSchema.executeTransaction(
            context,
            entries.flatMap(entry => {
                if (entry instanceof DynamoTransactionEntry) return entry;
                const {entry: actualEntry, schema, event} = entry._get(privateSymbol);
                getOrSetDefaultMapValue(eventsBySchema, schema, () => []).push(event);
                return actualEntry;
            }),
            options,
        );

        context.process.waitUntil(async () => {
            await runAllPromises(
                mapIterable(eventsBySchema, ([schema, events]) =>
                    schema._broadcastEventTransaction(context, readTime, events),
                ),
            );
        });

        return {
            getEventTransaction: (context, schema) => {
                const events = eventsBySchema.get(schema);

                return runAllPromises(
                    (events ?? emptyArray).map(event => {
                        switch (event.type) {
                            case "PutItem": {
                                return event.getEvent(context);
                            }
                            case "DeleteItem": {
                                return {
                                    type: "DeleteItem",
                                    item: {key: event.key, version: event.version},
                                    indexes: schema._getDeleteItemEventIndexes(event),
                                };
                            }
                            default:
                                throw exhaustive(event);
                        }
                    }),
                );
            },
        };
    }

    /**
     * Create an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `createItem()` for more information.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionCreateItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoGeneralRealtimeTransactionEntry {
        return this.transactionCreateItemWithEvent(item).transactionEntry;
    }

    /**
     * Create an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `createItem()` for more information.
     *
     * This function also returns methods to get the realtime item we create for
     * this transaction. This is useful if you need to use the realtime item
     * afterwards.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionCreateItemWithEvent<const Item extends Types["Item"]>(
        item: Item,
    ): {
        transactionEntry: DynamoGeneralRealtimeTransactionEntry;
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        >;
    } {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);
        const version = item.updateLockVersion ?? 0;

        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        const event: DynamoGeneralRealtimeInternalEvent<unknown, unknown> = {
            type: "PutItem",
            partitionType: item.partitionType,
            sortRangeType: item.sortRangeType,
            itemKey: item as Types["ItemKey"],
            partitionKey,
            key,
            version,
            getEvent,
            indexByName,
            oldPartitionKeyByIndexName: undefined,
            newPartitionKeyByIndexName,
        };

        let transactionEntry;

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            transactionEntry = DynamoGeneralRealtimeTransactionEntry._new(
                privateSymbol,
                this._table.transactionCreateItem(item),
                this,
                event,
            );
        } else {
            transactionEntry = DynamoGeneralRealtimeTransactionEntry._new(
                privateSymbol,
                [
                    this._table.transactionCreateItem(item),
                    this._table.transactionDoesNotExistConditionCheck(
                        cast<DynamoGeneralRealtimePrivateGraveyardPartitionItemKey>({
                            partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                            sortRangeType: "Gravestone",
                            deletedPartitionKey: partitionKey,
                            deletedSortKey: sortKey,
                        }),
                    ),
                ],
                this,
                event,
            );
        }

        return {
            transactionEntry,
            getEvent,
        };
    }

    /**
     * Update an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `directlyUpdateItem()` for more information.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        item: Item,
        options?: {oldItem?: Item},
    ): DynamoGeneralRealtimeTransactionEntry {
        return this.transactionDirectlyUpdateItemWithEvent(item, options).transactionEntry;
    }

    /**
     * Update an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `directlyUpdateItem()` for more information.
     *
     * This function also returns methods to get the realtime item we create for
     * this transaction. This is useful if you need to use the realtime item
     * afterwards.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionDirectlyUpdateItemWithEvent<Item extends Types["Item"]>(
        item: Item,
        {oldItem = item}: {oldItem?: Item} = {},
    ): {
        transactionEntry: DynamoGeneralRealtimeTransactionEntry;
        getEvent: (
            context: ServerContentActionContext,
        ) => Promise<
            DynamoGeneralRealtimePutItemEvent<
                ModelMap[Item["partitionType"]][Item["sortRangeType"]]
            >
        >;
    } {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, key} = this._table.serializeOpaqueItemKeyAndPartitionKey(item);
        const version = (item.updateLockVersion ?? 0) + 1;

        let condition: DynamoCondition<Item> | undefined;

        if (oldItem !== item) {
            assert(key === this._table.serializeOpaqueItemKey(oldItem));
            assert(oldItem.updateLockVersion === item.updateLockVersion);
        }

        const indexByName = this._indexByNameByItemType.get(itemType);

        // We need to test to make sure the attributes in the index partition keys of
        // `oldItem` are what's actually in the database. Since we use these attributes
        // from `oldItem` in `oldPartitionKeyByIndexName` which is used to generate
        // diffs that tell the client whether an item has left a particular query.
        if (indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};
                        actualCondition[attributeName] = oldItem[attributeName];
                    }
                }
            }

            condition = actualCondition as any;
        }

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;
        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                oldPartitionKeyByIndexName ??= new Map();
                oldPartitionKeyByIndexName.set(
                    indexName,
                    index.serializeOpaquePartitionKey(oldItem),
                );

                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        const transactionEntry = DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionDirectlyUpdateItem(item, {condition}),
            this,
            {
                type: "PutItem",
                partitionType: item.partitionType,
                sortRangeType: item.sortRangeType,
                itemKey: item as Types["ItemKey"],
                partitionKey,
                key,
                version,
                getEvent,
                indexByName,
                oldPartitionKeyByIndexName,
                newPartitionKeyByIndexName,
            },
        );

        return {
            transactionEntry,
            getEvent,
        };
    }

    /**
     * Deletes an item from the database as part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `deleteItem()` for more information.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     *
     * To use this function you must enable it with the `features.deleteItem`
     * object passed into `DynamoGeneralRealtimeTableSchema`.
     */
    public transactionDeleteItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoGeneralRealtimeTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);

        let condition: DynamoCondition<Item> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        // We need to test to make sure the attributes in the index partition keys of
        // `item` are what's actually in the database. Since we use these attributes
        // from `item` in `oldPartitionKeyByIndexName` which is used to generate
        // diffs that tell the client whether an item has left a particular query.
        if (indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};
                        actualCondition[attributeName] = item[attributeName];
                    }
                }
            }

            condition = actualCondition as any;
        }

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                oldPartitionKeyByIndexName ??= new Map();
                oldPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            [
                this._table.transactionDeleteItem(item, {condition}),
                this._table.transactionCreateOrReplaceItem(
                    cast<DynamoGeneralRealtimePrivateGraveyardPartitionItem>({
                        partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: partitionKey,
                        deletedSortKey: sortKey,
                        updateLockVersion: (item.updateLockVersion ?? 0) + 1,
                    }),
                ),
            ],
            this,
            {
                type: "DeleteItem",
                partitionType: item.partitionType,
                sortRangeType: item.sortRangeType,
                itemKey: item as Types["ItemKey"],
                key,
                partitionKey,
                version: (item.updateLockVersion ?? 0) + 1,
                indexByName,
                oldPartitionKeyByIndexName,
                newPartitionKeyByIndexName: undefined,
            },
        );
    }

    /**
     * Undeletes an item previously deleted with `deleteItem()` as part of a
     * transaction. In a transaction either all entries succeed or all entries
     * fail. See the documentation on `deleteItem()` for more information.
     *
     * You execute realtime transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     *
     * To use this function you must enable it with the `features.deleteItem`
     * object passed into `DynamoGeneralRealtimeTableSchema`.
     */
    public transactionUndeleteItem<Item extends Types["Item"]>(
        deletedItem: {updateLockVersion: number | undefined},
        item: Item,
    ): DynamoGeneralRealtimeTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        if (!this._features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, sortKey, key} =
            this._table.serializeOpaqueItemKeyAndPartitionKeyAndSortKey(item);
        const version = (deletedItem.updateLockVersion ?? 0) + 1;

        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            [
                this._table.transactionDeleteItem(
                    cast<DynamoGeneralRealtimePrivateGraveyardPartitionItem>({
                        partitionType: dynamoGeneralRealtimePrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: partitionKey,
                        deletedSortKey: sortKey,
                        updateLockVersion: deletedItem.updateLockVersion,
                    }),
                ),
                this._table.transactionCreateOrReplaceItem({
                    ...item,
                    updateLockVersion: (deletedItem.updateLockVersion ?? 0) + 1,
                }),
            ],
            this,
            {
                type: "PutItem",
                partitionType: item.partitionType,
                sortRangeType: item.sortRangeType,
                itemKey: item as Types["ItemKey"],
                key,
                partitionKey,
                version,
                getEvent,
                indexByName,
                oldPartitionKeyByIndexName: undefined,
                newPartitionKeyByIndexName,
            },
        );
    }

    /**
     * Checks whether an item exists and optionally some other conditions on
     * the item. If this condition fails then the entire transaction fails.
     */
    public transactionConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
        condition?: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.transactionConditionCheck(itemKey, condition);
    }

    /**
     * Checks that an item does not exist as a part of a transaction. If this
     * condition fails then the entire transaction fails.
     */
    public transactionDoesNotExistConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.transactionDoesNotExistConditionCheck(itemKey);
    }

    /**
     * Create an item in the database as part of a transaction. In a transaction
     * either all entries succeed or all entries fail.
     *
     * Under the hood this uses `DynamoTableSchema.transactionCreateOrReplaceItem()`
     * or simply the `PutItem` DynamoDB transaction action which doesn't use read
     * request units. This is cheaper than `transactionCreateItem()` but dangerous
     * since if you replace an item that exists our realtime communication with the
     * client will break! The client may think the old item that was replaced is
     * actually the latest data since the new item resets the version to 0.
     *
     * You may use this to save cost if you have other mechanisms in place to make
     * absolutely sure the item you're inserting does not currently exist.
     */
    public transactionDangerouslyCreateItemWithoutExistenceConditionCheck<
        Item extends Types["Item"],
    >(item: Item): DynamoGeneralRealtimeTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {partitionKey, key} = this._table.serializeOpaqueItemKeyAndPartitionKey(item);
        const version = item.updateLockVersion ?? 0;

        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const indexByName = this._indexByNameByItemType.get(itemType);

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));
            }
        }

        const getEvent = this._createGetPutItemEvent({
            key,
            version,
            item,
            indexByName,
            partitionKeyByIndexName: newPartitionKeyByIndexName,
        });

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionCreateOrReplaceItem(item),
            this,
            {
                type: "PutItem",
                partitionType: item.partitionType,
                sortRangeType: item.sortRangeType,
                itemKey: item as Types["ItemKey"],
                partitionKey,
                key,
                version,
                getEvent,
                indexByName,
                oldPartitionKeyByIndexName: undefined,
                newPartitionKeyByIndexName,
            },
        );
    }

    /**
     * Create an item in the database as part of a transaction. In a transaction
     * either all entries succeed or all entries fail.
     *
     * See `transactionDangerouslyCreateItemWithoutExistenceConditionCheck()` for
     * a warning on the dangers of skipping the existence check.
     *
     * We also won't send a realtime update event to clients! So a client won't
     * even know an item was created. Because this method is very dangerous it's
     * basically only useful for implementing database migrations.
     */
    public transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent<
        Item extends Types["Item"],
    >(
        item: Item,
        options?: {onAfterTransactionExecutedSuccessfully?: () => void},
    ): DynamoTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.transactionCreateOrReplaceItem(item, options);
    }

    /**
     * Update a single attribute on the item with the specified key. The update is
     * serialized with all other updates of this item with `updateLockVersion`.
     *
     * See `DynamoTableSchema.transactionDirectlyUpdateItemAttribute()` for more
     * information.
     *
     * This method is dangerous for realtime tables because we can't send an update
     * event! We can only send an update event when we have the full item at the
     * time of the update. You should only use this method if you're confident it's
     * ok if the property is not updated in realtime.
     */
    public transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent<
        ItemKey extends Types["ItemKey"],
        Attribute extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        itemKey: ItemKey,
        attribute: Attribute,
        attributeValue: (Types["Item"] & ItemKey)[Attribute],
        options: {updateLockVersion: number | undefined},
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.transactionDirectlyUpdateItemAttribute(
            itemKey,
            attribute,
            attributeValue,
            options,
        );
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItem()` but can be part of a transaction that atomically
     * succeeds or fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     *
     * This method is dangerous for realtime tables because if you call
     * `createItem()` again with the same item key it'll restart from version 0
     * which will break realtime clients! Prefer using `deleteItem()` which leaves
     * a gravestone when you delete an item.
     *
     * If you want to delete an item from the table anyway while breaking this
     * table's realtime guarantees you may use this method.
     */
    public transactionDangerouslyDeleteItemWithoutGravestoneAndWithoutEvent<
        Item extends Types["Item"],
    >(item: Item): DynamoTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                item.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.transactionDeleteItem(item);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null.
     */
    public getItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.getItemIfExists(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     */
    public getItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.getItem(context, itemKey, options);
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Returns
     * `null` if the item does not exist.
     */
    public getPartialItemIfExists<
        Key extends Types["ItemKey"],
        Attributes extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        context: DynamoContext,
        itemKey: Key,
        options: {
            attributes: Array<Attributes>;
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>> | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.getPartialItemIfExists(context, itemKey, options);
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Throws
     * an error if the item doesn't exist.
     */
    public getPartialItem<
        Key extends Types["ItemKey"],
        Attributes extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        context: DynamoContext,
        itemKey: Key,
        options: {
            attributes: Array<Attributes>;
            consistency?: DynamoCacheReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.getPartialItem(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null. Also
     * returns all the auxillary information a client will need to maintain this
     * data in realtime.
     */
    public async getRealtimeItemIfExists<Key extends Types["ItemKey"]>(
        context: ServerContentActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<
        ModelMap[Key["partitionType"]][Key["sortRangeType"]]
    > | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const item = await this._table.getItemIfExists(context, itemKey, options);
        if (!item) return null;

        return {
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        };
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     * Also returns all the auxillary information a client will need to maintain
     * this data in realtime.
     */
    public async getRealtimeItem<Key extends Types["ItemKey"]>(
        context: ServerContentActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                itemKey.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        const item = await this._table.getItem(context, itemKey, options);

        return {
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        };
    }

    /**
     * Build a realtime item from a DynamoDB item object we've previously loaded.
     */
    public async buildRealtimeItem<Item extends Types["Item"]>(
        context: ServerContentActionContext,
        item: Item,
    ): Promise<DynamoGeneralRealtimeItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>> {
        return {
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        };
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB
     * collocates related data. Does not return information to keep the query
     * up-to-date in realtime. For realtime support use `realtimeQuery()`.
     */
    public query<
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: DynamoContext,
        options: {
            partitionKey: PartitionKey;
            startSortKey?: StartSortKey | undefined;
            endSortKey?: EndSortKey | undefined;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            consistency?: DynamoCacheReadConsistency;
        },
    ): AsyncIterableIterator<
        MergeObjectIntersection<
            Types["Item"] &
                PartitionKey & {
                    readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                }
        >
    > {
        assert(
            options.partitionKey.partitionType !==
                dynamoGeneralRealtimePrivateRealtimePartitionName &&
                options.partitionKey.partitionType !==
                    dynamoGeneralRealtimePrivateGraveyardPartitionName,
            "Can’t access private realtime partition",
        );

        return this._table.query(context, options);
    }

    public getRealtimeQueryPartitionKey(partitionKey: Types["PartitionKey"]) {
        if (!this._features?.realtimeQuery?.[partitionKey.partitionType]) {
            throw new InternalError(
                `Realtime queries are disabled (partition type: \`${partitionKey.partitionType}\`)`,
            );
        }

        return this._table.serializeOpaqueItemPartitionKey(partitionKey);
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB
     * collocates related data. Also returns all the auxillary information
     * necessary for a client to keep a query up-to-date in realtime.
     */
    public async realtimeQuery<
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: ServerContentActionContext,
        {
            partitionKey,
            startSortKey,
            endSortKey,
            paginate = {type: "FromStart"},
            limit,
            consistency,
            onItem,
        }: {
            partitionKey: PartitionKey;
            startSortKey?: StartSortKey;
            endSortKey?: EndSortKey;
            paginate?:
                | {
                      type: "FromStart";
                      afterItemKey?: DynamoItemKey | null;
                  }
                | {
                      type: "FromEnd";
                      beforeItemKey?: DynamoItemKey | null;
                  };
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            consistency?: DynamoCacheReadConsistency;
            onItem?: (
                item: DynamoGeneralRealtimeItem<
                    ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
                >,
            ) => void;
        },
    ): Promise<
        DynamoGeneralRealtimeQueryResult<
            ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
        >
    > {
        if (!this._features?.realtimeQuery?.[partitionKey.partitionType]) {
            throw new InternalError(
                `Realtime queries are disabled (partition type: \`${partitionKey.partitionType}\`)`,
            );
        }

        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const paginateItemKeyString =
            paginate.type === "FromStart" ? paginate.afterItemKey : paginate.beforeItemKey;

        const paginateItemKey = paginateItemKeyString
            ? this._table.deserializeOpaqueItemKey(paginateItemKeyString)
            : undefined;

        // Make sure the partition key part of `paginateItemKey` is the same as our
        // `partitionKey`.
        if (paginateItemKey) {
            if (paginateItemKey.partitionType !== partitionKey.partitionType) {
                throw new InvalidArgumentError(
                    quote`Pagination item key (partition type: ${paginateItemKey.partitionType}) must have the same partition type as query partition key (partition type: ${partitionKey.partitionType})`,
                );
            }

            const partitionKeyAttributes = this._table.getPartitionKeyAttributes(
                partitionKey.partitionType,
            );

            for (const [attributeName, attributeSchema] of Object.entries(partitionKeyAttributes)) {
                if (
                    attributeSchema.serialize(paginateItemKey[attributeName]) !==
                    attributeSchema.serialize(partitionKey[attributeName])
                ) {
                    throw new InvalidArgumentError(
                        quote`Partition item key must have the same value for attribute ${attributeName} as query partition key`,
                    );
                }
            }
        }

        const items = await parallelMapAsyncIterableToArray(
            this._table.query(context, {
                partitionKey,
                startSortKey,
                endSortKey,
                afterItemKey: paginateItemKey as any,
                descending: paginate.type === "FromEnd",
                // Fetch one extra item so we can accurately say whether there are more items
                // at the beginning or end of the query.
                limit: typeof limit === "number" ? limit + 1 : limit,
                consistency,
            }),
            async (item, index) => {
                // Don't build the model for an over-fetched item we use to determine if there
                // are more items in the query.
                if (typeof limit === "number" && index >= limit) return null;

                const realtimeItem = {
                    key: this._table.serializeOpaqueItemKey(item),
                    version: item.updateLockVersion ?? 0,
                    model: await this._buildModel(context, item),
                };

                // If you want to observe query items immediately after they're built you
                // can use the `onItem` callback.
                onItem?.(realtimeItem);

                return realtimeItem;
            },
        );

        const startItemKey = startSortKey
            ? this._table.serializeOpaqueItemKey({...startSortKey, ...partitionKey})
            : null;

        const endItemKey = endSortKey
            ? this._table.serializeOpaqueItemKey({...endSortKey, ...partitionKey})
            : null;

        const hasMoreItems = typeof limit === "number" && items.length > limit;

        // Remove any items we over-fetched to determine if there were items after the
        // limit. (Should just be one.)
        while (typeof limit === "number" && items.length > limit) {
            items.pop();
        }

        // When paginating from the end, we queried items in descending order. Reverse
        // them to get them back to the proper order.
        if (paginate.type === "FromEnd") {
            items.reverse();
        }

        // We should have removed all null items past our limit above.
        const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

        // If we are in a development or test environment, verify that key
        // strings are orderable. This would create overhead in production.
        if (process.env.NODE_ENV !== "production") {
            let lastItemKey: DynamoItemKey | null = null;

            for (const item of finalItems) {
                if (lastItemKey === null) {
                    lastItemKey = item.key;
                } else {
                    assert(
                        lastItemKey < item.key,
                        "Expected keys to be lexicographically orderable",
                    );
                    lastItemKey = item.key;
                }
            }
        }

        return {
            readTime,
            partitionKey: this._table.serializeOpaqueItemPartitionKey(partitionKey),
            startItemKey,
            endItemKey,
            pageInfo:
                paginate.type === "FromStart"
                    ? {
                          type: "FromStart",
                          afterItemKey: paginate.afterItemKey ?? null,
                          hasNextPage: hasMoreItems,
                      }
                    : {
                          type: "FromEnd",
                          beforeItemKey: paginate.beforeItemKey ?? null,
                          hasPreviousPage: hasMoreItems,
                      },
            items: finalItems,
        };
    }

    /**
     * Backfill any updates that happened since the query was read and now. Useful
     * when you connect to realtime after dispatching your query.
     */
    public backfillRealtimeQuery<const PartitionKey extends Types["PartitionKey"]>(
        context: ServerContentActionContext,
        {partitionKey, readTime}: {partitionKey: PartitionKey; readTime: Date},
    ): Promise<
        DynamoGeneralRealtimeBackfillResult<
            ModelMap[PartitionKey["partitionType"]][keyof ModelMap[PartitionKey["partitionType"]]]
        >
    > {
        const partitionKeyString = this._table.serializeOpaqueItemPartitionKey(partitionKey);

        return this._backfillRealtimeQuery(context, {
            realtimeKey: partitionKeyString,
            readTime,
            source: {
                type: "Table",
                partitionKey: partitionKeyString,
            },
        });
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
        options: {
            limit?: number;
            consistency?: DynamoReadConsistency;
            segmentIndex?: number;
            totalSegmentCount?: number;
            filter?: Types["ItemType"] | Array<Types["ItemType"]>;
        } = {},
    ): AsyncIterableIterator<MergeObjectIntersection<Types["Item"]>> {
        for await (const item of this._table.expensiveScan(context, options)) {
            if (item.partitionType === dynamoGeneralRealtimePrivateRealtimePartitionName) continue;
            if (item.partitionType === dynamoGeneralRealtimePrivateGraveyardPartitionName) continue;
            yield item;
        }
    }

    /**
     * Adds an index to the table that replicates the entire item in the index.
     * This doubles your storage costs for the table! Once for the base table and
     * once for the index. You should have ideally zero indexes on the table but if
     * you absolutely need them don't create too many.
     *
     * Index queries contain a cursor for every item. The lexicographic order of
     * cursors is the same order as items in the index which allows the client to
     * sort locally.
     *
     * Our realtime implementation shares the index name you provide here with the
     * client! Make sure this name doesn't contain any secrets.
     *
     * ## Tradeoffs
     *
     * Look at `addIndexWithQueryJoin()` and consider if it provides better
     * performance characteristics for your use case.
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
        config: Omit<
            DynamoTableSchemaIndexConfigOptions<
                Types,
                ItemTypes,
                PartitionKeyAttributesConfig,
                SortKeyAttributesConfig
            >,
            "includePrimaryKeyInSortKey"
        >,
    ): DynamoGeneralRealtimeTableSchemaIndex<
        ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]],
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                    itemType.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            ),
            "Can’t access private realtime partition",
        );

        const Index = this._table.addExpensiveFullIndex<
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >({
            ...config,
            // For realtime tables, always include the primary key in the index sort key so
            // that index keys are unique and we can correctly sort items in user-land.
            includePrimaryKeyInSortKey: true,
        });

        const partitionTypes = new Set(config.itemTypes.map(itemType => itemType.partitionType));

        // If there is only partition type, we call it the index's "exclusive"
        // partition type.
        const exclusivePartitionType =
            partitionTypes.size === 1 ? Array.from(partitionTypes)[0]! : null;

        // We can reuse the table partition key as our index's realtime key
        // and reduce the write capacity units we use when:
        //
        // - The index only serves data from a single partition
        // - The index's partition key matches that partition's partition key
        //
        // This also means we can derive the partition key from our index partition key
        // plus adding `partitionType: exclusivePartitionType`.
        const canReuseTablePartitionKeyForRealtimeKey: boolean =
            !!exclusivePartitionType &&
            isDeepEqual(
                Object.entries(
                    mapObjectValues(
                        this._table.getPartitionKeyAttributes(exclusivePartitionType),
                        attribute => attribute.description,
                    ),
                ),
                Object.entries(
                    mapObjectValues(
                        Index.partitionKeyAttributes,
                        attribute => attribute.description,
                    ),
                ),
            );

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const indexByName = getOrSetDefaultMapValue(
                this._indexByNameByItemType,
                itemType,
                () => new Map(),
            );

            const keyAttributes = this._table.getKeyAttributes(partitionType, sortRangeType);

            assert(!indexByName.has(config.name));
            indexByName.set(config.name, {
                canReuseTablePartitionKeyForRealtimeKey,
                dynamicPartitionKeyAttributeNames: Object.keys(Index.partitionKeyAttributes).filter(
                    attributeName =>
                        !hasOwnProperty(keyAttributes.partitionKeyAttributes, attributeName) &&
                        !hasOwnProperty(keyAttributes.sortKeyAttributes, attributeName),
                ),
                serializeOpaquePartitionKey: Index.serializeOpaquePartitionKey as (
                    partitionKey: unknown,
                ) => DynamoIndexPartitionKey,
                serializeOpaqueCursor: Index.serializeOpaqueCursor as (
                    partitionKey: unknown,
                ) => DynamoIndexCursor,
            });
        }

        return {
            name: config.name,
            partitionKeyAttributes: Index.partitionKeyAttributes,
            sortKeyAttributes: Index.sortKeyAttributes,

            getRealtimeQueryPartitionKey: partitionKey => {
                return Index.serializeOpaquePartitionKey(partitionKey);
            },

            realtimeQuery: async (
                context,
                {
                    partitionKey,
                    startSortKey,
                    endSortKey,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    paginate = {type: "FromStart"},
                    limit,
                },
            ): Promise<
                DynamoGeneralRealtimeIndexQueryResult<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // We backfill realtime updates to `readTime` so it should be before the data
                // is read from the database to avoid missing realtime updates.
                const readTime = new Date();

                const cursor =
                    paginate.type === "FromStart" ? paginate.afterCursor : paginate.beforeCursor;

                const items = await parallelMapAsyncIterableToArray(
                    Index.query(context, {
                        partitionKey,
                        startSortKey,
                        endSortKey,
                        isStartSortKeyExclusive,
                        isEndSortKeyExclusive,
                        descending: paginate.type === "FromEnd",
                        afterItemKey:
                            typeof cursor === "string"
                                ? Index.deserializeOpaqueCursor(partitionKey, cursor)
                                : undefined,
                        // Fetch one extra item so we can accurately say whether there are more items
                        // at the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                    }),
                    async (item, index) => {
                        // Don't build the model for an over-fetched item we use to determine if there
                        // are more items in the query.
                        if (typeof limit === "number" && index >= limit) return null;

                        return {
                            cursor: Index.serializeOpaqueCursor(item),
                            key: this._table.serializeOpaqueItemKey(item),
                            version: item.updateLockVersion ?? 0,
                            model: await this._buildModel(context, item),
                        };
                    },
                );

                const startCursorBound = startSortKey
                    ? Index.serializeOpaqueCursorBound(
                          startSortKey,
                          isStartSortKeyExclusive ? "StartExclusive" : "StartInclusive",
                      )
                    : null;

                const endCursorBound = endSortKey
                    ? Index.serializeOpaqueCursorBound(
                          endSortKey,
                          isEndSortKeyExclusive ? "EndExclusive" : "EndInclusive",
                      )
                    : null;

                const hasMoreItems = typeof limit === "number" && items.length > limit;

                // Remove any items we over-fetched to determine if there were items after the
                // limit. (Should just be one.)
                while (typeof limit === "number" && items.length > limit) {
                    items.pop();
                }

                // When paginating from the end, we queried items in descending order. Reverse
                // them to get them back to the proper order.
                if (paginate.type === "FromEnd") {
                    items.reverse();
                }

                // We should have removed all null items past our limit above.
                const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

                // If we are in a development or test environment, verify that cursors
                // strings are orderable. This would create overhead in production.
                if (process.env.NODE_ENV !== "production") {
                    let lastCursor: DynamoIndexCursor | null = null;

                    for (const item of finalItems) {
                        if (lastCursor === null) {
                            lastCursor = item.cursor;
                        } else {
                            assert(
                                lastCursor < item.cursor,
                                "Expected cursors to be lexicographically orderable",
                            );
                            lastCursor = item.cursor;
                        }
                    }
                }

                return {
                    readTime,
                    indexName: config.name,
                    partitionKey: Index.serializeOpaquePartitionKey(partitionKey),
                    startCursorBound,
                    endCursorBound,
                    pageInfo:
                        paginate.type === "FromStart"
                            ? {
                                  type: "FromStart",
                                  afterCursor: paginate.afterCursor ?? null,
                                  hasNextPage: hasMoreItems,
                              }
                            : {
                                  type: "FromEnd",
                                  beforeCursor: paginate.beforeCursor ?? null,
                                  hasPreviousPage: hasMoreItems,
                              },
                    items: finalItems,
                };
            },

            backfillRealtimeQuery: (context, {partitionKey, readTime}) => {
                const partitionKeyString = Index.serializeOpaquePartitionKey(partitionKey);

                return this._backfillRealtimeQuery(context, {
                    // If our index's partition key is the same as our table's partition key then
                    // we can save some WCUs by writing all updates under the table's partition key
                    // (which is used for `table.realtimeQuery()`).
                    realtimeKey: canReuseTablePartitionKeyForRealtimeKey
                        ? this._table.serializeOpaqueItemPartitionKey({
                              partitionType: exclusivePartitionType,
                              ...partitionKey,
                          })
                        : `${config.name}:${partitionKeyString}`,
                    readTime,
                    source: {
                        type: "Index",
                        name: config.name,
                        partitionKey: partitionKeyString,
                    },
                });
            },

            getPartitionKeyAttributeFromEvent: (attributeName, eventEntry) => {
                const oldPartitionKey = eventEntry.oldPartitionKeyByIndexName?.get(config.name);
                const newPartitionKey = eventEntry.newPartitionKeyByIndexName?.get(config.name);

                let oldValue: unknown;
                let newValue: unknown;

                if (oldPartitionKey !== undefined) {
                    oldValue = Index.deserializeOpaquePartitionKey(oldPartitionKey)[attributeName];
                }

                if (oldPartitionKey === newPartitionKey) {
                    newValue = oldValue;
                } else if (newPartitionKey !== undefined) {
                    newValue = Index.deserializeOpaquePartitionKey(newPartitionKey)[attributeName];
                }

                return {oldValue: oldValue as any, newValue: newValue as any};
            },
        };
    }

    /**
     * Adds an index to the table. Indexes allow you to build different access
     * patterns for your data.
     *
     * Index queries contain a cursor for every item. The lexicographic order of
     * cursors is the same order as items in the index which allows the client to
     * sort locally.
     *
     * Our realtime implementation shares the index name you provide here with the
     * client! Make sure this name doesn't contain any secrets.
     *
     * ## Tradeoffs
     *
     * Unlike `addExpensiveFullIndex()` we don't replicate the full item to the
     * index. Instead we only replicate the item key. However, at query time we
     * still need the full item so we call `getItem()` to grab it. The tradeoff
     * here is:
     *
     * - `addExpensiveFullIndex()` doubles our write costs and storage costs. Since
     *   we need to replicate the full item to the index.
     *
     * - `addIndexWithQueryJoin()` increases our write costs and storage costs a
     *   little (less than `addExpensiveFullIndex()`) but doubles our read costs.
     *   Since we only replicate the key and at query time we load the full item.
     *
     * `addIndexWithQueryJoin()` is better for you if:
     *
     * 1. Your items are big. Then the write/storage savings of
     *    `addIndexWithQueryJoin()` will be meaningful.
     *
     * 2. Queries are infrequent so they can afford to be slower.
     *
     * For example, forum posts use `addIndexWithQueryJoin()` because post content
     * can get quite large and posts are mostly read through the home feed or inbox
     * anyway (vs directly navigating to a channel which calls the query function).
     */
    public addIndexWithQueryJoin<
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
        config: Omit<
            DynamoTableSchemaIndexConfigOptions<
                Types,
                ItemTypes,
                PartitionKeyAttributesConfig,
                SortKeyAttributesConfig
            >,
            "includePrimaryKeyInSortKey"
        >,
    ): DynamoGeneralRealtimeTableSchemaIndex<
        ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]],
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== dynamoGeneralRealtimePrivateRealtimePartitionName &&
                    itemType.partitionType !== dynamoGeneralRealtimePrivateGraveyardPartitionName,
            ),
            "Can’t access private realtime partition",
        );

        const Index = this._table.addIndex<
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >({
            ...config,
            // For realtime tables, always include the primary key in the index sort key so
            // that index keys are unique and we can correctly sort items in user-land.
            includePrimaryKeyInSortKey: true,
        });

        const partitionTypes = new Set(config.itemTypes.map(itemType => itemType.partitionType));

        // If there is only partition type, we call it the index's "exclusive"
        // partition type.
        const exclusivePartitionType =
            partitionTypes.size === 1 ? Array.from(partitionTypes)[0]! : null;

        // We can reuse the table partition key as our index's realtime key
        // and reduce the write capacity units we need when:
        //
        // - The index only serves data from a single partition
        // - The index's partition key matches that partition's partition key
        //
        // This means we can get the partition key from our index partition key plus
        // adding `partitionType: exclusivePartitionType`.
        const canReuseTablePartitionKeyForRealtimeKey: boolean =
            !!exclusivePartitionType &&
            isDeepEqual(
                Object.entries(
                    mapObjectValues(
                        this._table.getPartitionKeyAttributes(exclusivePartitionType),
                        attribute => attribute.description,
                    ),
                ),
                Object.entries(
                    mapObjectValues(
                        Index.partitionKeyAttributes,
                        attribute => attribute.description,
                    ),
                ),
            );

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const indexByName = getOrSetDefaultMapValue(
                this._indexByNameByItemType,
                itemType,
                () => new Map(),
            );

            const keyAttributes = this._table.getKeyAttributes(partitionType, sortRangeType);

            assert(!indexByName.has(config.name));
            indexByName.set(config.name, {
                canReuseTablePartitionKeyForRealtimeKey,
                dynamicPartitionKeyAttributeNames: Object.keys(Index.partitionKeyAttributes).filter(
                    attributeName =>
                        !hasOwnProperty(keyAttributes.partitionKeyAttributes, attributeName) &&
                        !hasOwnProperty(keyAttributes.sortKeyAttributes, attributeName),
                ),
                serializeOpaquePartitionKey: Index.serializeOpaquePartitionKey as (
                    partitionKey: unknown,
                ) => DynamoIndexPartitionKey,
                serializeOpaqueCursor: Index.serializeOpaqueCursor as (
                    partitionKey: unknown,
                ) => DynamoIndexCursor,
            });
        }

        return {
            name: config.name,
            partitionKeyAttributes: Index.partitionKeyAttributes,
            sortKeyAttributes: Index.sortKeyAttributes,

            getRealtimeQueryPartitionKey: partitionKey => {
                return Index.serializeOpaquePartitionKey(partitionKey);
            },

            realtimeQuery: async (
                context,
                {
                    partitionKey,
                    startSortKey,
                    endSortKey,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    paginate = {type: "FromStart"},
                    limit,
                },
            ): Promise<
                DynamoGeneralRealtimeIndexQueryResult<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // We backfill realtime updates to `readTime` so it should be before the data
                // is read from the database to avoid missing realtime updates.
                const readTime = new Date();

                const cursor =
                    paginate.type === "FromStart" ? paginate.afterCursor : paginate.beforeCursor;

                const items = await parallelMapAsyncIterableToArray(
                    Index.query(context, {
                        partitionKey,
                        startSortKey,
                        endSortKey,
                        isStartSortKeyExclusive,
                        isEndSortKeyExclusive,
                        descending: paginate.type === "FromEnd",
                        afterItemKey:
                            typeof cursor === "string"
                                ? Index.deserializeOpaqueCursor(partitionKey, cursor)
                                : undefined,
                        // Fetch one extra item so we can accurately say whether there are more items
                        // at the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                    }),
                    async (itemKey, index) => {
                        // Don't build the model for an over-fetched item we use to determine if there
                        // are more items in the query.
                        if (typeof limit === "number" && index >= limit) return null;

                        // This is the critical "join" operation referenced by the name
                        // `addIndexWithQueryJoin()`. Basically everything else about this index
                        // creation is the same as `addExpensiveFullIndex()`.
                        const item = await this._table.getItem(context, itemKey);

                        return {
                            cursor: Index.serializeOpaqueCursor(item),
                            key: this._table.serializeOpaqueItemKey(item),
                            version: item.updateLockVersion ?? 0,
                            model: await this._buildModel(context, item),
                        };
                    },
                );

                const startCursorBound = startSortKey
                    ? Index.serializeOpaqueCursorBound(
                          startSortKey,
                          isStartSortKeyExclusive ? "StartExclusive" : "StartInclusive",
                      )
                    : null;

                const endCursorBound = endSortKey
                    ? Index.serializeOpaqueCursorBound(
                          endSortKey,
                          isEndSortKeyExclusive ? "EndExclusive" : "EndInclusive",
                      )
                    : null;

                const hasMoreItems = typeof limit === "number" && items.length > limit;

                // Remove any items we over-fetched to determine if there were items after the
                // limit. (Should just be one.)
                while (typeof limit === "number" && items.length > limit) {
                    items.pop();
                }

                // When paginating from the end, we queried items in descending order. Reverse
                // them to get them back to the proper order.
                if (paginate.type === "FromEnd") {
                    items.reverse();
                }

                // We should have removed all null items past our limit above.
                const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

                // If we are in a development or test environment, verify that cursors
                // strings are orderable. This would create overhead in production.
                if (process.env.NODE_ENV !== "production") {
                    let lastCursor: DynamoIndexCursor | null = null;

                    for (const item of finalItems) {
                        if (lastCursor === null) {
                            lastCursor = item.cursor;
                        } else {
                            assert(
                                lastCursor < item.cursor,
                                "Expected cursors to be lexicographically orderable",
                            );
                            lastCursor = item.cursor;
                        }
                    }
                }

                return {
                    readTime,
                    indexName: config.name,
                    partitionKey: Index.serializeOpaquePartitionKey(partitionKey),
                    startCursorBound,
                    endCursorBound,
                    pageInfo:
                        paginate.type === "FromStart"
                            ? {
                                  type: "FromStart",
                                  afterCursor: paginate.afterCursor ?? null,
                                  hasNextPage: hasMoreItems,
                              }
                            : {
                                  type: "FromEnd",
                                  beforeCursor: paginate.beforeCursor ?? null,
                                  hasPreviousPage: hasMoreItems,
                              },
                    items: finalItems,
                };
            },

            backfillRealtimeQuery: (context, {partitionKey, readTime}) => {
                const partitionKeyString = Index.serializeOpaquePartitionKey(partitionKey);

                return this._backfillRealtimeQuery(context, {
                    // If our index's partition key is the same as our table's partition key then
                    // we can save some WCUs by writing all updates under the table's partition key
                    // (which is used for `table.realtimeQuery()`).
                    realtimeKey: canReuseTablePartitionKeyForRealtimeKey
                        ? this._table.serializeOpaqueItemPartitionKey({
                              partitionType: exclusivePartitionType,
                              ...partitionKey,
                          })
                        : `${config.name}:${partitionKeyString}`,
                    readTime,
                    source: {
                        type: "Index",
                        name: config.name,
                        partitionKey: partitionKeyString,
                    },
                });
            },

            getPartitionKeyAttributeFromEvent: (attributeName, event) => {
                const oldPartitionKey = event.oldPartitionKeyByIndexName?.get(config.name);
                const newPartitionKey = event.newPartitionKeyByIndexName?.get(config.name);

                let oldValue: unknown;
                let newValue: unknown;

                if (oldPartitionKey !== undefined) {
                    oldValue = Index.deserializeOpaquePartitionKey(oldPartitionKey)[attributeName];
                }

                if (oldPartitionKey === newPartitionKey) {
                    newValue = oldValue;
                } else if (newPartitionKey !== undefined) {
                    newValue = Index.deserializeOpaquePartitionKey(newPartitionKey)[attributeName];
                }

                return {oldValue: oldValue as any, newValue: newValue as any};
            },
        };
    }

    private async _backfillRealtimeQuery(
        context: ServerContentActionContext,
        {
            realtimeKey,
            readTime,
            source,
        }: {
            realtimeKey: string;
            readTime: Date;
            source:
                | {
                      type: "Table";
                      partitionKey: DynamoItemPartitionKey;
                  }
                | {
                      type: "Index";
                      name: string;
                      partitionKey: DynamoIndexPartitionKey;
                  };
        },
    ): Promise<DynamoGeneralRealtimeBackfillResult<any>> {
        // `readTime` may be for an eventually consistent read. Eventually consistent
        // reads may contain stale data. So here we backfill events that happened a
        // short window before our `readTime` in case the read returned stale data.
        //
        // [DynamoDB says][1] reads are usually consistent "within one second or less".
        // So three minutes should be a sufficient window for backfilling realtime
        // events before the read time.
        //
        // [1]: https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
        readTime = subMinutes(
            readTime,
            dynamoGeneralRealtimeStaleEventualReadConsistencyWindowMinutes,
        );

        // We have deleted events before this time to reduce our storage needs. That
        // means we can't backfill reads that ocurred before this time.
        const expiredEventsTime = subDays(
            new Date(),
            dynamoGeneralRealtimePrivatePartitionEventExpirationDays,
        );

        // If our read happened before the expiration time, we may be missing some
        // events that happened between the read and now. The client should fully
        // reload their query in response.
        if (isDatePossiblyLessThanWithUncertaintyWindow(readTime, expiredEventsTime))
            return {type: "Unavailable"};

        // We backfill realtime updates to `newReadTime` so it should be before the
        // data is read from the database to avoid missing realtime updates.
        const newReadTime = new Date();

        // We send only one event per item key in our backfill. The client does not
        // need to see the update history for an item. Only the latest value...
        const backfillItemByKey = new Map<
            DynamoItemKey,
            {
                itemKey: Types["ItemKey"];
                index: DynamoGeneralRealtimeInternalIndex | undefined;
                version: number;
                isDeleted: boolean;
            }
        >();

        for await (const unknownItem of this._table.query<any, any, any>(context, {
            partitionKey: {
                partitionType: "Realtime",
                realtimeKey,
            },
            startSortKey: {
                sortRangeType: "Events",
                eventTime: readTime,
            },
            limit: "All",
            // Use a strong read consistency when backfilling events!
            consistency: "Strong",
        })) {
            const item: DynamoGeneralRealtimePrivateRealtimePartitionItem = unknownItem as any;

            for (const event of item.eventTransaction) {
                const itemKey = this._table.deserializeOpaqueItemKey(event.key);

                const index =
                    source.type === "Index"
                        ? this._indexByNameByItemType
                              .get(`${itemKey.partitionType}#${itemKey.sortRangeType}`)
                              ?.get(source.name)
                        : undefined;

                // Ignore items that are not a part of our index. This could happen for one of
                // the following reasons:
                //
                // - Our index's realtime key is the same as the table's primary partition key
                // - An update to an item not in the index happened in the same transaction as
                //   an item in the index
                if (source.type === "Index" && !index) {
                    continue;
                }

                const backfillItem = getOrSetDefaultMapValue(backfillItemByKey, event.key, () => ({
                    itemKey,
                    index,
                    version: event.version,
                    isDeleted: event.type === "DeleteItem",
                }));

                // Expect the highest version number when backfilling.
                if (event.version > backfillItem.version) {
                    backfillItem.version = event.version;
                    backfillItem.isDeleted = event.type === "DeleteItem";
                }
            }
        }

        // Collapse all updates into a single transaction. That way events that were
        // together in a transaction will still be applied atomically and the client
        // doesn't care about non-atomic events being treated as atomic.
        const eventTransaction = await runAllPromises(
            Array.from(
                backfillItemByKey,
                async ([key, backfillItem]): Promise<DynamoGeneralRealtimeEvent<unknown>> => {
                    const {itemKey} = backfillItem;

                    let hasAlreadyAttempted = false;

                    const result = await retryWithExponentialBackoff(async retry => {
                        const isInitialAttempt = !hasAlreadyAttempted;
                        hasAlreadyAttempted = true;

                        // On the first attempt, try reading with eventual consistency since it's
                        // cheaper. If we observe eventual consistency lag (item version is behind
                        // event version from strong consistency query) then we'll retry with strong
                        // consistency.
                        const options: {consistency: DynamoReadConsistency} = isInitialAttempt
                            ? {consistency: "Eventual"}
                            : {consistency: "Strong"};

                        // If the event we saw deletes the item then try looking for a gravestone
                        // first, then the full item.
                        const result = backfillItem.isDeleted
                            ? await this.getDeletedItemIfExists(context, itemKey, options).then(
                                  async item1 => {
                                      if (item1) return {isDeleted: true as const, item: item1};

                                      const item2 = await this.getItemIfExists(
                                          context,
                                          itemKey,
                                          options,
                                      );
                                      if (item2) return {isDeleted: false as const, item: item2};

                                      return null;
                                  },
                              )
                            : await this.getItemIfExists(context, itemKey, options).then(
                                  async item1 => {
                                      if (item1) return {isDeleted: false as const, item: item1};

                                      const item2 = await this.getDeletedItemIfExists(
                                          context,
                                          itemKey,
                                          options,
                                      );
                                      if (item2) return {isDeleted: true as const, item: item2};

                                      return null;
                                  },
                              );

                        // Either an item or an item gravestone must exist. Once an item has been
                        // created we'll always keep around at least a gravestone.
                        if (result === null) throw retry();

                        // If our item's version is less than the version expected by our realtime
                        // event we're likely seeing an eventual consistency lag. Try reading again.
                        // The next read will use strong consistency.
                        if ((result.item.updateLockVersion ?? 0) < backfillItem.version)
                            throw retry();

                        return result;
                    });

                    if (result.isDeleted) {
                        return {
                            type: "DeleteItem",
                            item: {
                                key: key,
                                version: result.item.updateLockVersion ?? 0,
                            },
                            indexes: this._getDeleteItemEventIndexes(itemKey),
                        };
                    }
                    // If this item is in a different partition then the one we're backfilling
                    // then send a `DeleteItem` event instead of a `PutItem` event so we don't
                    // reveal data the user doesn't have access to.
                    else if (
                        source.type === "Index"
                            ? backfillItem.index!.serializeOpaquePartitionKey(result.item) !==
                              source.partitionKey
                            : this._table.serializeOpaqueItemPartitionKey(result.item) !==
                              source.partitionKey
                    ) {
                        return {
                            type: "DeleteItem",
                            item: {
                                key: key,
                                version: result.item.updateLockVersion ?? 0,
                            },
                            indexes: this._getDeleteItemEventIndexes(itemKey),
                        };
                    } else {
                        const indexByName = this._indexByNameByItemType.get(
                            `${result.item.partitionType}#${result.item.sortRangeType}`,
                        );

                        let partitionKeyByIndexName:
                            | Map<string, DynamoIndexPartitionKey>
                            | undefined;

                        if (indexByName) {
                            for (const [indexName, index] of indexByName) {
                                partitionKeyByIndexName ??= new Map();
                                partitionKeyByIndexName.set(
                                    indexName,
                                    index.serializeOpaquePartitionKey(result.item),
                                );
                            }
                        }

                        return {
                            type: "PutItem",
                            item: {
                                key,
                                version: result.item.updateLockVersion ?? 0,
                                model: await this._buildModel(context, result.item),
                            },
                            indexes: this._getPutItemEventIndexes({
                                item: result.item,
                                indexByName,
                                partitionKeyByIndexName,
                            }),
                        };
                    }
                },
            ),
        );

        return {type: "Available", readTime: newReadTime, eventTransaction};
    }
}

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface DynamoGeneralRealtimeTableSchemaIndex<Model, IndexPartitionKey, IndexSortKey> {
    readonly name: string;

    readonly partitionKeyAttributes: {
        readonly [Key in keyof IndexPartitionKey]: DynamoKeyAttributeSchema<IndexPartitionKey[Key]>;
    };

    readonly sortKeyAttributes: {
        readonly [Key in keyof IndexSortKey]: DynamoKeyAttributeSchema<IndexSortKey[Key]>;
    };

    getRealtimeQueryPartitionKey(partitionKey: IndexPartitionKey): DynamoIndexPartitionKey;

    /**
     * Query the index.
     */
    realtimeQuery(
        context: ServerContentActionContext,
        options: {
            partitionKey: IndexPartitionKey;
            startSortKey?: IndexSortKey;
            endSortKey?: IndexSortKey;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            paginate?:
                | {
                      type: "FromStart";
                      afterCursor?: DynamoIndexCursor | null;
                  }
                | {
                      type: "FromEnd";
                      beforeCursor?: DynamoIndexCursor | null;
                  };
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
        },
    ): Promise<DynamoGeneralRealtimeIndexQueryResult<Model>>;

    /**
     * Backfill any updates that happened since the query was read and now. Useful
     * when you connect to realtime after dispatching your query.
     */
    backfillRealtimeQuery(
        context: ServerContentActionContext,
        options: {partitionKey: IndexPartitionKey; readTime: Date},
    ): Promise<DynamoGeneralRealtimeBackfillResult<Model>>;

    /**
     * Get the value of an attribute in our index's partition key from an event
     * that contains a diff of the old and new partition keys for an item.
     *
     * This function is used in `broadcastEventTransaction()` to observe changes to
     * an indexed attribute. `broadcastEventTransaction()` only currently observes
     * changes to indexed attributes.
     */
    getPartitionKeyAttributeFromEvent<AttributeName extends keyof IndexPartitionKey>(
        attributeName: AttributeName,
        event: {
            oldPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
            newPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
        },
    ): {
        oldValue: IndexPartitionKey[AttributeName] | undefined;
        newValue: IndexPartitionKey[AttributeName] | undefined;
    };
}

// Do not export this symbol! It lets us have methods that are private within
// this file. Notably we want to construct
// `DynamoGeneralRealtimeTransactionEntry` within this file but have the class
// be opaque to the outside world.
const privateSymbol = Symbol("private");

/**
 * Wrapper around a `DynamoTransactionEntry` that includes extra information we
 * need for updating a realtime table.
 */
export class DynamoGeneralRealtimeTransactionEntry {
    private readonly _entry: DynamoTransactionEntry | NonEmptyReadonlyArray<DynamoTransactionEntry>;
    private readonly _schema: DynamoGeneralRealtimeTableSchema<any, any>;
    private readonly _event: DynamoGeneralRealtimeInternalEvent<unknown, unknown>;

    private constructor(
        entry: DynamoTransactionEntry | NonEmptyReadonlyArray<DynamoTransactionEntry>,
        schema: DynamoGeneralRealtimeTableSchema<any, any>,
        event: DynamoGeneralRealtimeInternalEvent<unknown, unknown>,
    ) {
        this._entry = entry;
        this._schema = schema;
        this._event = event;
    }

    public static _new(
        symbol: typeof privateSymbol,
        entry: DynamoTransactionEntry | NonEmptyReadonlyArray<DynamoTransactionEntry>,
        schema: DynamoGeneralRealtimeTableSchema<any, any>,
        event: DynamoGeneralRealtimeInternalEvent<unknown, unknown>,
    ): DynamoGeneralRealtimeTransactionEntry {
        // `privateSymbol` is only accessible in this module so this assert makes sure
        // we don't call this method from outside of this module.
        assert(symbol === privateSymbol);

        return new DynamoGeneralRealtimeTransactionEntry(entry, schema, event);
    }

    public _get(symbol: typeof privateSymbol) {
        // `privateSymbol` is only accessible in this module so this assert makes sure
        // we don't call this method from outside of this module.
        assert(symbol === privateSymbol);

        return {
            entry: this._entry,
            schema: this._schema,
            event: this._event,
        };
    }
}
