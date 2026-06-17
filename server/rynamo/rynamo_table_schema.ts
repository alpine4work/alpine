import {addDays, subDays, subMinutes} from "date-fns";
import {RynamoTransactionEntry} from "~/server/context/rynamo_transaction_entry.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoCondition, DynamoConditionExpression} from "~/server/dynamo/core/dynamo_condition.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    DynamoItem,
    DynamoTableSchema,
    DynamoTableSchemaIndex,
    DynamoTableSchemaIndexConfigOptions,
    DynamoTableSchemaIndexKeyAttributesConfigBase,
    DynamoTableSchemaIndexKeyAttributesType,
    DynamoTableSchemaTypesBase,
} from "~/server/dynamo/core/dynamo_table_schema.js";
import {DynamoTransactionEntry} from "~/server/dynamo/core/dynamo_transaction_entry.js";
import {DynamoTableSchemaTypes} from "~/server/dynamo/core/types/dynamo_table_schema_types.js";
import {getActorContextModuleKey} from "~/server/helpers/actor_context_module.js";
import {
    DynamoIndexCursor,
    DynamoIndexPartitionKey,
    DynamoItemKey,
    DynamoItemKeySchema,
    DynamoItemPartitionKey,
    DynamoItemSortKey,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {
    RynamoBackfillResult,
    RynamoDeleteItemEvent,
    RynamoEvent,
    RynamoEventStub,
    RynamoIndexQueryResult,
    RynamoItem,
    RynamoPutItemEvent,
    RynamoQueryResult,
} from "~/shared/dynamo/rynamo_types.js";
import {
    InternalError,
    InvalidArgumentError,
    NotFoundError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {assertNonEmptyReadonlyArray} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map_async_iterable_iterator.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {pickObject} from "~/shared/helpers/object/pick_object.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {
    MaybeNonEmptyReadonlyArray,
    MaybeReadonlyArray,
} from "~/shared/helpers/types/maybe_array.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries.js";
import {Schema, SchemaWithoutValidation} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpoint,
    generateServerSynchronizationCheckpoint,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

export type RynamoTableSchemaGetTypes<Schema extends RynamoTableSchema<any, any>> =
    Schema extends RynamoTableSchema<infer Types, any> ? Types : never;

export type RynamoTableItemKeyType<
    Schema extends RynamoTableSchema<any, any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    RynamoTableSchemaGetTypes<Schema>["ItemKey"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

export type RynamoTableItemType<
    Schema extends RynamoTableSchema<any, any>,
    PartitionType extends string,
    SortRangeType extends string,
> = MergeObjectIntersection<
    RynamoTableSchemaGetTypes<Schema>["Item"] & {
        readonly partitionType: PartitionType;
        readonly sortRangeType: SortRangeType;
    }
>;

export type RynamoTableDeletedItem = {
    readonly updateLockVersion: number | undefined;
};

type RynamoTableSchemaPartitionShallowFeatureConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof PartitionsConfig]: [PartitionsConfig[Index]["name"], boolean];
    }>
>;

type RynamoTableSchemaPartitionFeatureConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof PartitionsConfig]: [
            PartitionsConfig[Index]["name"],
            RynamoTableSchemaSortRangeFeatureConfigType<PartitionsConfig[Index]["sortRanges"]>,
        ];
    }>
>;

type RynamoTableSchemaSortRangeFeatureConfigType<
    SortRangesConfig extends ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
> = Partial<
    ObjectFromEntries<{
        [Index in keyof SortRangesConfig]: [SortRangesConfig[Index]["name"], boolean];
    }>
>;

type RynamoTableSchemaPartitionModelConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof PartitionsConfig]: [
        PartitionsConfig[Index]["name"],
        RynamoTableSchemaSortRangeModelConfigType<
            PartitionsConfig[Index],
            PartitionsConfig[Index]["sortRanges"]
        >,
    ];
}>;

type RynamoTableSchemaSortRangeModelConfigType<
    PartitionConfig extends DynamoTableSchemaTypes.Partition.ConfigBase,
    SortRangesConfig extends ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof SortRangesConfig]: [
        SortRangesConfig[Index]["name"],
        {
            build: (
                context: ServerActionContext,
                item: DynamoTableSchemaTypes.ItemType<PartitionConfig, SortRangesConfig[Index]>,
            ) => Promise<unknown>;
        },
    ];
}>;

type RynamoTableSchemaModelMapType<
    ModelsConfig extends {
        [partitionType: string]: {[sortRangeType: string]: {build: () => Promise<any>}};
    },
> = {
    [Key1 in keyof ModelsConfig]: {
        [Key2 in keyof ModelsConfig[Key1]]: Awaited<ReturnType<ModelsConfig[Key1][Key2]["build"]>>;
    };
};

type RynamoTableSchemaModelType<
    ModelsConfig extends {
        [partitionType: string]: {[sortRangeType: string]: {build: () => Promise<any>}};
    },
> = {
    [Key1 in keyof ModelsConfig]: {
        [Key2 in keyof ModelsConfig[Key1]]: Awaited<ReturnType<ModelsConfig[Key1][Key2]["build"]>>;
    }[keyof ModelsConfig[Key1]];
}[keyof ModelsConfig];

type RynamoPrivateRealtimePartitionItem = DynamoTableSchemaTypes.Partition.ItemTypes<
    [typeof rynamoPrivatePartitionConfig]
>;

type RynamoPrivateRealtimePartitionEvent = RynamoPrivateRealtimePartitionItem["events"][number];

const rynamoPrivatePartitionName = "Realtime";

