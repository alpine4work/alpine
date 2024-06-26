import {addDays, subDays, subMinutes} from "date-fns";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
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
import {
    DynamoGeneralRealtimeBackfillResult,
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {
    DynamoIndexCursor,
    DynamoItemKey,
    DynamoItemKeySchema,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isDatePossiblyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {DistributiveKeyOf} from "~/shared/helpers/types/distributive_key_of.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries.js";
import {Schema, SchemaWithoutValidation} from "~/shared/schema/schema.js";

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
                context: ServerActionContext,
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

type DynamoGeneralRealtimePrivatePartitionItem = DynamoTableSchemaTypes.Partition.ItemTypes<
    [typeof dynamoGeneralRealtimePrivatePartitionConfig]
>;

type DynamoGeneralRealtimePrivatePartitionEvent =
    DynamoGeneralRealtimePrivatePartitionItem["eventTransaction"][number];

const dynamoGeneralRealtimePrivatePartitionName = "Realtime";

const dynamoGeneralRealtimePrivatePartitionConfig = {
    name: dynamoGeneralRealtimePrivatePartitionName,
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
                    }),
                ),
            }),
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

type DynamoGeneralRealtimeInternalEvent<Item, Model> = {
    readonly type: "PutItem";
    readonly item: Item;
    readonly key: DynamoItemKey;
    readonly version: number;
    readonly getModel: (context: ServerActionContext) => Promise<Model>;
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
// TODO(calebmer): This abstraction currently doesn't implement `deleteItem()`!
// Not because it can't but because the implementation is a little tricky. We
// need a serializable version number for items so that if the client receives
// realtime events out-of-order then it can still process the items locally in
// the correct order. Think about how the client would handle delete and create
// item events that arrive out of order? How would it make sure the latest
// delete or create item event wins to achieve eventual consistency with the
// database?
//
// One solution is whenever you delete an item to create a gravestone with the
// old item's `updateLockVersion + 1` (a delete is an update that should
// increment the version). Then when you create a new item, check if there's a
// gravestone for that key. If there is a gravestone then the new item's
// version should be set to `updateLockVersion + 2` so the new version is past
// the gravestone version. In this design, clients can still use a version to
// order create/delete events.
//
// TODO(calebmer, 2022-04-28): Ok, there's a lot more than `deleteItem()` I'm
// leaving unimplemented for now since I don't have a test case. There are TODO
// comments throughout this class but here's a list in one place:
//
// - `deleteItem()`
// - `realtimeQuery()` (realtime queries on indexes are supported)
// - `addExpensiveFullIndex()` with items in different partitions
// - Certain `DynamoKeyAttributeSchema`s which don't support binary encoding
export class DynamoGeneralRealtimeTableSchema<
    Types extends DynamoTableSchemaTypesBase,
    ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
> {
    private readonly _table: DynamoTableSchema<Types>;
    private readonly _models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
        DynamoTableSchemaTypes.ConfigBase["partitions"]
    >;
    private readonly _sendEventTransactionCallback: (
        context: ServerActionContext,
        readTime: Date,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ModelMap[string][string]>>,
    ) => Promise<void>;
    private readonly _isTableRealtimeQueryDisabled: boolean;

    private readonly _serializeRealtimeKeyByIndexNameByItemType = new Map<
        string,
        Map<string, (item: Types["Item"]) => string>
    >();

    private readonly _serializeOpaqueCursorByIndexNameByItemType = new Map<
        string,
        Map<string, (item: Types["Item"]) => DynamoIndexCursor>
    >();

    public static new<
        const PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
        const ModelsConfig extends DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<PartitionsConfig>,
    >({
        name,
        partitions,
        models,
        modelSchema,
        sendEventTransaction,
        isTableRealtimeQueryDisabled = false,
    }: {
        name: string;
        partitions: PartitionsConfig;

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
        sendEventTransaction: (
            context: ServerActionContext,
            readTime: Date,
            eventTransaction: ReadonlyArray<
                DynamoGeneralRealtimeEvent<DynamoGeneralRealtimeTableSchemaModelType<ModelsConfig>>
            >,
        ) => Promise<void>;

        /**
         * You may disable `table.realtimeQuery()` calls to make the table more
         * efficient since we don't need to store realtime event history by table
         * partitions. We'll only need to store realtime event history by index
         * partitions.
         */
        isTableRealtimeQueryDisabled?: boolean;
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
                    dynamoGeneralRealtimePrivatePartitionConfig,
                ] as any as PartitionsConfig,
            }),
            models,
            sendEventTransaction,
            isTableRealtimeQueryDisabled,
        });
    }

    private constructor({
        table,
        models,
        sendEventTransaction,
        isTableRealtimeQueryDisabled,
    }: {
        table: DynamoTableSchema<Types>;
        models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >;
        sendEventTransaction: (
            context: ServerActionContext,
            readTime: Date,
            eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ModelMap[string][string]>>,
        ) => Promise<void>;
        isTableRealtimeQueryDisabled: boolean;
    }) {
        this._table = table;
        this._models = models;
        this._sendEventTransactionCallback = sendEventTransaction;
        this._isTableRealtimeQueryDisabled = isTableRealtimeQueryDisabled;
    }

    private _buildModel<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
    ): Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]> {
        return this._models[item.partitionType]![item.sortRangeType]!.build(
            context,
            item,
        ) as Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>;
    }

    private _getCursorByIndexName(item: Types["Item"]): Map<string, DynamoIndexCursor> {
        const cursorByIndexName = new Map<string, DynamoIndexCursor>();

        const itemType = `${item.partitionType}#${item.sortRangeType}`;
        for (const [
            indexName,
            serializeOpaqueCursor,
        ] of this._serializeOpaqueCursorByIndexNameByItemType.get(itemType) ?? []) {
            cursorByIndexName.set(indexName, serializeOpaqueCursor(item));
        }

        return cursorByIndexName;
    }

    private _sendEventTransaction(
        context: ServerActionContext,
        readTime: Date,
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeInternalEvent<Types["Item"], ModelMap[string][string]>
        >,
    ): Promise<void> {
        return context.tracer.withSpan("Send general realtime event transaction", async context => {
            const [actualEventTransaction] = await runAllPromises([
                runAllPromises(
                    eventTransaction.map(async event => ({
                        type: event.type,
                        item: {
                            key: event.key,
                            version: event.version,
                            model: await event.getModel(context),
                        },
                        cursorByIndexName: this._getCursorByIndexName(event.item),
                    })),
                ),
                (async () => {
                    const realtimeKeys = new Set<string>();

                    const dynamoEventTransaction = eventTransaction.map(
                        (event): DynamoGeneralRealtimePrivatePartitionEvent => {
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
                            if (!this._isTableRealtimeQueryDisabled) {
                                realtimeKeys.add(
                                    this._table.serializeOpaqueItemPartitionKey(event.item),
                                );
                            }

                            // Add the realtime event transaction to every index partition affected by the
                            // transaction. So if the user queries using an index we'll be able to backfill
                            // realtime updates for the query.
                            const serializeRealtimeKeyByIndexName =
                                this._serializeRealtimeKeyByIndexNameByItemType.get(
                                    `${event.item.partitionType}#${event.item.sortRangeType}`,
                                );
                            if (serializeRealtimeKeyByIndexName) {
                                for (const serializeRealtimeKey of serializeRealtimeKeyByIndexName.values()) {
                                    realtimeKeys.add(serializeRealtimeKey(event.item));
                                }
                            }

                            return {
                                type: "PutItem",
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
                            const item: DynamoGeneralRealtimePrivatePartitionItem = {
                                partitionType: dynamoGeneralRealtimePrivatePartitionName,
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
            await this._sendEventTransactionCallback(context, readTime, actualEventTransaction);
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
        context: ServerActionContext,
        item: Item,
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
        >;
        getCursorByIndexName: () => Map<string, DynamoIndexCursor>;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        await this._table.createItem(context, item);

        const key = this._table.serializeOpaqueItemKey(item);
        const version = item.updateLockVersion ?? 0;
        const modelPromise = this._buildModel(context, item);

        context.process.waitUntil(
            this._sendEventTransaction(context, readTime, [
                {type: "PutItem", item, key, version, getModel: () => modelPromise},
            ]),
        );

        return {
            getRealtimeItem: async () => ({key, version, model: await modelPromise}),
            getCursorByIndexName: () => this._getCursorByIndexName(item),
        };
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
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.createItemIfNoneExists(context, item);
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
    // TODO(calebmer): Does not currently support deleting items but could in the
    // future. See the TODO note on the top of our class for how we might implement
    // item deletion.
    public async updateItem<Key extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key>>,
        {initialItem}: {initialItem?: Types["Item"] & Key} = {},
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>
        >;
        getCursorByIndexName: () => Map<string, DynamoIndexCursor>;
    }> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        const item = await this._table.updateItem(
            context,
            itemKey,
            async item => {
                const newItem = await update(item);
                assert(newItem, "Deleting items is currently unsupported with a realtime schema");
                return newItem;
            },
            {initialItem},
        );
        assert(item, "Deleting items is currently unsupported with a realtime schema");

        const key = this._table.serializeOpaqueItemKey(item);
        const version = item.updateLockVersion ?? 0;
        const modelPromise = this._buildModel(context, item);

        context.process.waitUntil(
            this._sendEventTransaction(context, readTime, [
                {type: "PutItem", item, key, version, getModel: () => modelPromise},
            ]),
        );

        return {
            getRealtimeItem: async () => ({key, version, model: await modelPromise}),
            getCursorByIndexName: () => this._getCursorByIndexName(item),
        };
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
     * If you don't want to write a retry loop yourself, consider using
     * `updateItem()` which does it for you.
     */
    public async directlyUpdateItem<Item extends Types["Item"]>(
        context: ServerActionContext,
        item: Item,
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
        >;
    }> {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        //
        // Consider an update that happens after this write but before clients receive
        // an event for this write. If we measure `readTime` time when the client
        // receives the event and we try backfilling to `readTime` we will miss
        // the write.
        const readTime = new Date();

        await this._table.directlyUpdateItem(context, item);

        const key = this._table.serializeOpaqueItemKey(item);
        // Directly updating increments the item lock version we were provided.
        const version = (item.updateLockVersion ?? 0) + 1;
        const modelPromise = this._buildModel(context, item);

        context.process.waitUntil(
            this._sendEventTransaction(context, readTime, [
                {type: "PutItem", item, key, version, getModel: () => modelPromise},
            ]),
        );

        return {getRealtimeItem: async () => ({key, version, model: await modelPromise})};
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
        context: ServerActionContext,
        entries: ReadonlyArray<DynamoTransactionEntry | DynamoGeneralRealtimeTransactionEntry>,
        options?: {clientRequestToken?: string},
    ): Promise<void> {
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
            entries.map(entry => {
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
                    schema._sendEventTransaction(context, readTime, events),
                ),
            );
        });
    }

    /**
     * Create an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `createItem()` for more information.
     *
     * You execute transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionCreateItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoGeneralRealtimeTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionCreateItem(item),
            this,
            {
                type: "PutItem",
                item,
                key: this._table.serializeOpaqueItemKey(item),
                version: item.updateLockVersion ?? 0,
                getModel: context => this._buildModel(context, item),
            },
        );
    }

    /**
     * Update an item in the database as the part of a transaction. In a
     * transaction either all entries succeed or all entries fail. See the
     * documentation on `directlyUpdateItem()` for more information.
     *
     * You execute transactions with
     * `DynamoGeneralRealtimeTableSchema.executeTransaction()`. Can not be executed
     * with `DynamoTableSchema.executeTransaction()`.
     */
    public transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoGeneralRealtimeTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionDirectlyUpdateItem(item),
            this,
            {
                type: "PutItem",
                item,
                key: this._table.serializeOpaqueItemKey(item),
                // Directly updating increments the item lock version we were provided.
                version: (item.updateLockVersion ?? 0) + 1,
                getModel: context => this._buildModel(context, item),
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
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionCreateOrReplaceItem(item),
            this,
            {
                type: "PutItem",
                item,
                key: this._table.serializeOpaqueItemKey(item),
                version: item.updateLockVersion ?? 0,
                getModel: context => this._buildModel(context, item),
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
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
        Key extends Types["ItemKey"],
        Attribute extends DistributiveKeyOf<Types["Item"]> & string,
    >(
        key: Key,
        attribute: Attribute,
        attributeValue: (Types["Item"] & Key)[Attribute],
        options: {updateLockVersion: number | undefined},
    ): DynamoTransactionEntry {
        assert(
            key.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.transactionDirectlyUpdateItemAttribute(
            key,
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
     * This method is dangerous for realtime tables because we don't currently
     * support the delete operation! To delete from a general realtime table we'd
     * need to leave a gravestone so that a future update for an item of the same
     * key would have a version number greater than the deleted item's. If you want
     * to delete an item from the table anyway while breaking this table's realtime
     * guarantees you may use this method.
     */
    public transactionDangerouslyDeleteItemWithoutEventAndBreakFutureUpdates<
        Item extends Types["Item"],
    >(item: Item): DynamoTransactionEntry {
        assert(
            item.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.transactionDeleteItem(item);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null.
     */
    public getItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.getItemIfExists(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     */
    public getItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
            consistency?: DynamoReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>> | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
            consistency?: DynamoReadConsistency;
        },
    ): Promise<MergeObjectIntersection<Key & Pick<Types["Item"] & Key, Attributes>>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.getPartialItem(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null. Also
     * returns all the auxillary information a client will need to maintain this
     * data in realtime.
     */
    public async getRealtimeItemIfExists<Key extends Types["ItemKey"]>(
        context: ServerActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<
        ModelMap[Key["partitionType"]][Key["sortRangeType"]]
    > | null> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
        context: ServerActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
        assert(
            itemKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
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
        context: ServerActionContext,
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
        assert(
            options.partitionKey.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.query(context, options);
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB
     * collocates related data. Also returns all the auxillary information
     * necessary for a client to keep a query up-to-date in realtime.
     */
    public async realtimeQuery(context: ServerActionContext, options: {}): Promise<never> {
        if (this._isTableRealtimeQueryDisabled) {
            throw new InternalError("Realtime queries have been disabled");
        }

        // TODO(calebmer): Leaving `realtimeQuery()` unimplemented for now since we
        // don't have any callers! We have callers for `realtimeQuery()` on indexes.
        // Once we have a caller of the main `realtimeQuery()` implement this method
        // based on the index version.
        //
        // This is admittedly a little backwards. This method is way more important for
        // this abstraction than `realtimeQuery()` on an index (indexes are expensive!)
        // but without a test case I don't want to write potentially incorrect code.
        throw new UnimplementedError("Implement realtime query method");
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
            if (item.partitionType === dynamoGeneralRealtimePrivatePartitionName) continue;
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
                itemType => itemType.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            ),
            "Can't access private realtime partition",
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
        // and reduce the write capacity units we need when:
        //
        // - The index only serves data from a single partition
        // - The index's partition key matches that partition's partition key
        //
        // This means we can get the partition key from our index partition key plus
        // adding `partitionType: exclusivePartitionType`.
        const canReuseTablePartitionKeyForRealtimeKey =
            exclusivePartitionType &&
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

        const serializeRealtimeKey = (
            partitionKey: {
                // Needed if we're reusing the table's partition key.
                partitionType: ItemTypes["partitionType"];
            } & DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        ) => {
            return canReuseTablePartitionKeyForRealtimeKey
                ? // If our index's partition key is the same as our table's partition key then
                  // we can save some WCUs by writing all updates under the table's partition key
                  // (which is used for `table.realtimeQuery()`).
                  this._table.serializeOpaqueItemPartitionKey(partitionKey)
                : // Index names are guaranteed to be unique so we can use them to prefix our
                  // realtime key.
                  `${config.name}:${Index.serializeOpaqueItemPartitionKey(partitionKey)}`;
        };

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const serializeRealtimeKeyByIndexName = getOrSetDefaultMapValue(
                this._serializeRealtimeKeyByIndexNameByItemType,
                itemType,
                () => new Map(),
            );

            const serializeOpaqueCursorByIndexName = getOrSetDefaultMapValue(
                this._serializeOpaqueCursorByIndexNameByItemType,
                itemType,
                () => new Map(),
            );

            assert(!serializeRealtimeKeyByIndexName.has(config.name));
            serializeRealtimeKeyByIndexName.set(
                config.name,
                serializeRealtimeKey as (item: Types["Item"]) => string,
            );

            assert(!serializeOpaqueCursorByIndexName.has(config.name));
            serializeOpaqueCursorByIndexName.set(config.name, Index.serializeOpaqueCursor);
        }

        return {
            partitionKeyAttributes: Index.partitionKeyAttributes,
            sortKeyAttributes: Index.sortKeyAttributes,

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

                // If we are not in a development or test environment, verify that cursors
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
                return this._backfillRealtimeQuery(context, {
                    indexName: config.name,
                    realtimeKey: serializeRealtimeKey({
                        partitionType: exclusivePartitionType,
                        ...partitionKey,
                    }),
                    readTime,
                });
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
                itemType => itemType.partitionType !== dynamoGeneralRealtimePrivatePartitionName,
            ),
            "Can't access private realtime partition",
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
        const canReuseTablePartitionKeyForRealtimeKey =
            exclusivePartitionType &&
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

        const serializeRealtimeKey = (
            partitionKey: {
                // Needed if we're reusing the table's partition key.
                partitionType: ItemTypes["partitionType"];
            } & DynamoTableSchemaIndexKeyAttributesType<PartitionKeyAttributesConfig>,
        ) => {
            return canReuseTablePartitionKeyForRealtimeKey
                ? // If our index's partition key is the same as our table's partition key then
                  // we can save some WCUs by writing all updates under the table's partition key
                  // (which is used for `table.realtimeQuery()`).
                  this._table.serializeOpaqueItemPartitionKey(partitionKey)
                : // Index names are guaranteed to be unique so we can use them to prefix our
                  // realtime key.
                  `${config.name}:${Index.serializeOpaqueItemPartitionKey(partitionKey)}`;
        };

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;

            const serializeRealtimeKeyByIndexName = getOrSetDefaultMapValue(
                this._serializeRealtimeKeyByIndexNameByItemType,
                itemType,
                () => new Map(),
            );

            const serializeOpaqueCursorByIndexName = getOrSetDefaultMapValue(
                this._serializeOpaqueCursorByIndexNameByItemType,
                itemType,
                () => new Map(),
            );

            assert(!serializeRealtimeKeyByIndexName.has(config.name));
            serializeRealtimeKeyByIndexName.set(
                config.name,
                serializeRealtimeKey as (item: Types["Item"]) => string,
            );

            assert(!serializeOpaqueCursorByIndexName.has(config.name));
            serializeOpaqueCursorByIndexName.set(
                config.name,
                Index.serializeOpaqueCursor as (item: Types["Item"]) => DynamoIndexCursor,
            );
        }

        return {
            partitionKeyAttributes: Index.partitionKeyAttributes,
            sortKeyAttributes: Index.sortKeyAttributes,

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

                // If we are not in a development or test environment, verify that cursors
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
                return this._backfillRealtimeQuery(context, {
                    indexName: config.name,
                    realtimeKey: serializeRealtimeKey({
                        partitionType: exclusivePartitionType,
                        ...partitionKey,
                    }),
                    readTime,
                });
            },
        };
    }

    private async _backfillRealtimeQuery(
        context: ServerActionContext,
        {
            indexName,
            realtimeKey,
            readTime,
        }: {
            indexName: string;
            realtimeKey: string;
            readTime: Date;
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
            {version: number; itemPromise: Promise<Types["Item"]>}
        >();

        for await (const _item of this._table.query<any, any, any>(context, {
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
            const item: DynamoGeneralRealtimePrivatePartitionItem = _item as any;

            for (const event of item.eventTransaction) {
                const itemKey = this._table.deserializeOpaqueItemKey(event.key);

                // Ignore items that are not a part of our index. This could happen for one of
                // the following reasons:
                //
                // - Our index's realtime key is the same as the table's primary partition key
                // - An update to an item not in the index happened in the same transaction as
                //   an item in the index
                if (
                    !this._serializeOpaqueCursorByIndexNameByItemType
                        .get(`${itemKey.partitionType}#${itemKey.sortRangeType}`)
                        ?.has(indexName)
                ) {
                    continue;
                }

                const backfillItem = getOrSetDefaultMapValue(backfillItemByKey, event.key, () => ({
                    version: event.version,
                    itemPromise: this.getItem(context, itemKey, {
                        // We can use an eventual read consistency here since we have a strongly
                        // consistent read of the version number. If the read item is stale and does
                        // not match the version number we will retry the read.
                        consistency: "Eventual",
                    }),
                }));

                // Expect the highest version number when backfilling.
                backfillItem.version = Math.max(backfillItem.version, event.version);
            }
        }

        // Collapse all updates into a single transaction. That way events that were
        // together in a transaction will still be applied atomically and the client
        // doesn't care about non-atomic events being treated as atomic.
        const eventTransaction = await runAllPromises(
            Array.from(backfillItemByKey, ([key, backfillItem]) => {
                let hasAlreadyAttempted = false;

                return retryWithExponentialBackoff(
                    async (retry): Promise<DynamoGeneralRealtimeEvent<unknown>> => {
                        const isInitialAttempt = !hasAlreadyAttempted;
                        hasAlreadyAttempted = true;

                        const item: Types["Item"] = isInitialAttempt
                            ? await backfillItem.itemPromise
                            : await this.getItem(
                                  context,
                                  this._table.deserializeOpaqueItemKey(key),
                                  {
                                      // We use an eventual read consistency here since we have a strongly consistent
                                      // read of the version number. If this item read does not match our version
                                      // number we will retry until it does.
                                      consistency: "Eventual",
                                  },
                              );

                        const version = item.updateLockVersion ?? 0;

                        // We read a stale item! We use an eventual consistent read for `itemPromise`.
                        // Try again until we get a version that matches our strong backfill read...
                        if (version < backfillItem.version) retry();

                        return {
                            type: "PutItem",
                            item: {
                                key,
                                version,
                                model: await this._buildModel(context, item),
                            },
                            cursorByIndexName: this._getCursorByIndexName(item),
                        };
                    },
                );
            }),
        );

        return {type: "Available", readTime: newReadTime, eventTransaction};
    }
}

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface DynamoGeneralRealtimeTableSchemaIndex<Model, IndexPartitionKey, IndexSortKey> {
    readonly partitionKeyAttributes: {
        readonly [Key in keyof IndexPartitionKey]: DynamoKeyAttributeSchema<IndexPartitionKey[Key]>;
    };

    readonly sortKeyAttributes: {
        readonly [Key in keyof IndexSortKey]: DynamoKeyAttributeSchema<IndexSortKey[Key]>;
    };

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
        context: ServerActionContext,
        options: {partitionKey: IndexPartitionKey; readTime: Date},
    ): Promise<DynamoGeneralRealtimeBackfillResult<Model>>;
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
    private readonly _entry: DynamoTransactionEntry;
    private readonly _schema: DynamoGeneralRealtimeTableSchema<any, any>;
    private readonly _event: DynamoGeneralRealtimeInternalEvent<unknown, unknown>;

    private constructor(
        entry: DynamoTransactionEntry,
        schema: DynamoGeneralRealtimeTableSchema<any, any>,
        event: DynamoGeneralRealtimeInternalEvent<unknown, unknown>,
    ) {
        this._entry = entry;
        this._schema = schema;
        this._event = event;
    }

    public static _new(
        symbol: typeof privateSymbol,
        entry: DynamoTransactionEntry,
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