const rynamoPrivatePartitionConfig = {
    name: rynamoPrivatePartitionName,
    partitionKeyAttributes: {
        realtimeKey: DynamoKeyAttributeSchema.labelString({maxLength: null}),
    },
    sortRanges: [
        {
            name: "Events",
            sortKeyAttributes: {
                eventTime: DynamoKeyAttributeSchema.date,
            },
            withExpirationTime: "Required",
            attributes: Schema.object({
                events: Schema.array(
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

type RynamoPrivateGraveyardPartitionItem = DynamoTableSchemaTypes.Partition.ItemTypes<
    [typeof rynamoPrivateGraveyardPartitionConfig]
>;

type RynamoPrivateGraveyardPartitionItemKey = DynamoTableSchemaTypes.Partition.ItemKeyTypes<
    [typeof rynamoPrivateGraveyardPartitionConfig]
>;

const rynamoPrivateGraveyardPartitionName = "Graveyard";

const rynamoPrivateGraveyardPartitionConfig = {
    name: rynamoPrivateGraveyardPartitionName,
    partitionKeyAttributes: {
        deletedPartitionKey: DynamoKeyAttributeSchema.labelString<DynamoItemPartitionKey>({
            maxLength: null,
        }),
    },
    sortRanges: [
        {
            name: "Gravestone",
            sortKeyAttributes: {
                deletedSortKey: DynamoKeyAttributeSchema.labelString<DynamoItemSortKey>({
                    maxLength: null,
                }),
            },
            attributes: Schema.object({
                // IMPORTANT: We record the version of the gravestone in `updateLockVersion`. If
                // you're going to undelete this item it must be with a version that's greater than
                // the gravestone version.
            }),
        },
    ],
} as const satisfies DynamoTableSchemaTypes.Partition.ConfigBase;

/**
 * How many days does it take for events stored in our private realtime partition
 * to expire?
 *
 * We set to a week. That way if a client goes offline for the weekend then comes
 * back online we will be able to backfill.
 */
const rynamoPrivatePartitionEventExpirationDays = 7;

/**
 * The maximum number of minutes we expect DynamoDB to return stale data from an
 * eventually consistent read.
 *
 * [DynamoDB says][1] reads are usually consistent "within one second or less". So
 * three minutes should be more than a sufficient window.
 *
 * [1]:
 *     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
 */
export const rynamoBackfillSafetyWindowMinutes = 3;

type RynamoInternalIndex = {
    readonly isStrongConsistency: boolean;
    readonly canReuseTablePartitionKeyForRealtimeKey: boolean;
    readonly dynamicPartitionKeyAttributeNames: ReadonlyArray<string>;
    readonly keyAttributeNames: ReadonlyArray<string>;
    readonly serializeOpaquePartitionKey: (partitionKey: unknown) => DynamoIndexPartitionKey;
    readonly serializeOpaqueCursor: (itemKey: unknown) => DynamoIndexCursor;
};

type RynamoAction<ItemKey, Model> =
    | RynamoPutItemAction<ItemKey, Model>
    | RynamoDeleteItemAction<ItemKey>;

type RynamoPutItemAction<ItemKey, Model> = {
    readonly type: "PutItem";
    readonly itemKey: ItemKey;
    readonly getPartitionKey: () => DynamoItemPartitionKey;
    readonly getSortKey: () => DynamoItemSortKey;
    readonly indexByName: ReadonlyMap<string, RynamoInternalIndex> | undefined;
    readonly oldPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    readonly newPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    readonly eventStub: RynamoEventStub;
    readonly getEvent: (context: ServerActionContext) => Promise<RynamoPutItemEvent<Model>>;
};

type RynamoDeleteItemAction<ItemKey> = {
    readonly type: "DeleteItem";
    readonly itemKey: ItemKey;
    readonly getPartitionKey: () => DynamoItemPartitionKey;
    readonly getSortKey: () => DynamoItemSortKey;
    readonly indexByName: ReadonlyMap<string, RynamoInternalIndex> | undefined;
    readonly oldPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    readonly newPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
    readonly eventStub: RynamoEventStub;
    readonly event: RynamoDeleteItemEvent;
};

/**
 * Abstraction on top of `DynamoTableSchema` for creating DynamoDB tables where
 * clients can not only load data but also subscribe to all future changes to that
 * data.
 *
 * This abstraction is great if you have some simple data that needs realtime
 * updates but you may need a custom realtime implementation for more advanced
 * collaborative use cases. This is where the name comes from. The abstraction is
 * "general" purpose but by trying to serve a general use case it may not be good
 * for specific applications.
 *
 * This DynamoDB realtime implementation is:
 *
 * - General purpose. This realtime implementation works with any arbitrary data
 *   you put into DynamoDB. While sometimes you may have pretty custom realtime
 *   needs and choose to use a regular table with your own realtime implementation
 *   (like for documents and messaging), this abstraction can support many simple
 *   cases where you have a list of data you need updated in realtime.
 *
 * - Preserves the speed of DynamoDB. You still design your tables in such a way
 *   that related data is collated so it can be read at once. Realtime adds no
 *   overhead to reads. (But some overhead to writes.)
 *
 * - Eventually correct. Every single update to data you've queried can be
 *   observed. While updates may arrive out of order they include a version number
 *   so clients can serialize updates on a given item.
 *
 * - Works with stale reads. You can read data on the server then a second later
 *   connect to a WebSocket on the client and any updates during that time will be
 *   backfilled. Similarly, we support have realtime updates for DynamoDB global
 *   secondary indexes that only have eventually consistent reads.
 *
 * This implementation does have some limitations you need to keep in mind before
 * using:
 *
 * - Does not support all DynamoDB actions. For example, there is no
 *   `replaceItem()`. All item updates must have a version number so if clients
 *   receive out-of-order events they can use the version number to serialize them.
 *
 * - Shares the primary key and index key of an item with the client. While this
 *   data is base64 encoded, that's not secure! Any attacker can trivially get this
 *   data from the opaque string keys we send to the client to maintain data in
 *   realtime. This data must not be sensitive.
 *
 * - You are still responsible for broadcasting update events to clients and
 *   authorizing that clients have access to an update event stream. Similarly,
 *   clients need to know the right channel to subscribe to in order to receive
 *   realtime events for the data it's displaying.
 *
 * - Clients may skip update events. Because events may arrive out-of-order if you
 *   have an item at version N and an update to N+1 and N+2 but the event for N+2
 *   arrives on the client first them the client will update their item to N+2 and
 *   ignore the N+1 event when it arrives. Make sure it's not essential that a
 *   client sees every update.
 *
 * - Item-centric. The smallest granularity of realtime update is the item. There
 *   are no realtime updates for item attributes and we send the entire item on
 *   updates instead of a diff. There are no consistency guarantees for updates
 *   across items (unless you use a transaction). Forces you to think of items as
 *   individual entities all the way down to the client (which makes some table
 *   designs harder, for example a document table design is harder where there are
 *   many step items that comprise a document entity).
 */
// TODO(calebmer, 2022-04-28): Features from `DynamoTableSchema` I'm leaving
// unimplemented for now since I don't have a test case. There are TODO comments
// throughout this class but here's a list in one place:
//
// - `addExpensiveFullIndex()` with items in different partitions
// - Certain `DynamoKeyAttributeSchema`s which don't support binary encoding
export class RynamoTableSchema<
    Types extends DynamoTableSchemaTypesBase,
    ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
> {
    readonly #table: DynamoTableSchema<Types>;
    readonly #features:
        | {
              readonly realtimeQuery?: {readonly [partitionType: string]: boolean | undefined};
              readonly deleteItem?: {
                  readonly [partitionType: string]:
                      | {readonly [sortRangeType: string]: boolean | undefined}
                      | undefined;
              };
          }
        | undefined;
    readonly #models: RynamoTableSchemaPartitionModelConfigType<
        DynamoTableSchemaTypes.ConfigBase["partitions"]
    >;
    readonly #broadcastEventsCallback: (
        context: ServerActionContext,
        events: ReadonlyArray<{
            itemKey: Types["ItemKey"];
            eventStub: RynamoEventStub;
            getEvent: (
                context: ServerActionContext,
            ) => Promise<RynamoEvent<ModelMap[string][string]>>;
            oldPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
            newPartitionKeyByIndexName: ReadonlyMap<string, DynamoIndexPartitionKey> | undefined;
        }>,
    ) => Promise<void>;

    readonly #indexByNameByItemType = new Map<string, Map<string, RynamoInternalIndex>>();

    static new<
        const PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
        const ModelsConfig extends RynamoTableSchemaPartitionModelConfigType<PartitionsConfig>,
    >({
        name,
        partitions,
        withoutCompatibilityErrorsForTest,
        features,
        models,
        modelSchema,
        broadcastEvents,
    }: {
        name: string;
        partitions: PartitionsConfig;
        withoutCompatibilityErrorsForTest?: boolean;

        /**
         * Enable features by partition. By default we disable these features since they
         * incur some overhead so should only be enabled if you know they're needed and
         * you're comfortable with the overhead.
         */
        features?: {
            /**
             * Enable `realtimeQuery()` for a partition. If you don't enable `realtimeQuery()`
             * for the partition you can still create an index on the table which may have a
             * `realtimeQuery()` method.
             *
             * Enabling `realtimeQuery()` means we need to write an additional event
             * transaction item to the database every update so the realtime query can be
             * backfilled. In other words, enabling `realtimeQuery()` incurs an additional 1
             * WCU minimum on every update.
             */
            realtimeQuery?: RynamoTableSchemaPartitionShallowFeatureConfigType<PartitionsConfig>;

            /**
             * Enable `deleteItem()` for a partition. By default items aren't deletable. When
             * you delete an item we need to keep a gravestone in the database so if the item
             * is ever undeleted the undeleted item can have a version greater than the last
             * item's version so clients will accept the undeleted item as the latest.
             *
             * Enabling `deleteItem()` means we need to check in `createItem()` (and
             * `transactionCreateItem()`) that a gravestone doesn't exist. This turns
             * `createItem()` from a 1 WCU and 1 RCU minimum request into a transaction that
             * consumes 2 WCU and 4 RCU minimum (2 RCU for the gravestone condition check).
             *
             * You could still use a method like
             * `transactionDangerouslyCreateItemWithoutExistenceConditionCheck()` which skips
             * the existence condition check to avoid extra RCUs that check for a gravestone.
             */
            deleteItem?: RynamoTableSchemaPartitionFeatureConfigType<PartitionsConfig>;
        };

        /**
         * Every partition in a realtime DynamoDB table needs a model. A model is the
         * object we share with the client. It removes any internal server information and
         * may load related data from different tables.
         *
         * We create a model whenever you update data and broadcast the model to any
         * realtime subscribers.
         */
        models: ModelsConfig;

        /**
         * A schema that can serialize/deserialize every model object.
         */
        // NOTE(calebmer, 2023-04-24): For whatever reason, TypeScript doesn't seem to like
        // the full `Schema` type here but works just fine with an interface that has a
        // limited set of methods. I think it has something to do with variance. Shrug.
        modelSchema: SchemaWithoutValidation<RynamoTableSchemaModelType<ModelsConfig>>;

        /**
         * Whenever data within the realtime DynamoDB table is updated we call this
         * broadcast function. It is your responsibility to make realtime events make it to
         * connected clients. This abstraction does not do realtime event delivery for you.
         *
         * It's important that you make sure only authorized clients can subscribe to
         * realtime event streams! Otherwise they may get access to data they're not
         * allowed to see.
         */
        broadcastEvents: (
            context: ServerActionContext,
            events: ReadonlyArray<{
                itemKey: DynamoTableSchemaTypes.Partition.ItemKeyTypes<PartitionsConfig>;
                eventStub: RynamoEventStub;
                getEvent: (
                    context: ServerActionContext,
                ) => Promise<RynamoEvent<RynamoTableSchemaModelType<ModelsConfig>>>;
                oldPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
                newPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
            }>,
        ) => Promise<void>;
    }): RynamoTableSchema<
        DynamoTableSchemaTypes.Types<{name: string; partitions: PartitionsConfig}>,
        RynamoTableSchemaModelMapType<ModelsConfig>
    > {
        assert(modelSchema instanceof Schema);

        for (const partition of partitions) {
            for (const sortRange of partition.sortRanges) {
                // NOTE(calebmer): There's no reason we couldn't support a child sort range here.
                // We just haven't needed it yet. It's unclear what we'd need to fully implement
                // child sort ranges for general realtime tables. Opaque item key
                // serialization/deserialization probably needs to be updated.
                if (sortRange.childSortRanges) {
                    throw new UnimplementedError(
                        "Child sort range support isn\u2019t implemented for `RynamoTableSchema`",
                    );
                }
            }
        }

        return new RynamoTableSchema({
            table: DynamoTableSchema.new({
                name,
                // Add a private partition for storing realtime information but don't include it in
                // the types. Users of this abstraction should not be able to access the realtime
                // partition so we don't include it in the types.
                partitions: [
                    ...partitions,
                    rynamoPrivatePartitionConfig,
                    rynamoPrivateGraveyardPartitionConfig,
                ] as any as PartitionsConfig,
                withoutCompatibilityErrorsForTest,
            }),
            features,
            models,
            broadcastEvents,
        });
    }

    private constructor({
        table,
        features,
        models,
        broadcastEvents,
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
        models: RynamoTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >;
        broadcastEvents: (
            context: ServerActionContext,
            events: ReadonlyArray<{
                itemKey: Types["ItemKey"];
                eventStub: RynamoEventStub;
                getEvent: (
                    context: ServerActionContext,
                ) => Promise<RynamoEvent<ModelMap[string][string]>>;
                oldPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
                newPartitionKeyByIndexName:
                    | ReadonlyMap<string, DynamoIndexPartitionKey>
                    | undefined;
            }>,
        ) => Promise<void>;
    }) {
        this.#table = table;
        this.#features = features;
        this.#models = models;
        this.#broadcastEventsCallback = broadcastEvents;
    }

    getName() {
        return this.#table.getName();
    }

    isInitialized() {
        return this.#table.isInitialized();
    }

    /**
     * Serialize the item key into an opaque string that can be conveniently shared
     * with clients.
     *
     * Remember this data is not secured in any way! If you share this with a client
     * then the client should be able to see all data in the item's primary key.
     */
    serializeOpaqueItemKey(key: Types["ItemKey"] | Types["Item"]): DynamoItemKey {
        return this.#table.serializeOpaqueItemKey(key);
    }

    /**
     * Deserialize the opaque item key string into an object so we can see the data
     * inside.
     */
    deserializeOpaqueItemKey(key: DynamoItemKey): Types["ItemKey"] {
        return this.#table.deserializeOpaqueItemKey(key);
    }

    #buildModel<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
    ): Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]> {
        return this.#models[item.partitionType]![item.sortRangeType]!.build(
            context,
            item,
        ) as Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>;
    }

    /**
     * Broadcast an action transaction to any realtime clients listening for updates.
     * Also writes the event transaction to the database which will allow us to
     * backfill queries if a realtime client has been disconnected from realtime
     * updates for a bit.
     *
     * This method is called in `context.process.waitUntil()` after a successful write.
     * This means it's not guaranteed to run in scenarios where the service crashes
     * (e.g. because of an out-of-memory exception or other infrastructure failure).
     * Since we may finish the write then after the service crashes before we can
     * broadcast the realtime event. We're ok with this for now. The impact is clients
     * won't get realtime updates. But if the client reloads their browser they're
     * going to pick up the new data.
     */
    #broadcastActionTransaction(
        context: ServerActionContext,
        actionTransaction: ReadonlyArray<RynamoAction<Types["ItemKey"], ModelMap[string][string]>>,
    ): Promise<void> {
        return context.tracer.withSpan("Send general realtime event transaction", async context => {
            const events = actionTransaction.map(
                (
                    action,
                ): {
                    itemKey: Types["ItemKey"];
                    eventStub: RynamoEventStub;
                    getEvent: (
                        context: ServerActionContext,
                    ) => Promise<RynamoEvent<ModelMap[string][string]>>;
                    oldPartitionKeyByIndexName:
                        | ReadonlyMap<string, DynamoIndexPartitionKey>
                        | undefined;
                    newPartitionKeyByIndexName:
                        | ReadonlyMap<string, DynamoIndexPartitionKey>
                        | undefined;
                } => {
                    switch (action.type) {
                        case "PutItem": {
                            return {
                                itemKey: action.itemKey,
                                eventStub: action.eventStub,
                                getEvent: action.getEvent,
                                oldPartitionKeyByIndexName: action.oldPartitionKeyByIndexName,
                                newPartitionKeyByIndexName: action.newPartitionKeyByIndexName,
                            };
                        }
                        case "DeleteItem": {
                            return {
                                itemKey: action.itemKey,
                                eventStub: action.eventStub,
                                getEvent: async () => action.event,
                                oldPartitionKeyByIndexName: action.oldPartitionKeyByIndexName,
                                newPartitionKeyByIndexName: action.newPartitionKeyByIndexName,
                            };
                        }
                        default:
                            throw exhaustive(action);
                    }
                },
            );

            const realtimeKeys = new Set<string>();

            const dynamoEvents = actionTransaction.map(
                (action): RynamoPrivateRealtimePartitionEvent => {
                    // Add the realtime event transaction to every partition affected by the
                    // transaction. That way we can search to find the transaction later using any
                    // partition key implicated in the transaction.
                    //
                    // We use an opaque partition key to avoid conflicting characters in this realtime
                    // item's partition key.
                    //
                    // If `realtimeQuery()` is disabled then we won't need to backfill a realtime query
                    // so we don't need to save event transactions under our table's partition key.
                    if (this.#features?.realtimeQuery?.[action.itemKey.partitionType]) {
                        realtimeKeys.add(action.getPartitionKey());
                    }

                    for (const [indexName, partitionKey] of concatIterables(
                        action.oldPartitionKeyByIndexName ?? emptyArray,
                        action.newPartitionKeyByIndexName ?? emptyArray,
                    )) {
                        const index = assertExists(action.indexByName?.get(indexName));

                        // If our index's partition key is the same as our table's partition key then we
                        // can save some WCUs by writing all updates under the table's partition key (which
                        // is used for `table.realtimeQuery()`).
                        if (index.canReuseTablePartitionKeyForRealtimeKey) {
                            realtimeKeys.add(action.getPartitionKey());
                        } else {
                            realtimeKeys.add(`${indexName}:${partitionKey}`);
                        }
                    }

                    return {
                        type: action.type,
                        key: action.eventStub.item.key,
                        version: action.eventStub.item.version,
                    };
                },
            );

            const eventTime = new Date();

            // Expire events after a couple days. If we are trying to backfill data from longer
            // ago then we'll need a full refresh.
            const expirationTime = addDays(eventTime, rynamoPrivatePartitionEventExpirationDays);

            // Add the event transaction to every affected realtime key. When backfilling, we
            // only query events from realtime keys we care about. If a transaction affected
            // two realtime keys then it needs to be present in both to show up in a backfill
            // query.
            await runAllPromises(
                mapIterable(realtimeKeys, realtimeKey => {
                    const item: RynamoPrivateRealtimePartitionItem = {
                        partitionType: rynamoPrivatePartitionName,
                        sortRangeType: "Events",
                        realtimeKey,
                        eventTime,
                        expirationTime,
                        events: dynamoEvents,
                    };

                    // TODO(calebmer): `createOrReplaceItem()` isn't safe here! We may override an
                    // event that happens to have the same `eventTime` which would be bad. Either we
                    // should switch this call to `createItem()` or (ideally) we should switch
                    // `eventTime` to a `ChronologicalId` to guarantee uniqueness.
                    return this.#table.createOrReplaceItem(context, item);
                }),
            );

            // Wait to send our events to clients until we've confirmed our events have been
            // written to DynamoDB.
            //
            // That way a strong consistency read of events in DynamoDB will give you all
            // events sent before the start of the read.
            await this.#broadcastEventsCallback(context, events);
        });
    }

    #createPutItemAction<Item extends Types["Item"]>({
        oldItem,
        newItem,
        newVersion,
    }: {
        oldItem: Item | null;
        newItem: Item;
        newVersion: number;
    }): {
        action: RynamoPutItemAction<
            Item & Types["ItemKey"],
            ModelMap[Item["partitionType"]][Item["sortRangeType"]]
        >;
        transactionEntries: Array<DynamoTransactionEntry>;
    } {
        const itemType = `${newItem.partitionType}#${newItem.sortRangeType}`;
        const {getPartitionKey, getSortKey, key} =
            this.#table.serializeOpaqueItemKeyAndMaybePartitionKeyOrSortKey(newItem);

        if (oldItem !== null && oldItem !== newItem) {
            assert(
                key === this.#table.serializeOpaqueItemKey(oldItem),
                "Can\u2019t update item key",
            );
            assert(
                oldItem.updateLockVersion === newItem.updateLockVersion,
                "Can\u2019t update `updateLockVersion`, `RynamoTableSchema` will update `updateLockVersion` for you",
            );
        }

        const indexByName = this.#indexByNameByItemType.get(itemType);

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;
        let newPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const indexes = new Map<
            string,
            {partitionKey: DynamoIndexPartitionKey; cursor: DynamoIndexCursor}
        >();

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                if (oldItem !== null) {
                    oldPartitionKeyByIndexName ??= new Map();
                    oldPartitionKeyByIndexName.set(
                        indexName,
                        index.serializeOpaquePartitionKey(oldItem),
                    );
                }

                const newPartitionKey = index.serializeOpaquePartitionKey(newItem);

                newPartitionKeyByIndexName ??= new Map();
                newPartitionKeyByIndexName.set(indexName, newPartitionKey);

                const newCursor = index.serializeOpaqueCursor(newItem);
                indexes.set(indexName, {partitionKey: newPartitionKey, cursor: newCursor});

                // If this is a strong consistency index then we need to create or delete index
                // items in the same transaction. The caller is expected to add
                // `transactionEntries` to their update.
                if (index.isStrongConsistency) {
                    const newItemIndexKeyAttributes = pickObject(newItem, index.keyAttributeNames);

                    if (oldItem === null) {
                        transactionEntries.push(
                            this.#table.transactionCreateOrReplaceItem({
                                ...newItemIndexKeyAttributes,
                                partitionType: indexName,
                                sortRangeType: "Index",
                                actualPartitionType: newItem.partitionType,
                                actualSortRangeType: newItem.sortRangeType,
                            }),
                        );
                    } else {
                        const oldItemIndexKeyAttributes = pickObject(
                            oldItem,
                            index.keyAttributeNames,
                        );

                        if (!isDeepEqual(oldItemIndexKeyAttributes, newItemIndexKeyAttributes)) {
                            transactionEntries.push(
                                this.#table.transactionDeleteItemIfExists({
                                    ...oldItemIndexKeyAttributes,
                                    partitionType: indexName,
                                    sortRangeType: "Index",
                                }),
                            );

                            transactionEntries.push(
                                this.#table.transactionCreateOrReplaceItem({
                                    ...newItemIndexKeyAttributes,
                                    partitionType: indexName,
                                    sortRangeType: "Index",
                                    actualPartitionType: newItem.partitionType,
                                    actualSortRangeType: newItem.sortRangeType,
                                }),
                            );
                        }
                    }
                }
            }
        }

        const modelCache = new Map<
            string,
            Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
        >();

        const getModel = (context: ServerActionContext) => {
            // If the actor changes then we need to call `buildModel()` again to make sure
            // we're not returning data the actor isn't allowed to see!
            return getOrSetDefaultMapValue(
                modelCache,
                getActorContextModuleKey(context.actor),
                () =>
                    this.#buildModel(context, {
                        ...newItem,
                        updateLockVersion: newVersion !== 0 ? newVersion : undefined,
                    }),
            );
        };

        return {
            action: {
                type: "PutItem",
                itemKey: newItem as Item & Types["ItemKey"],
                getPartitionKey,
                getSortKey,
                indexByName,
                oldPartitionKeyByIndexName,
                newPartitionKeyByIndexName,
                eventStub: {
                    type: "PutItem",
                    item: {key, version: newVersion},
                },
                getEvent: async context => ({
                    type: "PutItem",
                    item: {key, version: newVersion, model: await getModel(context)},
                    indexes,
                }),
            },
            transactionEntries,
        };
    }

    #createDeleteItemAction<Item extends Types["Item"]>(
        item: Item,
    ): {
        action: RynamoDeleteItemAction<Item & Types["ItemKey"]>;
        transactionEntries: Array<DynamoTransactionEntry>;
    } {
        if (!this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        const {getPartitionKey, getSortKey, key} =
            this.#table.serializeOpaqueItemKeyAndMaybePartitionKeyOrSortKey(item);

        const version = (item.updateLockVersion ?? 0) + 1;

        const indexByName = this.#indexByNameByItemType.get(itemType);

        let oldPartitionKeyByIndexName: Map<string, DynamoIndexPartitionKey> | undefined;

        const transactionEntries: Array<DynamoTransactionEntry> = [];

        if (indexByName) {
            for (const [indexName, index] of indexByName) {
                oldPartitionKeyByIndexName ??= new Map();
                oldPartitionKeyByIndexName.set(indexName, index.serializeOpaquePartitionKey(item));

                if (index.isStrongConsistency) {
                    transactionEntries.push(
                        this.#table.transactionDeleteItemIfExists({
                            ...pickObject(item, index.keyAttributeNames),
                            partitionType: indexName,
                            sortRangeType: "Index",
                        }),
                    );
                }
            }
        }

        const indexes = new Set<string>();

        for (const [indexName] of this.#indexByNameByItemType.get(itemType) ?? []) {
            indexes.add(indexName);
        }

        const event: RynamoDeleteItemEvent = {
            type: "DeleteItem",
            item: {key, version},
            indexes,
        };

        return {
            action: {
                type: "DeleteItem",
                itemKey: item as Item & Types["ItemKey"],
                getPartitionKey,
                getSortKey,
                indexByName,
                oldPartitionKeyByIndexName,
                newPartitionKeyByIndexName: undefined,
                eventStub: event,
                event,
            },
            transactionEntries,
        };
    }

    /**
     * Create an item in the database.
     *
     * An item with the same key must not already exist. If it does this method will
     * throw an error. We do not support replacing items in realtime table schemas
     * because we need to maintain the item's version number across updates to
     * correctly order events received out-of-order on the client.
     */
    async createItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
        options?: {isConditionCheckErrorRetriable?: boolean},
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    }> {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            item = {
                ...item,
                // Make sure if we call `transactionDirectlyUpdateItem()` we don't need to run
                // `transactionDoesNotExistConditionCheck()` again. We run
                // `transactionDoesNotExistConditionCheck()` on `transactionDirectlyUpdateItem()`
                // when `updateLockVersion` is 0.
                updateLockVersion: 1,
            };
        }

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: null,
            newItem: item,
            newVersion: item.updateLockVersion ?? 0,
        });

        if (this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            transactionEntries.push(
                this.#table.transactionDoesNotExistConditionCheck(
                    cast<RynamoPrivateGraveyardPartitionItemKey>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                    }),
                ),
            );
        }

        if (transactionEntries.length === 0) {
            await this.#table.createItem(context, item, options);
        } else {
            await DynamoTableSchema.executeTransaction(context, [
                this.#table.transactionCreateItem(item, options),
                ...transactionEntries,
            ]);
        }

        context.process.waitUntil(this.#broadcastActionTransaction(context, [action]));

        return {getEvent: action.getEvent};
    }

    /**
     * Create an item in the database but only if an item with the same key does not
     * already exist. If an item with the same key does exist then this will not do
     * anything.
     *
     * Dangerous since we don't send a realtime event if this succeeds. Useful when
     * seeding the database and we aren't in an action context.
     */
    async dangerouslyCreateItemIfNoneExistsWithoutEvent<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<{
        wasCreated: boolean;
    }> {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return await this.#table.createItemIfNoneExists(context, item);
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
     * If you're updating an attribute in one of the table's index partition keys then
     * you must provide an `oldItem`. This is because we need to know the previous
     * values of indexed attributes so we can send a realtime event that removes the
     * item from any queries it was previously in.
     *
     * If you don't want to write a retry loop yourself, consider using `updateItem()`
     * which does it for you.
     */
    async directlyUpdateItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        newItem: DynamoItem<Item>,
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    }> {
        const action = await this.#directlyUpdateItem(context, newItem);

        context.process.waitUntil(this.#broadcastActionTransaction(context, [action]));

        return {getEvent: action.getEvent};
    }

    /**
     * Same as `directlyUpdateItem()` but we don't send a realtime event to clients.
     * Only use this if your update has no visible impact on the item! So clients won't
     * care if the event is missed. Useful for database migrations.
     */
    async dangerouslyDirectlyUpdateItemWithoutEvent<Item extends Types["Item"]>(
        context: DynamoContext,
        newItem: DynamoItem<Item>,
    ): Promise<void> {
        await this.#directlyUpdateItem(context, newItem);
    }

    async #directlyUpdateItem<Item extends Types["Item"]>(
        context: DynamoContext,
        newItem: Item,
    ): Promise<
        RynamoPutItemAction<
            Item & Types["ItemKey"],
            ModelMap[Item["partitionType"]][Item["sortRangeType"]]
        >
    > {
        assert(
            newItem.partitionType !== rynamoPrivatePartitionName &&
                newItem.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (newItem.oldItem === null) {
            assert(
                (newItem.updateLockVersion ?? 0) === 0,
                "Item\u2019s `updateLockVersion` is greater than 0 but `oldItem` is null, did you use `DynamoItem.create()` to create this item instead of `DynamoItem.update()`?",
            );
        }

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: newItem.oldItem,
            newItem,
            newVersion: (newItem.updateLockVersion ?? 0) + 1,
        });

        let condition: DynamoCondition<Item> | undefined;

        // We need to test to make sure the attributes in the index partition keys of
        // `oldItem` are what's actually in the database. Since we use these attributes
        // from `oldItem` in `oldPartitionKeyByIndexName` which is used to generate diffs
        // that tell the client whether an item has left a particular query.
        if (action.indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of action.indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};

                        // This check is so we're correctly handling the case where we're creating a new
                        // item (i.e. oldItem is null).
                        if (newItem.oldItem !== null) {
                            actualCondition[attributeName] = newItem.oldItem[attributeName];
                        } else {
                            actualCondition[attributeName] =
                                DynamoConditionExpression.exists().not();
                        }
                    }
                }
            }

            condition = actualCondition as any;
        }

        // If we're creating the item then we need to make sure it doesn't have a
        // gravestone.
        if (
            this.#features?.deleteItem?.[newItem.partitionType]?.[newItem.sortRangeType] &&
            (typeof newItem.updateLockVersion !== "number" || newItem.updateLockVersion === 0)
        ) {
            transactionEntries.push(
                this.#table.transactionDoesNotExistConditionCheck(
                    cast<RynamoPrivateGraveyardPartitionItemKey>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                    }),
                ),
            );
        }

        if (transactionEntries.length === 0) {
            await this.#table.directlyUpdateItem(context, newItem, {condition});
        } else {
            await DynamoTableSchema.executeTransaction(context, [
                this.#table.transactionDirectlyUpdateItem(newItem, {condition}),
                ...transactionEntries,
            ]);
        }

        return action;
    }

    /**
     * Update an item in the database based on its previous value.
     *
     * Uses [optimistic concurrency control][1] to make sure we don't clobber other
     * updates. If a concurrent process updated the same item before we did then we
     * will discard our update and retry the provided `update` function.
     *
     * If you want to manually implement an update retry loop (perhaps to perform your
     * update in a transaction) then you may use `directlyUpdateItem()` or
     * `transactionDirectlyUpdateItem()` with `context.dynamo.retryTransaction()`.
     *
     * [1]: https://en.wikipedia.org/wiki/Optimistic_concurrency_control
     */
    async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: ItemKey,
        update: (
            item: DynamoItem<MergeObjectIntersection<Types["Item"] & ItemKey>>,
        ) => MaybePromise<DynamoItem<MergeObjectIntersection<Types["Item"] & ItemKey>>>,
        options: {initialItem: DynamoItem<Types["Item"] & ItemKey>},
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<
            RynamoPutItemEvent<ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]>
        >;
    }>;
    async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: ItemKey,
        update: (
            item: DynamoItem<MergeObjectIntersection<Types["Item"] & ItemKey>> | null,
        ) => MaybePromise<DynamoItem<MergeObjectIntersection<Types["Item"] & ItemKey>>>,
        options?: {initialItem?: DynamoItem<Types["Item"] & ItemKey>},
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<
            RynamoPutItemEvent<ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]>
        >;
    }>;
    async updateItem<ItemKey extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: ItemKey,
        // Typed as `never` since a caller should always match one of the overloads, not
        // this base definition.
        update: never,
        {initialItem}: {initialItem?: DynamoItem<Types["Item"] & ItemKey>} = {},
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<
            RynamoPutItemEvent<ModelMap[ItemKey["partitionType"]][ItemKey["sortRangeType"]]>
        >;
    }> {
        let hasAttempted = false;

        return await context.dynamo.retryTransaction(async context => {
            const isInitialAttempt = !hasAttempted;
            hasAttempted = true;

            const item =
                isInitialAttempt && initialItem
                    ? initialItem
                    : await this.getItemIfExists(context, itemKey);

            const newItem: DynamoItem<Types["Item"] & ItemKey> = await (update as any)(item);

            // We don't currently support deleting items from this method. We can easily add
            // this eventually though now that we have the `deleteItem()` method.
            assert(newItem !== null);

            // Update was short-circuited.
            if (item === newItem) {
                const {action, transactionEntries} = this.#createPutItemAction({
                    oldItem: item,
                    newItem: item,
                    newVersion: newItem.updateLockVersion ?? 0,
                });

                // This was a noop, we shouldn't have any extra transaction entries from this
                // update.
                assert(transactionEntries.length === 0);

                return {
                    getEvent: async context => {
                        const event = await action.getEvent(context);

                        // Safety check that the noop `createPutItemEvent()` call didn't change the version
                        // number.
                        assert(event.item.version === (item.updateLockVersion ?? 0));

                        return event;
                    },
                };
            }

            if (item === null) {
                return await this.createItem(context, newItem, {
                    isConditionCheckErrorRetriable: true,
                });
            } else {
                return await this.directlyUpdateItem(context, newItem);
            }
        });
    }

    /**
     * Is `deleteItem()`, `undeleteItem()`, `getDeletedItemIfExists()`, and other
     * related methods enabled for this item type?
     */
    isDeleteItemEnabled<ItemType extends Types["ItemType"]>(itemType: ItemType): boolean {
        return (
            this.#features?.deleteItem?.[itemType.partitionType]?.[itemType.sortRangeType] ?? false
        );
    }

    /**
     * Deletes an item from the database. If the item doesn't exist or the item doesn't
     * match the item's update lock version, we throw a condition check error.
     *
     * This action leaves a gravestone in the database with the `updateLockVersion` of
     * the deleted item incremented by one. If you want to undelete the item then you
     * must get this `updateLockVersion` value (`getDeletedItemIfExists()`) and pass it
     * into `undeleteItem()`. You may not `createItem()` with the same key if there's a
     * deleted item gravestone.
     *
     * This way if you delete an item then undelete it the client will know to use the
     * undeleted item over the previous item since the undeleted item has a higher
     * version number.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    async deleteItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
    ): Promise<void> {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const {action, transactionEntries} = this.#createDeleteItemAction(item);

        let condition: DynamoCondition<Item> | undefined;

        // We need to test to make sure the attributes in the index partition keys of
        // `item` are what's actually in the database. Since we use these attributes from
        // `item` in `oldPartitionKeyByIndexName` which is used to generate diffs that tell
        // the client whether an item has left a particular query.
        if (action.indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of action.indexByName.values()) {
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

        await DynamoTableSchema.executeTransaction(context, [
            this.#table.transactionDeleteItem(item, {condition}),
            this.#table.transactionCreateOrReplaceItem(
                cast<RynamoPrivateGraveyardPartitionItem>({
                    partitionType: rynamoPrivateGraveyardPartitionName,
                    sortRangeType: "Gravestone",
                    deletedPartitionKey: action.getPartitionKey(),
                    deletedSortKey: action.getSortKey(),
                    updateLockVersion: action.eventStub.item.version,
                }),
            ),
            ...transactionEntries,
        ]);

        context.process.waitUntil(this.#broadcastActionTransaction(context, [action]));
    }

    /**
     * If the item with the provided key was deleted then this returns the gravestone
     * for the item. You need this gravestone to call `undeleteItem()`.
     *
     * See `deleteItem()` for more information.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    async getDeletedItemIfExists<ItemKey extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: ItemKey,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<RynamoTableDeletedItem | null> {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (!this.#features?.deleteItem?.[itemKey.partitionType]?.[itemKey.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${itemKey.partitionType}\`, sort range type: \`${itemKey.sortRangeType}\`)`,
            );
        }

        const {partitionKey, sortKey} =
            this.#table.serializeOpaqueItemPartitionKeyAndSortKey(itemKey);

        const gravestoneItem = await this.#table.getItemIfExists(
            context,
            cast<RynamoPrivateGraveyardPartitionItemKey>({
                partitionType: rynamoPrivateGraveyardPartitionName,
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
     * re-create a previously deleted item you may not use `createItem()` since that
     * restarts the item's `updateLockVersion` at 0. Instead you must call
     * `getDeletedItemIfExists()` then `undeleteItem()` with the gravestone returned by
     * that function.
     *
     * See `deleteItem()` for more information.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    async undeleteItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        deletedItem: RynamoTableDeletedItem,
        item: Item,
    ): Promise<{
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    }> {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (!this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        item = {
            ...item,
            updateLockVersion: (deletedItem.updateLockVersion ?? 0) + 1,
        };

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: null,
            newItem: item,
            newVersion: item.updateLockVersion ?? 0,
        });

        transactionEntries.push(
            this.#table.transactionDeleteItem(
                cast<RynamoPrivateGraveyardPartitionItem>({
                    partitionType: rynamoPrivateGraveyardPartitionName,
                    sortRangeType: "Gravestone",
                    deletedPartitionKey: action.getPartitionKey(),
                    deletedSortKey: action.getSortKey(),
                    updateLockVersion: deletedItem.updateLockVersion,
                }),
            ),
        );

        transactionEntries.push(this.#table.transactionCreateOrReplaceItem(item));

        await DynamoTableSchema.executeTransaction(context, transactionEntries);

        context.process.waitUntil(this.#broadcastActionTransaction(context, [action]));

        return {getEvent: action.getEvent};
    }

    /**
     * Perform multiple actions atomically. Either all actions in the transaction
     * succeed or if one action fails then none of the actions in the transaction will
     * be applied.
     *
     * Supports realtime transaction entries from this class unlike
     * `DynamoTableSchema`. But may also include non-realtime transaction entries from
     * `DynamoTableSchema`.
     */
    static async executeTransaction(
        context: ServerActionContext,
        entries: ReadonlyArray<DynamoTransactionEntry | RynamoTransactionEntry>,
        options?: {clientRequestToken?: string},
    ): Promise<{
        getEvents: <
            Types extends DynamoTableSchemaTypesBase,
            ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
        >(
            context: ServerActionContext,
            schema: RynamoTableSchema<Types, ModelMap>,
        ) => Promise<Array<RynamoEvent<ModelMap[string][string]>>>;
    }> {
        const actionsBySchema = new Map<
            RynamoTableSchema<
                DynamoTableSchemaTypesBase,
                {[partitionType: string]: {[sortRangeType: string]: any}}
            >,
            Array<RynamoAction<any, any>>
        >();

        await DynamoTableSchema.executeTransaction(
            context,
            entries.flatMap((entry): MaybeReadonlyArray<DynamoTransactionEntry> => {
                if (!(entry instanceof RynamoTransactionEntryInternal))
                    return entry as DynamoTransactionEntry;

                // The parameter is typed as the opaque handle from `~/shared`. At runtime every
                // non-`DynamoTransactionEntry` value is constructed by
                // `RynamoTransactionEntry._new()` in this file, so it's always an instance of the
                // class. Assert to narrow back to the implementation type and unlock
                // `_get(privateSymbol)`.
                const {entry: actualEntry, schema, action} = entry;
                getOrSetDefaultMapValue(actionsBySchema, schema, () => []).push(action);
                return actualEntry;
            }),
            options,
        );

        context.process.waitUntil(async () => {
            await runAllPromises(
                mapIterable(actionsBySchema, ([schema, events]) =>
                    schema.#broadcastActionTransaction(context, events),
                ),
            );
        });

        return {
            getEvents: (context, schema) => {
                const actions = actionsBySchema.get(
                    // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
                    // fixing for now.
                    // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
                    // @ts-ignore
                    schema,
                );

                return runAllPromises(
                    (actions ?? emptyArray).map(action => {
                        switch (action.type) {
                            case "PutItem":
                                return action.getEvent(context);
                            case "DeleteItem":
                                return action.event;
                            default:
                                throw exhaustive(action);
                        }
                    }),
                );
            },
        };
    }

    /**
     * Create an item in the database as the part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `createItem()` for more information.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     */
    transactionCreateItem<Item extends Types["Item"]>(item: Item): RynamoTransactionEntry {
        return this.transactionCreateItemWithEvent(item).transactionEntry;
    }

    /**
     * Create an item in the database as the part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `createItem()` for more information.
     *
     * This function also returns methods to get the realtime item we create for this
     * transaction. This is useful if you need to use the realtime item afterwards.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     */
    transactionCreateItemWithEvent<const Item extends Types["Item"]>(
        item: Item,
    ): {
        transactionEntry: RynamoTransactionEntry;
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    } {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            item = {
                ...item,
                // Make sure if we call `transactionDirectlyUpdateItem()` we don't need to run
                // `transactionDoesNotExistConditionCheck()` again. We run
                // `transactionDoesNotExistConditionCheck()` on `transactionDirectlyUpdateItem()`
                // when `updateLockVersion` is 0.
                updateLockVersion: 1,
            };
        }

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: null,
            newItem: item,
            newVersion: item.updateLockVersion ?? 0,
        });

        if (this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            transactionEntries.push(
                this.#table.transactionDoesNotExistConditionCheck(
                    cast<RynamoPrivateGraveyardPartitionItemKey>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                    }),
                ),
            );
        }

        let transactionEntry;

        if (transactionEntries.length === 0) {
            transactionEntry = new RynamoTransactionEntryInternal({
                entry: this.#table.transactionCreateItem(item),
                schema: this,
                action,
            });
        } else {
            transactionEntry = new RynamoTransactionEntryInternal({
                entry: assertNonEmptyReadonlyArray([
                    this.#table.transactionCreateItem(item),
                    ...transactionEntries,
                ]),
                schema: this,
                action,
            });
        }

        return {
            transactionEntry,
            getEvent: action.getEvent,
        };
    }

    /**
     * Update an item in the database as the part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `directlyUpdateItem()` for more information.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     */
    transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        newItem: DynamoItem<Item>,
    ): RynamoTransactionEntry {
        return this.transactionDirectlyUpdateItemWithEvent(newItem).transactionEntry;
    }

    /**
     * Update an item in the database as the part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `directlyUpdateItem()` for more information.
     *
     * This function also returns methods to get the realtime item we create for this
     * transaction. This is useful if you need to use the realtime item afterwards.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     */
    transactionDirectlyUpdateItemWithEvent<Item extends Types["Item"]>(
        newItem: DynamoItem<Item>,
    ): {
        transactionEntry: RynamoTransactionEntry;
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    } {
        assert(
            newItem.partitionType !== rynamoPrivatePartitionName &&
                newItem.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (newItem.oldItem === null) {
            assert(
                (newItem.updateLockVersion ?? 0) === 0,
                "Item\u2019s `updateLockVersion` is greater than 0 but `oldItem` is null, did you use `DynamoItem.create()` to create this item instead of `DynamoItem.update()`?",
            );
        }

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: newItem.oldItem,
            newItem,
            newVersion: (newItem.updateLockVersion ?? 0) + 1,
        });

        let condition: DynamoCondition<Item> | undefined;

        // We need to test to make sure the attributes in the index partition keys of
        // `oldItem` are what's actually in the database. Since we use these attributes
        // from `oldItem` in `oldPartitionKeyByIndexName` which is used to generate diffs
        // that tell the client whether an item has left a particular query.
        if (action.indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of action.indexByName.values()) {
                for (const attributeName of index.dynamicPartitionKeyAttributeNames) {
                    if (
                        actualCondition === undefined ||
                        !hasOwnProperty(actualCondition, attributeName)
                    ) {
                        actualCondition ??= {};
                        // This check is so we're correctly handling the case where we're creating a new
                        // item (i.e. oldItem is null).
                        if (newItem.oldItem !== null) {
                            actualCondition[attributeName] = newItem.oldItem[attributeName];
                        } else {
                            actualCondition[attributeName] =
                                DynamoConditionExpression.exists().not();
                        }
                    }
                }
            }

            condition = actualCondition as any;
        }

        if (
            this.#features?.deleteItem?.[newItem.partitionType]?.[newItem.sortRangeType] &&
            (typeof newItem.updateLockVersion !== "number" || newItem.updateLockVersion === 0)
        ) {
            transactionEntries.push(
                this.#table.transactionDoesNotExistConditionCheck(
                    cast<RynamoPrivateGraveyardPartitionItemKey>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                    }),
                    // The caller expects `transactionDirectlyUpdateItem()` to be retriable. Therefore
                    // this gravestone check should be retriable in case it fails
                    // (`transactionDoesNotExistConditionCheck()` isn't retriable by default).
                    {isConditionCheckErrorRetriable: true},
                ),
            );
        }

        let transactionEntry;

        if (transactionEntries.length === 0) {
            transactionEntry = new RynamoTransactionEntryInternal({
                entry: this.#table.transactionDirectlyUpdateItem(newItem, {condition}),
                schema: this,
                action,
            });
        }
        // If we're creating the item then we need to make sure it doesn't have a
        // gravestone.
        else {
            transactionEntry = new RynamoTransactionEntryInternal({
                entry: assertNonEmptyReadonlyArray([
                    this.#table.transactionDirectlyUpdateItem(newItem, {condition}),
                    ...transactionEntries,
                ]),
                schema: this,
                action,
            });
        }

        return {
            transactionEntry,
            getEvent: action.getEvent,
        };
    }

    /**
     * Deletes an item from the database as part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `deleteItem()` for more information.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    transactionDeleteItem<Item extends Types["Item"]>(item: Item): RynamoTransactionEntry {
        return this.transactionDeleteItemWithEvent(item).transactionEntry;
    }

    /**
     * Deletes an item from the database as part of a transaction. In a transaction
     * either all entries succeed or all entries fail. See the documentation on
     * `deleteItem()` for more information.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    transactionDeleteItemWithEvent<const Item extends Types["Item"]>(
        item: Item,
    ): {
        transactionEntry: RynamoTransactionEntry;
        event: RynamoDeleteItemEvent;
    } {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const {action, transactionEntries} = this.#createDeleteItemAction(item);

        let condition: DynamoCondition<Item> | undefined;

        // We need to test to make sure the attributes in the index partition keys of
        // `item` are what's actually in the database. Since we use these attributes from
        // `item` in `oldPartitionKeyByIndexName` which is used to generate diffs that tell
        // the client whether an item has left a particular query.
        if (action.indexByName) {
            let actualCondition: {[key: string]: any} | undefined;

            for (const index of action.indexByName.values()) {
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

        const transactionEntry = new RynamoTransactionEntryInternal({
            entry: assertNonEmptyReadonlyArray([
                this.#table.transactionDeleteItem(item, {condition}),
                this.#table.transactionCreateOrReplaceItem(
                    cast<RynamoPrivateGraveyardPartitionItem>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                        updateLockVersion: action.eventStub.item.version,
                    }),
                ),
                ...transactionEntries,
            ]),
            schema: this,
            action,
        });

        return {
            transactionEntry,
            event: action.event,
        };
    }

    /**
     * Undeletes an item previously deleted with `deleteItem()` as part of a
     * transaction. In a transaction either all entries succeed or all entries fail.
     * See the documentation on `deleteItem()` for more information.
     *
     * You execute realtime transactions with `RynamoTableSchema.executeTransaction()`.
     * Can not be executed with `DynamoTableSchema.executeTransaction()`.
     *
     * To use this function you must enable it with the `features.deleteItem` object
     * passed into `RynamoTableSchema`.
     */
    transactionUndeleteItem<Item extends Types["Item"]>(
        deletedItem: RynamoTableDeletedItem,
        item: Item,
    ): RynamoTransactionEntry {
        return this.transactionUndeleteItemWithEvent(deletedItem, item).transactionEntry;
    }

    transactionUndeleteItemWithEvent<const Item extends Types["Item"]>(
        deletedItem: RynamoTableDeletedItem,
        item: Item,
    ): {
        transactionEntry: RynamoTransactionEntry;
        getEvent: (
            context: ServerActionContext,
        ) => Promise<RynamoPutItemEvent<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>>;
    } {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        if (!this.#features?.deleteItem?.[item.partitionType]?.[item.sortRangeType]) {
            throw new InternalError(
                `Deleted items are disabled (partition type: \`${item.partitionType}\`, sort range type: \`${item.sortRangeType}\`)`,
            );
        }

        item = {
            ...item,
            updateLockVersion: (deletedItem.updateLockVersion ?? 0) + 1,
        };

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: null,
            newItem: item,
            newVersion: item.updateLockVersion ?? 0,
        });

        const transactionEntry = new RynamoTransactionEntryInternal({
            entry: assertNonEmptyReadonlyArray([
                this.#table.transactionDeleteItem(
                    cast<RynamoPrivateGraveyardPartitionItem>({
                        partitionType: rynamoPrivateGraveyardPartitionName,
                        sortRangeType: "Gravestone",
                        deletedPartitionKey: action.getPartitionKey(),
                        deletedSortKey: action.getSortKey(),
                        updateLockVersion: deletedItem.updateLockVersion,
                    }),
                ),
                this.#table.transactionCreateOrReplaceItem(item),
                ...transactionEntries,
            ]),
            schema: this,
            action,
        });

        return {
            transactionEntry,
            getEvent: action.getEvent,
        };
    }

    /**
     * Checks whether an item exists and optionally some other conditions on the item.
     * If this condition fails then the entire transaction fails.
     */
    transactionConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
        condition?: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionConditionCheck(itemKey, condition);
    }

    /**
     * Creates a transaction entry that checks whether an item with the provided key
     * exists.
     */
    transactionExistsConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionExistsConditionCheck(itemKey);
    }

    /**
     * Checks that an item does not exist as a part of a transaction. If this condition
     * fails then the entire transaction fails.
     */
    transactionDoesNotExistConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
        options?: {isConditionCheckErrorRetriable?: boolean},
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionDoesNotExistConditionCheck(itemKey, options);
    }

    /**
     * Creates a transaction entry that checks the provided item exists and checks the
     * item has the version provided by `updateLockVersion`.
     */
    transactionUpdateLockVersionConditionCheck<Key extends Types["ItemKey"]>(
        itemKey: Key,
        updateLockVersion: number | undefined,
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionUpdateLockVersionConditionCheck(itemKey, updateLockVersion);
    }

    /**
     * Create an item in the database as part of a transaction. In a transaction either
     * all entries succeed or all entries fail.
     *
     * Under the hood this uses `DynamoTableSchema.transactionCreateOrReplaceItem()` or
     * simply the `PutItem` DynamoDB transaction action which doesn't use read request
     * units. This is cheaper than `transactionCreateItem()` but dangerous since if you
     * replace an item that exists our realtime communication with the client will
     * break! The client may think the old item that was replaced is actually the
     * latest data since the new item resets the version to 0.
     *
     * You may use this to save cost if you have other mechanisms in place to make
     * absolutely sure the item you're inserting does not currently exist.
     */
    transactionDangerouslyCreateItemWithoutExistenceConditionCheck<Item extends Types["Item"]>(
        item: Item,
    ): RynamoTransactionEntry {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const {action, transactionEntries} = this.#createPutItemAction({
            oldItem: null,
            newItem: item,
            newVersion: item.updateLockVersion ?? 0,
        });

        if (transactionEntries.length === 0) {
            return new RynamoTransactionEntryInternal({
                entry: this.#table.transactionCreateOrReplaceItem(item),
                schema: this,
                action,
            });
        } else {
            return new RynamoTransactionEntryInternal({
                entry: assertNonEmptyReadonlyArray([
                    this.#table.transactionCreateOrReplaceItem(item),
                    ...transactionEntries,
                ]),
                schema: this,
                action,
            });
        }
    }

    /**
     * Create an item in the database as part of a transaction. In a transaction either
     * all entries succeed or all entries fail.
     *
     * See `transactionDangerouslyCreateItemWithoutExistenceConditionCheck()` for a
     * warning on the dangers of skipping the existence check.
     *
     * We also won't send a realtime update event to clients! So a client won't even
     * know an item was created. Because this method is very dangerous it's basically
     * only useful for implementing database migrations.
     */
    transactionDangerouslyCreateItemWithoutExistenceConditionCheckAndWithoutEvent<
        Item extends Types["Item"],
    >(
        item: Item,
        options?: {onAfterTransactionExecutedSuccessfully?: () => void},
    ): DynamoTransactionEntry {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionCreateOrReplaceItem(item, options);
    }

    /**
     * Update a single attribute on the item with the specified key. The update is
     * serialized with all other updates of this item with `updateLockVersion`.
     *
     * See `DynamoTableSchema.transactionDirectlyUpdateItemAttribute()` for more
     * information.
     *
     * This method is dangerous for realtime tables because we can't send an update
     * event! We can only send an update event when we have the full item at the time
     * of the update. You should only use this method if you're confident it's ok if
     * the property is not updated in realtime.
     */
    transactionDangerouslyDirectlyUpdateItemAttributeWithoutEvent<
        ItemKey extends Types["ItemKey"],
        Attribute extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        itemKey: ItemKey,
        attribute: Attribute,
        attributeValue: Extract<Types["Item"], ItemKey>[Attribute],
        options: {updateLockVersion: number | undefined},
    ): DynamoTransactionEntry {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionDirectlyUpdateItemAttribute(
            itemKey,
            attribute,
            attributeValue,
            options,
        );
    }

    /**
     * Transaction entry for deleting an item in the database. Same semantics as
     * `deleteItem()` but can be part of a transaction that atomically succeeds or
     * fails.
     *
     * Use `DynamoTableSchema.executeTransaction()` to execute a transaction.
     *
     * This method is dangerous for realtime tables because if you call `createItem()`
     * again with the same item key it'll restart from version 0 which will break
     * realtime clients! Prefer using `deleteItem()` which leaves a gravestone when you
     * delete an item.
     *
     * If you want to delete an item from the table anyway while breaking this table's
     * realtime guarantees you may use this method.
     */
    transactionDangerouslyDeleteItemWithoutGravestoneAndWithoutEvent<Item extends Types["Item"]>(
        item: Item,
    ): DynamoTransactionEntry {
        assert(
            item.partitionType !== rynamoPrivatePartitionName &&
                item.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.transactionDeleteItem(item);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null.
     */
    async getItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<DynamoItem<MergeObjectIntersection<Types["Item"] & Key>> | null> {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return await this.#table._getItemWithOldItemIfExists(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     */
    async getItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {
            consistency?: DynamoCacheReadConsistency;
            allowsEventualReadConsistency?: boolean;
        },
    ): Promise<DynamoItem<MergeObjectIntersection<Types["Item"] & Key>>> {
        const item = await this.getItemIfExists(context, itemKey, options);

        if (!item) {
            throw new NotFoundError(
                `Item not found (partition type: \`${itemKey.partitionType}\`, sort range type: \`${itemKey.sortRangeType}\`)`,
            );
        }

        return item;
    }

    /**
     * Tries to get an item first with eventual consistency and if that doesn't find
     * the item tries again with strong consistency. Use this when:
     *
     * 1. You know an item definitely exists; AND
     * 2. You want to use a cheaper eventual consistency read in most cases; AND
     * 3. You expect the item may have been recently created so an eventually
     *    consistent read may be stale and not return an item
     */
    async getItemWithEventualThenStrongConsistency<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {allowsEventualReadConsistency?: boolean},
    ): Promise<DynamoItem<MergeObjectIntersection<Types["Item"] & Key>>> {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const item = await this.getItemIfExists(context, itemKey, {
            ...options,
            consistency: "Eventual",
        });
        if (item) return item;

        return await this.getItem(context, itemKey, {
            ...options,
            consistency: "Strong",
        });
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Returns
     * `null` if the item does not exist.
     */
    getPartialItemIfExists<
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
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.getPartialItemIfExists(context, itemKey, options);
    }

    /**
     * Gets a few attributes of a single item by its key from the database. Throws an
     * error if the item doesn't exist.
     */
    getPartialItem<
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
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table.getPartialItem(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null. Also
     * returns all the auxillary information a client will need to maintain this data
     * in realtime.
     */
    async getRealtimeItemIfExists<Key extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<RynamoItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]> | null> {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const item = await this.#table.getItemIfExists(context, itemKey, options);
        if (!item) return null;

        return {
            key: this.#table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this.#buildModel(context, item),
        };
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error. Also
     * returns all the auxillary information a client will need to maintain this data
     * in realtime.
     */
    async getRealtimeItem<Key extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoCacheReadConsistency},
    ): Promise<RynamoItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
        assert(
            itemKey.partitionType !== rynamoPrivatePartitionName &&
                itemKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        const item = await this.#table.getItem(context, itemKey, options);

        return {
            key: this.#table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this.#buildModel(context, item),
        };
    }

    /**
     * Build a realtime item from a DynamoDB item object we've previously loaded.
     */
    async buildRealtimeItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
    ): Promise<RynamoItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>> {
        return {
            key: this.#table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this.#buildModel(context, item),
        };
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB collocates
     * related data. Does not return information to keep the query up-to-date in
     * realtime. For realtime support use `realtimeQuery()`.
     */
    query<
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
            // Required to specify a limit or the `All` string. So if you intentionally want
            // everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            consistency?: DynamoCacheReadConsistency;
        },
    ): AsyncIterableIterator<
        DynamoItem<
            MergeObjectIntersection<
                Types["Item"] &
                    PartitionKey & {
                        readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                    }
            >
        >
    > {
        assert(
            options.partitionKey.partitionType !== rynamoPrivatePartitionName &&
                options.partitionKey.partitionType !== rynamoPrivateGraveyardPartitionName,
            "Can\u2019t access private realtime partition",
        );

        return this.#table._queryWithOldItems(context, options);
    }

    getRealtimeQueryPartitionKey(partitionKey: Types["PartitionKey"]) {
        if (!this.#features?.realtimeQuery?.[partitionKey.partitionType]) {
            throw new InternalError(
                `Realtime queries are disabled (partition type: \`${partitionKey.partitionType}\`)`,
            );
        }

        return this.#table.serializeOpaqueItemPartitionKey(partitionKey);
    }

    /**
     * Create an empty realtime query result. Useful for initializing a query result
     * when you _absolutely_ know you do not have any data.
     *
     * Does not perform any database operations. Be careful when using this! Realtime
     * can get stuck if there's actual data in the query and you use this.
     */
    realtimeQueryIfYouAreCertainThePartitionIsEmpty<
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >({
        partitionKey,
        startSortKey,
        endSortKey,
        paginate = {type: "FromStart"},
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
    }): RynamoQueryResult<
        ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
    > {
        if (!this.#features?.realtimeQuery?.[partitionKey.partitionType]) {
            throw new InternalError(
                `Realtime queries are disabled (partition type: \`${partitionKey.partitionType}\`)`,
            );
        }

        const checkpoint = generateServerSynchronizationCheckpoint();

        const paginateItemKeyString =
            paginate.type === "FromStart" ? paginate.afterItemKey : paginate.beforeItemKey;

        const paginateItemKey = paginateItemKeyString
            ? this.#table.deserializeOpaqueItemKey(paginateItemKeyString)
            : undefined;

        // Make sure the partition key part of `paginateItemKey` is the same as our
        // `partitionKey`.
        if (paginateItemKey) {
            if (paginateItemKey.partitionType !== partitionKey.partitionType) {
                throw new InvalidArgumentError(
                    quote`Pagination item key (partition type: ${paginateItemKey.partitionType}) must have the same partition type as query partition key (partition type: ${partitionKey.partitionType})`,
                );
            }

            const partitionKeyAttributes = this.#table.getPartitionKeyAttributes(
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

        const startItemKey = startSortKey
            ? this.#table.serializeOpaqueItemKey({...startSortKey, ...partitionKey})
            : null;

        const endItemKey = endSortKey
            ? this.#table.serializeOpaqueItemKey({...endSortKey, ...partitionKey})
            : null;

        return {
            checkpoint,
            partitionKey: this.#table.serializeOpaqueItemPartitionKey(partitionKey),
            startItemKey,
            endItemKey,
            pageInfo:
                paginate.type === "FromStart"
                    ? {
                          type: "FromStart",
                          afterItemKey: paginate.afterItemKey ?? null,
                          hasNextPage: false,
                      }
                    : {
                          type: "FromEnd",
                          beforeItemKey: paginate.beforeItemKey ?? null,
                          hasPreviousPage: false,
                      },
            items: [],
        };
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB collocates
     * related data. Also returns all the auxillary information necessary for a client
     * to keep a query up-to-date in realtime.
     */
    async realtimeQuery<
        const PartitionKey extends Types["PartitionKey"],
        const StartSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
        const EndSortKey extends Types["SortKeyMap"][PartitionKey["partitionType"]],
    >(
        context: ServerActionContext,
        {
            partitionKey,
            startSortKey,
            endSortKey,
            paginate = {type: "FromStart"},
            limit,
            consistency,
            onItem,
            onModel,
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
            // Required to specify a limit or the `All` string. So if you intentionally want
            // everything you have to say so.
            limit: number | "All";
            consistency?: DynamoCacheReadConsistency;
            // Fires with the raw underlying item as soon as it's read from the database,
            // before the model is built. Use this when you need the earliest possible signal
            // from the query (e.g. to read attributes off the raw item).
            onItem?: (
                item: Extract<
                    Types["Item"],
                    PartitionKey & {
                        readonly sortRangeType: Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]];
                    }
                >,
            ) => void;
            // Fires after the model has been built for an item. Use this when you need the
            // parsed model.
            onModel?: (
                item: RynamoItem<
                    ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
                >,
            ) => void;
        },
    ): Promise<
        RynamoQueryResult<
            ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
        >
    > {
        if (!this.#features?.realtimeQuery?.[partitionKey.partitionType]) {
            throw new InternalError(
                `Realtime queries are disabled (partition type: \`${partitionKey.partitionType}\`)`,
            );
        }

        // We backfill realtime updates to `checkpoint` so it should be before the data is
        // read from the database to avoid missing realtime updates.
        const checkpoint = generateServerSynchronizationCheckpoint();

        const paginateItemKeyString =
            paginate.type === "FromStart" ? paginate.afterItemKey : paginate.beforeItemKey;

        const paginateItemKey = paginateItemKeyString
            ? this.#table.deserializeOpaqueItemKey(paginateItemKeyString)
            : undefined;

        // Make sure the partition key part of `paginateItemKey` is the same as our
        // `partitionKey`.
        if (paginateItemKey) {
            if (paginateItemKey.partitionType !== partitionKey.partitionType) {
                throw new InvalidArgumentError(
                    quote`Pagination item key (partition type: ${paginateItemKey.partitionType}) must have the same partition type as query partition key (partition type: ${partitionKey.partitionType})`,
                );
            }

            const partitionKeyAttributes = this.#table.getPartitionKeyAttributes(
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
            this.#table.query(context, {
                partitionKey,
                startSortKey,
                endSortKey,
                afterItemKey: paginateItemKey as any,
                descending: paginate.type === "FromEnd",
                // Fetch one extra item so we can accurately say whether there are more items at
                // the beginning or end of the query.
                limit: typeof limit === "number" ? limit + 1 : limit,
                consistency,
            }),
            async (item, index) => {
                // Don't build the model for an over-fetched item we use to determine if there are
                // more items in the query.
                if (typeof limit === "number" && index >= limit) return null;

                // Observe the raw item before paying the cost of building the model.
                onItem?.(item as any);

                const realtimeItem = {
                    key: this.#table.serializeOpaqueItemKey(item),
                    version: item.updateLockVersion ?? 0,
                    model: await this.#buildModel(context, item),
                };

                // If you want to observe query items immediately after they're built you can use
                // the `onModel` callback.
                onModel?.(realtimeItem);

                return realtimeItem;
            },
        );

        const startItemKey = startSortKey
            ? this.#table.serializeOpaqueItemKey({...startSortKey, ...partitionKey})
            : null;

        const endItemKey = endSortKey
            ? this.#table.serializeOpaqueItemKey({...endSortKey, ...partitionKey})
            : null;

        const hasMoreItems = typeof limit === "number" && items.length > limit;

        // Remove any items we over-fetched to determine if there were items after the
        // limit. (Should just be one.)
        while (typeof limit === "number" && items.length > limit) {
            items.pop();
        }

        // When paginating from the end, we queried items in descending order. Reverse them
        // to get them back to the proper order.
        if (paginate.type === "FromEnd") {
            items.reverse();
        }

        // We should have removed all null items past our limit above.
        const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

        // If we are in a development or test environment, verify that key strings are
        // orderable. This would create overhead in production.
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
            checkpoint,
            partitionKey: this.#table.serializeOpaqueItemPartitionKey(partitionKey),
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
     * Backfill any updates that happened since the query was read and now. Useful when
     * you connect to realtime after dispatching your query.
     */
    backfillRealtimeQuery<const PartitionKey extends Types["PartitionKey"]>(
        context: ServerActionContext,
        {
            partitionKey,
            checkpoint,
        }: {partitionKey: PartitionKey; checkpoint: ServerSynchronizationCheckpoint},
    ): Promise<
        RynamoBackfillResult<
            ModelMap[PartitionKey["partitionType"]][keyof ModelMap[PartitionKey["partitionType"]]]
        >
    > {
        const partitionKeyString = this.#table.serializeOpaqueItemPartitionKey(partitionKey);

        return this.#backfillRealtimeQuery(context, {
            realtimeKey: partitionKeyString,
            checkpoint,
            source: {
                type: "Table",
                partitionKey: partitionKeyString,
            },
        });
    }

    /**
     * Scans every item in the table. Since tables can get very large this function is
     * expensive! Generally you should avoid it.
     *
     * Corresponds to the [`Scan`][1] command.
     *
     * [1]:
     *     https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_Scan.html
     */
    async *expensiveScan(
        context: DynamoContext,
        options: {
            limit?: number;
            consistency?: DynamoReadConsistency;
            segmentIndex?: number;
            totalSegmentCount?: number;
            filter?: Types["ItemType"] | Array<Types["ItemType"]>;
        } = {},
    ): AsyncIterableIterator<DynamoItem<MergeObjectIntersection<Types["Item"]>>> {
        for await (const item of this.#table._expensiveScanWithOldItems(context, options)) {
            if (item.partitionType === rynamoPrivatePartitionName) continue;
            if (item.partitionType === rynamoPrivateGraveyardPartitionName) continue;
            yield item;
        }
    }

    /**
     * Adds an index to the table that replicates the entire item in the index. This
     * doubles your storage costs for the table! Once for the base table and once for
     * the index. You should have ideally zero indexes on the table but if you
     * absolutely need them don't create too many.
     *
     * Index queries contain a cursor for every item. The lexicographic order of
     * cursors is the same order as items in the index which allows the client to sort
     * locally.
     *
     * Our realtime implementation shares the index name you provide here with the
     * client! Make sure this name doesn't contain any secrets.
     *
     * ## Tradeoffs
     *
     * Look at `addEventualConsistencyIndexWithQueryJoin()` and consider if it provides
     * better performance characteristics for your use case.
     */
    addExpensiveFullEventualConsistencyIndex<
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
    ): RynamoTableSchemaIndex<
        ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]],
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== rynamoPrivatePartitionName &&
                    itemType.partitionType !== rynamoPrivateGraveyardPartitionName,
            ),
            "Can\u2019t access private realtime partition",
        );

        const Index = this.#table.addExpensiveFullIndex<
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

        // If there is only partition type, we call it the index's "exclusive" partition
        // type.
        const exclusivePartitionType =
            partitionTypes.size === 1 ? Array.from(partitionTypes)[0]! : null;

        // We can reuse the table partition key as our index's realtime key and reduce the
        // write capacity units we use when:
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
                        this.#table.getPartitionKeyAttributes(exclusivePartitionType),
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

        const keyAttributeNames = [
            ...Object.keys(Index.partitionKeyAttributes),
            ...Object.keys(Index.sortKeyAttributes),
        ];

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const indexByName = getOrSetDefaultMapValue(
                this.#indexByNameByItemType,
                itemType,
                () => new Map(),
            );

            const keyAttributes = this.#table.getKeyAttributes(partitionType, sortRangeType);

            assert(!indexByName.has(config.name));
            indexByName.set(config.name, {
                isStrongConsistency: false,
                canReuseTablePartitionKeyForRealtimeKey,
                dynamicPartitionKeyAttributeNames: Object.keys(Index.partitionKeyAttributes).filter(
                    attributeName =>
                        !hasOwnProperty(keyAttributes.partitionKeyAttributes, attributeName) &&
                        !hasOwnProperty(keyAttributes.sortKeyAttributes, attributeName),
                ),
                keyAttributeNames,
                serializeOpaquePartitionKey: Index.serializeOpaquePartitionKey as (
                    partitionKey: unknown,
                ) => DynamoIndexPartitionKey,
                serializeOpaqueCursor: Index.serializeOpaqueCursor as (
                    itemKey: unknown,
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
                    consistency = "Eventual",
                },
            ): Promise<
                RynamoIndexQueryResult<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // Index queries only support eventual consistency.
                assert(consistency === "Eventual");

                // We backfill realtime updates to `checkpoint` so it should be before the data is
                // read from the database to avoid missing realtime updates.
                const checkpoint = generateServerSynchronizationCheckpoint();

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
                        // Fetch one extra item so we can accurately say whether there are more items at
                        // the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                    }),
                    async (item, index) => {
                        // Don't build the model for an over-fetched item we use to determine if there are
                        // more items in the query.
                        if (typeof limit === "number" && index >= limit) return null;

                        return {
                            cursor: Index.serializeOpaqueCursor(item),
                            key: this.#table.serializeOpaqueItemKey(item),
                            version: item.updateLockVersion ?? 0,
                            model: await this.#buildModel(context, item),
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

                // When paginating from the end, we queried items in descending order. Reverse them
                // to get them back to the proper order.
                if (paginate.type === "FromEnd") {
                    items.reverse();
                }

                // We should have removed all null items past our limit above.
                const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

                // If we are in a development or test environment, verify that cursors strings are
                // orderable. This would create overhead in production.
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
                    checkpoint,
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

            query: async (
                context: DynamoContext,
                options: {
                    partitionKey: DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>;
                    startSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    endSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    isStartSortKeyExclusive?: boolean;
                    isEndSortKeyExclusive?: boolean;
                    // Required to specify a limit or the `All` string. So if you intentionally want
                    // everything you have to say so.
                    limit: number | "All";
                    pageLimit?: number;
                    descending?: boolean;
                    consistency?: DynamoCacheReadConsistency;
                },
            ) => {
                const {consistency = "Eventual"} = options;

                // Index queries only support eventual consistency.
                assert(consistency === "Eventual");

                return await arrayFromAsyncIterable(Index.query(context, options));
            },

            backfillRealtimeQuery: (context, {partitionKey, checkpoint}) => {
                const partitionKeyString = Index.serializeOpaquePartitionKey(partitionKey);

                return this.#backfillRealtimeQuery(context, {
                    // If our index's partition key is the same as our table's partition key then we
                    // can save some WCUs by writing all updates under the table's partition key (which
                    // is used for `table.realtimeQuery()`).
                    realtimeKey: canReuseTablePartitionKeyForRealtimeKey
                        ? this.#table.serializeOpaqueItemPartitionKey({
                              partitionType: exclusivePartitionType,
                              ...partitionKey,
                          })
                        : `${config.name}:${partitionKeyString}`,
                    checkpoint,
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
     * Adds an index to the table. Indexes allow you to build different access patterns
     * for your data.
     *
     * Index queries contain a cursor for every item. The lexicographic order of
     * cursors is the same order as items in the index which allows the client to sort
     * locally.
     *
     * Our realtime implementation shares the index name you provide here with the
     * client! Make sure this name doesn't contain any secrets.
     *
     * ## Tradeoffs
     *
     * Unlike `addExpensiveFullEventualConsistencyIndex()` we don't replicate the full
     * item to the index. Instead we only replicate the item key. However, at query
     * time we still need the full item so we call `getItem()` to grab it. The tradeoff
     * here is:
     *
     * - `addExpensiveFullEventualConsistencyIndex()` doubles our write costs and
     *   storage costs. Since we need to replicate the full item to the index.
     *
     * - `addEventualConsistencyIndexWithQueryJoin()` increases our write costs and
     *   storage costs a little (less than
     *   `addExpensiveFullEventualConsistencyIndex()`) but doubles our read costs.
     *   Since we only replicate the key and at query time we load the full item.
     *
     * `addEventualConsistencyIndexWithQueryJoin()` is better for you if:
     *
     * 1. Your items are big. Then the write/storage savings of
     *    `addEventualConsistencyIndexWithQueryJoin()` will be meaningful.
     *
     * 2. Queries are infrequent so they can afford to be slower.
     *
     * For example, forum posts use `addEventualConsistencyIndexWithQueryJoin()`
     * because post content can get quite large and posts are mostly read through the
     * home feed or inbox anyway (vs directly navigating to a channel which calls the
     * query function).
     */
    addEventualConsistencyIndexWithQueryJoin<
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
    ): RynamoTableSchemaIndex<
        ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]],
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== rynamoPrivatePartitionName &&
                    itemType.partitionType !== rynamoPrivateGraveyardPartitionName,
            ),
            "Can\u2019t access private realtime partition",
        );

        const Index = this.#table.addIndex<
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

        // If there is only partition type, we call it the index's "exclusive" partition
        // type.
        const exclusivePartitionType =
            partitionTypes.size === 1 ? Array.from(partitionTypes)[0]! : null;

        // We can reuse the table partition key as our index's realtime key and reduce the
        // write capacity units we need when:
        //
        // - The index only serves data from a single partition
        // - The index's partition key matches that partition's partition key
        //
        // This means we can get the partition key from our index partition key plus adding
        // `partitionType: exclusivePartitionType`.
        const canReuseTablePartitionKeyForRealtimeKey: boolean =
            !!exclusivePartitionType &&
            isDeepEqual(
                Object.entries(
                    mapObjectValues(
                        this.#table.getPartitionKeyAttributes(exclusivePartitionType),
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

        const keyAttributeNames = [
            ...Object.keys(Index.partitionKeyAttributes),
            ...Object.keys(Index.sortKeyAttributes),
        ];

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const indexByName = getOrSetDefaultMapValue(
                this.#indexByNameByItemType,
                itemType,
                () => new Map(),
            );

            const keyAttributes = this.#table.getKeyAttributes(partitionType, sortRangeType);

            assert(!indexByName.has(config.name));
            indexByName.set(config.name, {
                isStrongConsistency: false,
                canReuseTablePartitionKeyForRealtimeKey,
                dynamicPartitionKeyAttributeNames: Object.keys(Index.partitionKeyAttributes).filter(
                    attributeName =>
                        !hasOwnProperty(keyAttributes.partitionKeyAttributes, attributeName) &&
                        !hasOwnProperty(keyAttributes.sortKeyAttributes, attributeName),
                ),
                keyAttributeNames,
                serializeOpaquePartitionKey: Index.serializeOpaquePartitionKey as (
                    partitionKey: unknown,
                ) => DynamoIndexPartitionKey,
                serializeOpaqueCursor: Index.serializeOpaqueCursor as (
                    itemKey: unknown,
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
                    consistency = "Eventual",
                },
            ): Promise<
                RynamoIndexQueryResult<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // Index queries only support eventual consistency.
                assert(consistency === "Eventual");

                // We backfill realtime updates to `checkpoint` so it should be before the data is
                // read from the database to avoid missing realtime updates.
                const checkpoint = generateServerSynchronizationCheckpoint();

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
                        // Fetch one extra item so we can accurately say whether there are more items at
                        // the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                    }),
                    async (itemKey, index) => {
                        // Don't build the model for an over-fetched item we use to determine if there are
                        // more items in the query.
                        if (typeof limit === "number" && index >= limit) return null;

                        // This is the critical "join" operation referenced by the name
                        // `addIndexWithQueryJoin()`. Basically everything else about this index creation
                        // is the same as `addExpensiveFullIndex()`.
                        const item = await this.#table.getItem(context, itemKey);

                        return {
                            cursor: Index.serializeOpaqueCursor(item),
                            key: this.#table.serializeOpaqueItemKey(item),
                            version: item.updateLockVersion ?? 0,
                            model: await this.#buildModel(context, item),
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

                // When paginating from the end, we queried items in descending order. Reverse them
                // to get them back to the proper order.
                if (paginate.type === "FromEnd") {
                    items.reverse();
                }

                // We should have removed all null items past our limit above.
                const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

                // If we are in a development or test environment, verify that cursors strings are
                // orderable. This would create overhead in production.
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
                    checkpoint,
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

            query: async (
                context: DynamoContext,
                options: {
                    partitionKey: DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>;
                    startSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    endSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    isStartSortKeyExclusive?: boolean;
                    isEndSortKeyExclusive?: boolean;
                    // Required to specify a limit or the `All` string. So if you intentionally want
                    // everything you have to say so.
                    limit: number | "All";
                    pageLimit?: number;
                    descending?: boolean;
                    consistency?: DynamoCacheReadConsistency;
                },
            ) => {
                const {consistency = "Eventual"} = options;

                // Index queries only support eventual consistency.
                assert(consistency === "Eventual");

                // Query the index to get item keys, then fetch full items from the table. This is
                // the "join" operation - the index only stores keys, not full items.
                return await parallelMapAsyncIterableToArray(
                    Index.query(context, options),
                    async itemKey => {
                        return await this.#table.getItem(context, itemKey);
                    },
                );
            },

            backfillRealtimeQuery: (context, {partitionKey, checkpoint}) => {
                const partitionKeyString = Index.serializeOpaquePartitionKey(partitionKey);

                return this.#backfillRealtimeQuery(context, {
                    // If our index's partition key is the same as our table's partition key then we
                    // can save some WCUs by writing all updates under the table's partition key (which
                    // is used for `table.realtimeQuery()`).
                    realtimeKey: canReuseTablePartitionKeyForRealtimeKey
                        ? this.#table.serializeOpaqueItemPartitionKey({
                              partitionType: exclusivePartitionType,
                              ...partitionKey,
                          })
                        : `${config.name}:${partitionKeyString}`,
                    checkpoint,
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

    /**
     * Adds an index to a general realtime table without adding any realtime
     * functionality.
     *
     * This means no realtime event transaction items are created specifically for this
     * index's partition keys, and you cannot perform realtime queries or backfills
     * against it. This is useful if you aren't sending updates to your index back to a
     * client in real time and aren't concerned with anything other than the values in
     * the index at query time.
     *
     * It is a wrapper around `DynamoTableSchema.addIndex()`, so has the same
     * implementation details.
     */
    addEventualConsistencyIndexWithoutRealtime<
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
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== rynamoPrivatePartitionName &&
                    itemType.partitionType !== rynamoPrivateGraveyardPartitionName,
            ),
            "Can\u2019t access private realtime partition",
        );

        return this.#table.addIndex<
            ItemTypes,
            PartitionKeyAttributesConfig,
            SortKeyAttributesConfig
        >(config);
    }

    /**
     * Adds an index which can be queried with strong consistency to the table.
     *
     * The index stores item keys as regular DynamoDB table items (instead of a global
     * secondary index) and maintains those items in the same transaction as item
     * writes. This costs additional WCUs on writes but allows queries to use strongly
     * consistent reads.
     */
    addStrongConsistencyIndexWithQueryJoin<
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
    ): RynamoTableSchemaIndex<
        ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]],
        DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>
    > {
        assert(
            config.itemTypes.every(
                itemType =>
                    itemType.partitionType !== rynamoPrivatePartitionName &&
                    itemType.partitionType !== rynamoPrivateGraveyardPartitionName,
            ),
            "Can\u2019t access private realtime partition",
        );

        // All attributes in the item key must be included in the index partition key +
        // sort key. That way index keys are uniquely assignable to items and we can
        // correctly sort in user-land on the client.
        //
        // The `includePrimaryKeyInSortKey` option used in the
        // `addEventualConsistencyIndexWithQueryJoin()` call solves the same underlying
        // problem but by making sure we always include all attributes in index keys
        // automatically. Which we could choose to do here eventually.
        for (const itemType of config.itemTypes) {
            const {partitionKeyAttributes, sortKeyAttributes} = this.#table.getKeyAttributes(
                itemType.partitionType,
                itemType.sortRangeType,
            );

            for (const keyAttributeName of Object.keys(partitionKeyAttributes)) {
                assert(
                    hasOwnProperty(config.partitionKeyAttributes, keyAttributeName) ||
                        hasOwnProperty(config.sortKeyAttributes, keyAttributeName),
                );
            }

            for (const keyAttributeName of Object.keys(sortKeyAttributes)) {
                assert(
                    hasOwnProperty(config.partitionKeyAttributes, keyAttributeName) ||
                        hasOwnProperty(config.sortKeyAttributes, keyAttributeName),
                );
            }
        }

        const indexConfig = {
            partitionKeyAttributes:
                config.partitionKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
            sortKeyAttributes:
                config.sortKeyAttributes as DynamoTableSchemaTypes.KeyAttributes.ConfigBase,
        };

        this.#table._addPartitionBeforeInitialization({
            name: config.name,
            partitionKeyAttributes: indexConfig.partitionKeyAttributes,
            sortRanges: [
                {
                    name: "Index",
                    sortKeyAttributes: indexConfig.sortKeyAttributes,
                    attributes: Schema.object({
                        actualPartitionType: Schema.enum(
                            config.itemTypes.map(itemType => itemType.partitionType),
                        ),
                        actualSortRangeType: Schema.enum(
                            config.itemTypes.map(itemType => itemType.sortRangeType),
                        ),
                    }),
                },
            ],
        });

        const partitionTypes = new Set(config.itemTypes.map(itemType => itemType.partitionType));

        // If there is only partition type, we call it the index's "exclusive" partition
        // type.
        const exclusivePartitionType =
            partitionTypes.size === 1 ? Array.from(partitionTypes)[0]! : null;

        // We can reuse the table partition key as our index's realtime key and reduce the
        // write capacity units we need when:
        //
        // - The index only serves data from a single partition
        // - The index's partition key matches that partition's partition key
        //
        // This means we can get the partition key from our index partition key plus adding
        // `partitionType: exclusivePartitionType`.
        const canReuseTablePartitionKeyForRealtimeKey: boolean =
            !!exclusivePartitionType &&
            isDeepEqual(
                Object.entries(
                    mapObjectValues(
                        this.#table.getPartitionKeyAttributes(exclusivePartitionType),
                        attribute => attribute.description,
                    ),
                ),
                Object.entries(
                    mapObjectValues(
                        indexConfig.partitionKeyAttributes,
                        attribute => attribute.description,
                    ),
                ),
            );

        const keyAttributeNames = [
            ...Object.keys(indexConfig.partitionKeyAttributes),
            ...Object.keys(indexConfig.sortKeyAttributes),
        ];

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const indexByName = getOrSetDefaultMapValue(
                this.#indexByNameByItemType,
                itemType,
                () => new Map(),
            );

            const keyAttributes = this.#table.getKeyAttributes(partitionType, sortRangeType);

            assert(!indexByName.has(config.name));
            indexByName.set(config.name, {
                isStrongConsistency: true,
                canReuseTablePartitionKeyForRealtimeKey,
                dynamicPartitionKeyAttributeNames: Object.keys(
                    config.partitionKeyAttributes,
                ).filter(
                    attributeName =>
                        !hasOwnProperty(keyAttributes.partitionKeyAttributes, attributeName) &&
                        !hasOwnProperty(keyAttributes.sortKeyAttributes, attributeName),
                ),
                keyAttributeNames,
                serializeOpaquePartitionKey: partitionKey =>
                    this.#table._serializeOpaqueIndexPartitionKey(indexConfig, partitionKey as any),
                serializeOpaqueCursor: item =>
                    this.#table._serializeOpaqueIndexCursor(indexConfig, item as any),
            });
        }

        const query = (
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
                consistency,
            }: {
                partitionKey: DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>;
                startSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                endSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                isStartSortKeyExclusive?: boolean;
                isEndSortKeyExclusive?: boolean;
                afterItemKey?: any;
                // Required to specify a limit or the `All` string. So if you intentionally want
                // everything you have to say so.
                limit: number | "All";
                pageLimit?: number;
                descending?: boolean;
                consistency?: DynamoCacheReadConsistency;
            },
        ) => {
            return mapAsyncIterableIterator(
                this.#table.query(context, {
                    partitionKey: {...partitionKey, partitionType: config.name},
                    startSortKey:
                        startSortKey !== undefined
                            ? ({...startSortKey, sortRangeType: "Index"} as any)
                            : undefined,
                    endSortKey:
                        endSortKey !== undefined
                            ? ({...endSortKey, sortRangeType: "Index"} as any)
                            : undefined,
                    isStartSortKeyExclusive,
                    isEndSortKeyExclusive,
                    afterItemKey,
                    limit,
                    pageLimit,
                    descending,
                    consistency,
                }),
                (item: any) => {
                    item.partitionType = item.actualPartitionType;
                    item.sortRangeType = item.actualSortRangeType;
                    delete item.actualPartitionType;
                    delete item.actualSortRangeType;
                    return item;
                },
            );
        };

        return {
            name: config.name,
            partitionKeyAttributes: config.partitionKeyAttributes as any,
            sortKeyAttributes: config.sortKeyAttributes as any,

            getRealtimeQueryPartitionKey: partitionKey => {
                return this.#table._serializeOpaqueIndexPartitionKey(indexConfig, partitionKey);
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
                    consistency,
                },
            ): Promise<
                RynamoIndexQueryResult<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // We backfill realtime updates to `checkpoint` so it should be before the data is
                // read from the database to avoid missing realtime updates.
                const checkpoint = generateServerSynchronizationCheckpoint();

                const cursor =
                    paginate.type === "FromStart" ? paginate.afterCursor : paginate.beforeCursor;

                const items = await parallelMapAsyncIterableToArray(
                    query(context, {
                        partitionKey,
                        startSortKey,
                        endSortKey,
                        isStartSortKeyExclusive,
                        isEndSortKeyExclusive,
                        descending: paginate.type === "FromEnd",
                        afterItemKey:
                            typeof cursor === "string"
                                ? this.#table._deserializeOpaqueIndexCursor(
                                      indexConfig,
                                      partitionKey,
                                      cursor,
                                  )
                                : undefined,
                        // Fetch one extra item so we can accurately say whether there are more items at
                        // the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                        consistency,
                    }),
                    async (itemKey, index) => {
                        // Don't build the model for an over-fetched item we use to determine if there are
                        // more items in the query.
                        if (typeof limit === "number" && index >= limit) return null;

                        // This is the critical "join" operation referenced by the name
                        // `addIndexWithQueryJoin()`. Basically everything else about this index creation
                        // is the same as `addExpensiveFullIndex()`.
                        const item = await this.#table.getItem(context, itemKey, {consistency});

                        return {
                            cursor: this.#table._serializeOpaqueIndexCursor(indexConfig, item),
                            key: this.#table.serializeOpaqueItemKey(item),
                            version: item.updateLockVersion ?? 0,
                            model: await this.#buildModel(context, item),
                        };
                    },
                );

                const startCursorBound = startSortKey
                    ? this.#table._serializeOpaqueIndexCursorBound(
                          indexConfig,
                          startSortKey,
                          isStartSortKeyExclusive ? "StartExclusive" : "StartInclusive",
                      )
                    : null;

                const endCursorBound = endSortKey
                    ? this.#table._serializeOpaqueIndexCursorBound(
                          indexConfig,
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

                // When paginating from the end, we queried items in descending order. Reverse them
                // to get them back to the proper order.
                if (paginate.type === "FromEnd") {
                    items.reverse();
                }

                // We should have removed all null items past our limit above.
                const finalItems = items as ReadonlyArray<NonNullable<(typeof items)[number]>>;

                // If we are in a development or test environment, verify that cursors strings are
                // orderable. This would create overhead in production.
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
                    checkpoint,
                    indexName: config.name,
                    partitionKey: this.#table._serializeOpaqueIndexPartitionKey(
                        indexConfig,
                        partitionKey,
                    ),
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

            query: async (
                context: DynamoContext,
                options: {
                    partitionKey: DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>;
                    startSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    endSortKey?: DynamoTableSchemaIndexKeyAttributesType<SortKeyAttributesConfig>;
                    isStartSortKeyExclusive?: boolean;
                    isEndSortKeyExclusive?: boolean;
                    // Required to specify a limit or the `All` string. So if you intentionally want
                    // everything you have to say so.
                    limit: number | "All";
                    pageLimit?: number;
                    descending?: boolean;
                    consistency?: DynamoCacheReadConsistency;
                },
            ) => {
                // Query the index to get item keys, then fetch full items from the table. This is
                // the "join" operation - the index only stores keys, not full items.
                return await parallelMapAsyncIterableToArray(
                    query(context, options),
                    async itemKey => {
                        return (await this.#table.getItem(context, itemKey, {
                            consistency: options.consistency,
                        })) as any;
                    },
                );
            },

            backfillRealtimeQuery: (context, {partitionKey, checkpoint}) => {
                const partitionKeyString = this.#table._serializeOpaqueIndexPartitionKey(
                    indexConfig,
                    partitionKey,
                );

                return this.#backfillRealtimeQuery(context, {
                    // If our index's partition key is the same as our table's partition key then we
                    // can save some WCUs by writing all updates under the table's partition key (which
                    // is used for `table.realtimeQuery()`).
                    realtimeKey: canReuseTablePartitionKeyForRealtimeKey
                        ? this.#table.serializeOpaqueItemPartitionKey({
                              partitionType: exclusivePartitionType,
                              ...partitionKey,
                          })
                        : `${config.name}:${partitionKeyString}`,
                    checkpoint,
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
                    oldValue = this.#table._deserializeOpaqueIndexPartitionKey(
                        indexConfig,
                        oldPartitionKey,
                    )[attributeName as string];
                }

                if (oldPartitionKey === newPartitionKey) {
                    newValue = oldValue;
                } else if (newPartitionKey !== undefined) {
                    newValue = this.#table._deserializeOpaqueIndexPartitionKey(
                        indexConfig,
                        newPartitionKey,
                    )[attributeName as string];
                }

                return {oldValue: oldValue as any, newValue: newValue as any};
            },
        };
    }

    #getRealtimeEventItem(
        context: ServerActionContext,
        {
            itemKey,
            version,
            eventType,
        }: {
            itemKey: Types["ItemKey"];
            version: number;
            eventType: "PutItem" | "DeleteItem";
        },
    ): Promise<
        | {isDeleted: true; item: {updateLockVersion?: number}}
        | {isDeleted: false; item: Types["Item"]}
    > {
        let hasAlreadyAttempted = false;

        return retryWithExponentialBackoff(async retry => {
            const isInitialAttempt = !hasAlreadyAttempted;
            hasAlreadyAttempted = true;

            // On the first attempt, try reading with eventual consistency since it's cheaper.
            // If we observe eventual consistency lag (item version is behind event version
            // from strong consistency query) then we'll retry with strong consistency.
            const options: {consistency: DynamoReadConsistency} = isInitialAttempt
                ? {consistency: "Eventual"}
                : {consistency: "Strong"};

            // If the event we saw deletes the item then try looking for a gravestone first,
            // then the full item (on our second attempt, the item may have been undeleted).
            const result =
                eventType === "DeleteItem"
                    ? await this.getDeletedItemIfExists(context, itemKey, options).then(
                          async item1 => {
                              if (item1) return {isDeleted: true as const, item: item1};

                              const item2 = await this.getItemIfExists(context, itemKey, options);
                              if (item2) return {isDeleted: false as const, item: item2};

                              return null;
                          },
                      )
                    : await this.getItemIfExists(context, itemKey, options).then(async item1 => {
                          if (item1) return {isDeleted: false as const, item: item1};

                          const item2 = await this.getDeletedItemIfExists(
                              context,
                              itemKey,
                              options,
                          );
                          if (item2) return {isDeleted: true as const, item: item2};

                          return null;
                      });

            // Either an item or an item gravestone must exist. Once an item has been created
            // we'll always keep around at least a gravestone.
            if (result === null) throw retry();

            // If our item's version is less than the version expected by our realtime event
            // we're likely seeing an eventual consistency lag. Try reading again. The next
            // read will use strong consistency.
            if ((result.item.updateLockVersion ?? 0) < version) throw retry();

            return result;
        });
    }

    async #backfillRealtimeQuery(
        context: ServerActionContext,
        {
            realtimeKey,
            checkpoint,
            source,
        }: {
            realtimeKey: string;
            checkpoint: ServerSynchronizationCheckpoint;
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
    ): Promise<RynamoBackfillResult<any>> {
        // `checkpoint` may be for an eventually consistent read. Eventually consistent
        // reads may contain stale data. So here we backfill events that happened a short
        // window before our `checkpoint` in case the read returned stale data.
        //
        // [DynamoDB says][1] reads are usually consistent "within one second or less". So
        // three minutes should be a sufficient window for backfilling realtime events
        // before the checkpoint.
        //
        // [1]:
        //     https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadConsistency.html
        checkpoint = subMinutes(checkpoint, rynamoBackfillSafetyWindowMinutes);

        // We have deleted events before this time to reduce our storage needs. That means
        // we can't backfill reads that ocurred before this time.
        const expiredEventsTime = subDays(new Date(), rynamoPrivatePartitionEventExpirationDays);

        // If our read happened before the expiration time, we may be missing some events
        // that happened between the read and now. The client should fully reload their
        // query in response.
        if (isDatePossiblyLessThanWithUncertaintyWindow(checkpoint, expiredEventsTime))
            return {type: "Unavailable"};

        // We backfill realtime updates to `newCheckpoint` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const newCheckpoint = generateServerSynchronizationCheckpoint();

        // We send only one event per item key in our backfill. The client does not need to
        // see the update history for an item. Only the latest value...
        const backfillItemByKey = new Map<
            DynamoItemKey,
            {
                itemKey: Types["ItemKey"];
                index: RynamoInternalIndex | undefined;
                version: number;
                eventType: "PutItem" | "DeleteItem";
            }
        >();

        for await (const unknownItem of this.#table.query<any, any, any>(context, {
            partitionKey: {
                partitionType: "Realtime",
                realtimeKey,
            },
            startSortKey: {
                sortRangeType: "Events",
                eventTime: checkpoint,
            },
            limit: "All",
            // Use a strong read consistency when backfilling events!
            consistency: "Strong",
        })) {
            const item: RynamoPrivateRealtimePartitionItem = unknownItem as any;

            for (const event of item.events) {
                const itemKey = this.#table.deserializeOpaqueItemKey(event.key);

                const index =
                    source.type === "Index"
                        ? this.#indexByNameByItemType
                              .get(`${itemKey.partitionType}#${itemKey.sortRangeType}`)
                              ?.get(source.name)
                        : undefined;

                // Ignore items that are not a part of our index. This could happen for one of the
                // following reasons:
                //
                // - Our index's realtime key is the same as the table's primary partition key
                // - An update to an item not in the index happened in the same transaction as an
                //   item in the index
                if (source.type === "Index" && !index) {
                    continue;
                }

                const backfillItem = getOrSetDefaultMapValue(backfillItemByKey, event.key, () => ({
                    itemKey,
                    index,
                    version: event.version,
                    eventType: event.type,
                }));

                // Expect the highest version number when backfilling.
                if (event.version > backfillItem.version) {
                    backfillItem.version = event.version;
                    backfillItem.eventType = event.type;
                }
            }
        }

        // Collapse all updates into a single transaction. That way events that were
        // together in a transaction will still be applied atomically and the client
        // doesn't care about non-atomic events being treated as atomic.
        const events = await runAllPromises(
            Array.from(
                backfillItemByKey,
                async ([key, backfillItem]): Promise<RynamoEvent<unknown>> => {
                    const {itemKey} = backfillItem;

                    const result = await this.#getRealtimeEventItem(context, backfillItem);

                    if (result.isDeleted) {
                        const indexes = new Set<string>();

                        const itemType = `${itemKey.partitionType}#${itemKey.sortRangeType}`;
                        for (const [indexName] of this.#indexByNameByItemType.get(itemType) ?? []) {
                            indexes.add(indexName);
                        }

                        return {
                            type: "DeleteItem",
                            item: {
                                key: key,
                                version: result.item.updateLockVersion ?? 0,
                            },
                            indexes,
                        };
                    }
                    // If this item is in a different partition then the one we're backfilling then
                    // send a `DeleteItem` event instead of a `PutItem` event so we don't reveal data
                    // the user doesn't have access to.
                    else if (
                        source.type === "Index"
                            ? backfillItem.index!.serializeOpaquePartitionKey(result.item) !==
                              source.partitionKey
                            : this.#table.serializeOpaqueItemPartitionKey(result.item) !==
                              source.partitionKey
                    ) {
                        const indexes = new Set<string>();

                        const itemType = `${itemKey.partitionType}#${itemKey.sortRangeType}`;
                        for (const [indexName] of this.#indexByNameByItemType.get(itemType) ?? []) {
                            indexes.add(indexName);
                        }

                        return {
                            type: "DeleteItem",
                            item: {
                                key: key,
                                version: result.item.updateLockVersion ?? 0,
                            },
                            indexes,
                        };
                    } else {
                        const indexByName = this.#indexByNameByItemType.get(
                            `${result.item.partitionType}#${result.item.sortRangeType}`,
                        );

                        const indexes = new Map<
                            string,
                            {partitionKey: DynamoIndexPartitionKey; cursor: DynamoIndexCursor}
                        >();

                        if (indexByName) {
                            for (const [indexName, index] of indexByName) {
                                const partitionKey = index.serializeOpaquePartitionKey(result.item);
                                const cursor = index.serializeOpaqueCursor(result.item);
                                indexes.set(indexName, {partitionKey, cursor});
                            }
                        }

                        return {
                            type: "PutItem",
                            item: {
                                key,
                                version: result.item.updateLockVersion ?? 0,
                                model: await this.#buildModel(context, result.item),
                            },
                            indexes,
                        };
                    }
                },
            ),
        );

        return {type: "Available", checkpoint: newCheckpoint, events};
    }

    /**
     * Turn a realtime event stub (`RynamoEventStub`) into a full realtime event
     * (`RynamoEvent`). Gets a version of each item later than the version declared in
     * the stub and builds models for the items which loads any referenced data.
     */
    getRealtimeEvent(
        context: ServerActionContext,
        events: ReadonlyArray<RynamoEventStub & {readonly itemKey?: Types["ItemKey"]}>,
    ): Promise<ReadonlyArray<RynamoEvent<ModelMap[string][string]>>> {
        return runAllPromises(
            events.map(async event => {
                const {key} = event.item;
                const itemKey = event.itemKey ?? this.deserializeOpaqueItemKey(key);

                const result = await this.#getRealtimeEventItem(context, {
                    itemKey,
                    version: event.item.version,
                    eventType: event.type,
                });

                if (result.isDeleted) {
                    const indexes = new Set<string>();

                    const itemType = `${itemKey.partitionType}#${itemKey.sortRangeType}`;
                    for (const [indexName] of this.#indexByNameByItemType.get(itemType) ?? []) {
                        indexes.add(indexName);
                    }

                    return {
                        type: "DeleteItem",
                        item: {
                            key,
                            version: result.item.updateLockVersion ?? 0,
                        },
                        indexes,
                    };
                } else {
                    const indexByName = this.#indexByNameByItemType.get(
                        `${result.item.partitionType}#${result.item.sortRangeType}`,
                    );

                    const indexes = new Map<
                        string,
                        {partitionKey: DynamoIndexPartitionKey; cursor: DynamoIndexCursor}
                    >();

                    if (indexByName) {
                        for (const [indexName, index] of indexByName) {
                            const partitionKey = index.serializeOpaquePartitionKey(result.item);
                            const cursor = index.serializeOpaqueCursor(result.item);
                            indexes.set(indexName, {partitionKey, cursor});
                        }
                    }

                    return {
                        type: "PutItem",
                        item: {
                            key,
                            version: result.item.updateLockVersion ?? 0,
                            model: await this.#buildModel(context, result.item),
                        },
                        indexes,
                    };
                }
            }),
        );
    }
}

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface RynamoTableSchemaIndex<Model, IndexPartitionKey, IndexSortKey> {
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
        context: ServerActionContext,
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
            // Required to specify a limit or the `All` string. So if you intentionally want
            // everything you have to say so.
            limit: number | "All";
            consistency?: DynamoCacheReadConsistency;
        },
    ): Promise<RynamoIndexQueryResult<Model>>;

    /**
     * Query the index. Returns raw items without constructing models or cursors.
     */
    query(
        context: DynamoContext,
        options: {
            partitionKey: IndexPartitionKey;
            startSortKey?: IndexSortKey;
            endSortKey?: IndexSortKey;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            // Required to specify a limit or the `All` string. So if you intentionally want
            // everything you have to say so.
            limit: number | "All";
            pageLimit?: number;
            descending?: boolean;
            consistency?: DynamoCacheReadConsistency;
        },
    ): Promise<Array<MergeObjectIntersection<IndexPartitionKey & IndexSortKey>>>;

    /**
     * Backfill any updates that happened since the query was read and now. Useful when
     * you connect to realtime after dispatching your query.
     */
    backfillRealtimeQuery(
        context: ServerActionContext,
        options: {partitionKey: IndexPartitionKey; checkpoint: ServerSynchronizationCheckpoint},
    ): Promise<RynamoBackfillResult<Model>>;

    /**
     * Get the value of an attribute in our index's partition key from an event that
     * contains a diff of the old and new partition keys for an item.
     *
     * This function is used in `broadcastEvents()` to observe changes to an indexed
     * attribute. `broadcastEvents()` only currently observes changes to indexed
     * attributes.
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

type RynamoTransactionEntryInternal = InstanceType<typeof RynamoTransactionEntryInternal>;
type RynamoTransactionEntryExternal = RynamoTransactionEntry;

/**
 * Wrapper around a `DynamoTransactionEntry` that includes extra information we
 * need for updating a realtime table.
 *
 * Implements the opaque `RynamoTransactionEntry` handle from
 * `~/shared/dynamo/rynamo_types.js` so that consumers (like injection slots in
 * `//server/context`) can hold a reference to a transaction entry without taking a
 * Bazel dependency on this package. The branded `_RynamoTransactionEntry` field is
 * `declare`-only so it has no runtime cost — it exists purely to make the class
 * nominally compatible with the shared handle type.
 */
// The class is named `RynamoTransactionEntry` for `console.log()` debugging
// purposes but it should be referenced in code as
// `RynamoTransactionEntryInternal`.
const RynamoTransactionEntryInternal = class RynamoTransactionEntry implements RynamoTransactionEntryExternal {
    declare readonly _RynamoTransactionEntry: never;

    readonly entry: MaybeNonEmptyReadonlyArray<DynamoTransactionEntry>;
    readonly schema: RynamoTableSchema<any, any>;
    readonly action: RynamoAction<unknown, unknown>;

    constructor({
        entry,
        schema,
        action,
    }: {
        entry: MaybeNonEmptyReadonlyArray<DynamoTransactionEntry>;
        schema: RynamoTableSchema<any, any>;
        action: RynamoAction<unknown, unknown>;
    }) {
        this.entry = entry;
        this.schema = schema;
        this.action = action;
    }
};
