import {addDays} from "date-fns";
import {ActionContext} from "~/server/dynamo/context/action_context";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {DynamoCondition} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {
    DynamoTableSchema,
    DynamoTableSchemaIndexConfig,
    DynamoTableSchemaIndexKeyAttributesConfigBase,
    DynamoTableSchemaIndexKeyAttributesType,
    DynamoTableSchemaTypesBase,
} from "~/server/dynamo/internal/dynamo_table_schema";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo_table_schema_types";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeIndexQuery,
    DynamoGeneralRealtimeItem,
    DynamoGeneralRealtimeQuery,
    createDynamoGeneralRealtimeEventSchema,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings";
import {UnimplementedError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries";
import {Schema, SchemaWithoutValidation} from "~/shared/schema/schema";

export type DynamoGeneralRealtimeTableSchemaGetTypes<
    Schema extends DynamoGeneralRealtimeTableSchema<any, any>,
> = Schema extends DynamoGeneralRealtimeTableSchema<infer Types, any> ? Types : never;

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
                context: ActionContext,
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

const privateRealtimePartitionName = "Realtime" as const;

function createPrivateRealtimePartitionConfig(modelSchema: Schema<any>) {
    return {
        name: privateRealtimePartitionName,
        partitionKeyAttributes: {
            realtimeKey: DynamoKeyAttributeSchema.labelString,
        },
        sortRanges: [
            {
                name: "EventTransactions",
                sortKeyAttributes: {
                    eventTime: DynamoKeyAttributeSchema.date,
                },
                withExpirationTime: "Required",
                attributes: Schema.object({
                    events: Schema.array(createDynamoGeneralRealtimeEventSchema(modelSchema)),
                }),
            },
        ],
    } as const satisfies DynamoTableSchemaTypes.Partition.ConfigBase;
}

type DynamoGeneralRealtimeInternalEvent<Item, Model> =
    | {
          readonly type: "CreateItem";
          readonly item: Item;
          readonly getRealtimeItem: (
              context: ActionContext,
          ) => Promise<DynamoGeneralRealtimeItem<Model>>;
      }
    | {
          readonly type: "UpdateItem";
          readonly item: Item;
          readonly getRealtimeItem: (
              context: ActionContext,
          ) => Promise<DynamoGeneralRealtimeItem<Model>>;
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
export class DynamoGeneralRealtimeTableSchema<
    Types extends DynamoTableSchemaTypesBase,
    ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
> {
    private readonly _table: DynamoTableSchema<Types>;
    private readonly _models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
        DynamoTableSchemaTypes.ConfigBase["partitions"]
    >;
    private readonly _sendEventTransactionCallback: (
        context: ActionContext,
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ModelMap[string][string]>>,
    ) => Promise<void>;

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
            context: ActionContext,
            eventTransaction: ReadonlyArray<
                DynamoGeneralRealtimeEvent<DynamoGeneralRealtimeTableSchemaModelType<ModelsConfig>>
            >,
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
                    createPrivateRealtimePartitionConfig(modelSchema),
                ] as any as PartitionsConfig,
            }),
            models,
            sendEventTransaction,
        });
    }

    private constructor({
        table,
        models,
        sendEventTransaction,
    }: {
        table: DynamoTableSchema<Types>;
        models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >;
        sendEventTransaction: (
            context: ActionContext,
            eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<ModelMap[string][string]>>,
        ) => Promise<void>;
    }) {
        this._table = table;
        this._models = models;
        this._sendEventTransactionCallback = sendEventTransaction;
    }

    private _buildModel<Item extends Types["Item"]>(
        context: ActionContext,
        item: Item,
    ): Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]> {
        return this._models[item.partitionType]![item.sortRangeType]!.build(
            context,
            item,
        ) as Promise<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>;
    }

    private async _sendEventTransaction(
        context: ActionContext,
        eventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeInternalEvent<Types["Item"], ModelMap[string][string]>
        >,
    ): Promise<void> {
        const realtimeKeys = new Set<string>();

        const actualEventTransaction: ReadonlyArray<
            DynamoGeneralRealtimeEvent<ModelMap[string][string]>
        > = await runAllPromises(
            eventTransaction.map(async event => {
                // Add the realtime event transaction to every partition affected by the
                // transaction. That way we can search to find the transaction later using any
                // partition key implicated in the transaction.
                //
                // We use an opaque partition key to avoid conflicting characters in this
                // realtime item's partition key.
                realtimeKeys.add(this._table.serializeOpaqueItemPartitionKey(event.item));

                const cursorByIndexName = new Map<string, DynamoIndexCursor>();

                const itemType = `${event.item.partitionType}#${event.item.sortRangeType}`;
                for (const [
                    indexName,
                    serializeOpaqueCursor,
                ] of this._serializeOpaqueCursorByIndexNameByItemType.get(itemType) ?? []) {
                    cursorByIndexName.set(indexName, serializeOpaqueCursor(event.item));
                }

                return {
                    type: event.type,
                    item: await event.getRealtimeItem(context),
                    cursorByIndexName,
                };
            }),
        );

        const eventTime = new Date();

        // Expire events after a week. If we are trying to backfill data from longer
        // ago then we'll need a full refresh.
        const expirationTime = addDays(eventTime, 7);

        await runAllPromises([
            this._sendEventTransactionCallback(context, actualEventTransaction),

            // Add the event transaction to every affected partition key. When backfilling,
            // we only query events from partitions we care about. If a transaction
            // affected two partitions then it needs to be present in both to show up in a
            // backfill query.
            ...mapIterable(realtimeKeys, realtimeKey =>
                this._table.createOrReplaceItem(context, {
                    partitionType: privateRealtimePartitionName,
                    sortRangeType: "EventTransactions",
                    realtimeKey,
                    eventTime,
                    expirationTime,
                    events: actualEventTransaction,
                }),
            ),
        ]);
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
        context: ActionContext,
        item: Item,
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
        >;
    }> {
        assert(
            item.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        const readTime = new Date();

        await this._table.createItem(context, item);

        const realtimeItemPromise = (async () => ({
            readTime,
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        }))();

        context.process.waitUntil(
            this._sendEventTransaction(context, [
                {type: "CreateItem", item, getRealtimeItem: () => realtimeItemPromise},
            ]),
        );

        return {getRealtimeItem: () => realtimeItemPromise};
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
        context: ActionContext,
        itemKey: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key>>,
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>
        >;
    }> {
        assert(
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        const readTime = new Date();

        const item = await this._table.updateItem(context, itemKey, async item => {
            const newItem = await update(item);
            assert(newItem, "Deleting items is currently unsupported with a realtime schema");
            return newItem;
        });
        assert(item, "Deleting items is currently unsupported with a realtime schema");

        const realtimeItemPromise = (async () => ({
            readTime,
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        }))();

        context.process.waitUntil(
            this._sendEventTransaction(context, [
                {type: "UpdateItem", item, getRealtimeItem: () => realtimeItemPromise},
            ]),
        );

        return {getRealtimeItem: () => realtimeItemPromise};
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
        context: ActionContext,
        item: Item,
    ): Promise<{
        getRealtimeItem: () => Promise<
            DynamoGeneralRealtimeItem<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
        >;
    }> {
        assert(
            item.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        const readTime = new Date();

        await this._table.directlyUpdateItem(context, item);

        const realtimeItemPromise = (async () => ({
            readTime,
            key: this._table.serializeOpaqueItemKey(item),
            // Directly updating increments the item lock version we were provided.
            version: (item.updateLockVersion ?? 0) + 1,
            model: await this._buildModel(context, item),
        }))();

        context.process.waitUntil(
            this._sendEventTransaction(context, [
                {type: "UpdateItem", item, getRealtimeItem: () => realtimeItemPromise},
            ]),
        );

        return {getRealtimeItem: () => realtimeItemPromise};
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
        context: ActionContext,
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
                    schema._sendEventTransaction(context, events),
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
            item.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        const readTime = new Date();

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionCreateItem(item),
            this,
            {
                type: "CreateItem",
                item,
                getRealtimeItem: async context => ({
                    readTime,
                    key: this._table.serializeOpaqueItemKey(item),
                    version: item.updateLockVersion ?? 0,
                    model: await this._buildModel(context, item),
                }),
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
            item.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is written from the database to avoid missing realtime updates.
        const readTime = new Date();

        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionDirectlyUpdateItem(item),
            this,
            {
                type: "UpdateItem",
                item,
                getRealtimeItem: async context => ({
                    readTime,
                    key: this._table.serializeOpaqueItemKey(item),
                    // Directly updating increments the item lock version we were provided.
                    version: (item.updateLockVersion ?? 0) + 1,
                    model: await this._buildModel(context, item),
                }),
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
            itemKey.partitionType !== privateRealtimePartitionName,
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
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.transactionDoesNotExistConditionCheck(itemKey);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null.
     */
    public getItemIfExists<Key extends Types["ItemKey"]>(
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        assert(
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.getItemIfExists(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     */
    public getItem<Key extends Types["ItemKey"]>(
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        assert(
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        return this._table.getItem(context, itemKey, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null. Also
     * returns all the auxillary information a client will need to maintain this
     * data in realtime.
     */
    public async getRealtimeItemIfExists<Key extends Types["ItemKey"]>(
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<
        ModelMap[Key["partitionType"]][Key["sortRangeType"]]
    > | null> {
        assert(
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const item = await this._table.getItemIfExists(context, itemKey, options);
        if (!item) return null;

        return {
            readTime,
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
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoGeneralRealtimeItem<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
        assert(
            itemKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const item = await this._table.getItem(context, itemKey, options);

        return {
            readTime,
            key: this._table.serializeOpaqueItemKey(item),
            version: item.updateLockVersion ?? 0,
            model: await this._buildModel(context, item),
        };
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
        context: ActionContext,
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
    ): Promise<
        DynamoGeneralRealtimeQuery<
            ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
        >
    > {
        assert(
            partitionKey.partitionType !== privateRealtimePartitionName,
            "Can't access private realtime partition",
        );

        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const items = await parallelMapAsyncIterableToArray(
            this._table.query(context, {
                partitionKey,
                startSortKey,
                endSortKey,
                isStartSortKeyExclusive,
                isEndSortKeyExclusive,
                // Fetch one extra item so we can accurately say whether there are more items
                // at the beginning or end of the query.
                limit: typeof limit === "number" ? limit + 1 : limit,
                descending,
                consistency,
            }),
            async (item, index) => {
                // Don't build the model for an over-fetched item we use to determine if there
                // are more items in the query.
                if (typeof limit === "number" && index >= limit) return null;

                return {
                    key: this._table.serializeOpaqueItemKey(item),
                    version: item.updateLockVersion ?? 0,
                    model: await this._buildModel(context, item),
                };
            },
        );

        const hasMoreItems = typeof limit === "number" && items.length > limit;

        // Remove any items we over-fetched to determine if there were items after the
        // limit. (Should just be one.)
        while (typeof limit === "number" && items.length > limit) {
            items.pop();
        }

        return {
            readTime,
            // We should have removed all null items past our limit above.
            items: items as ReadonlyArray<NonNullable<(typeof items)[number]>>,
            hasMoreItems,
        };
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
            DynamoTableSchemaIndexConfig<
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
                itemType => itemType.partitionType !== privateRealtimePartitionName,
            ),
            "Can't access private realtime partition",
        );

        const Index = this._table.addExpensiveFullIndex({
            ...config,
            // For realtime tables, always include the primary key in the index sort key so
            // that index keys are unique and we can correctly sort items in user-land.
            includePrimaryKeyInSortKey: true,
        });

        const canReusePrimaryPartitionKeyForPrivateRealtimePartitionKey =
            new Set(config.itemTypes.map(itemType => itemType.partitionType)).size === 1;

        // NOTE(calebmer, 2023-04-24): This is a temporary limitation. It shouldn't be
        // hard to remove this limitation but we don't have any test cases for it so I
        // don't want to write untested code. We should implement support for
        // cross-partition indexes when it comes up.
        //
        // The reason we have this limitation is that currently we save realtime events
        // to the database using the same partition key as the affected items in the
        // event transaction. This way when we look for realtime updates to a
        // `getModel()` or `query()` call we only need to search realtime events with a
        // matching partition key.
        //
        // If we want to find realtime events for an index `query()` call then we need
        // to search the database for events related to the index's partition key. So
        // in addition to inserting realtime event transactions with the primary
        // partition key of all affected items we also need to insert realtime event
        // transactions with the index partition key of all affected indexes. If the
        // index partition key happens to be the same as a partition primary key of
        // some partition in the underlying table, then great! We don't need to double
        // our realtime event storage for the index. This optimization is the only case
        // we've implemented right now. To remove this limitation we need to implement
        // writing realtime events to the database with the index's partition key when
        // the index partition key differs from a primary partition key in the table.
        if (!canReusePrimaryPartitionKeyForPrivateRealtimePartitionKey) {
            throw new UnimplementedError(
                "Indexes that span across multiple partitions have not yet been implemented for DynamoDB realtime tables",
            );
        }

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;
            const serializeOpaqueCursorByIndexName = getOrSetDefaultMapValue(
                this._serializeOpaqueCursorByIndexNameByItemType,
                itemType,
                () => new Map(),
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
                    afterCursor,
                    limit,
                    descending,
                },
            ): Promise<
                DynamoGeneralRealtimeIndexQuery<
                    ModelMap[ItemTypes["partitionType"]][ItemTypes["sortRangeType"]]
                >
            > => {
                // We backfill realtime updates to `readTime` so it should be before the data
                // is read from the database to avoid missing realtime updates.
                const readTime = new Date();

                const items = await parallelMapAsyncIterableToArray(
                    Index.query(context, {
                        partitionKey,
                        startSortKey,
                        endSortKey,
                        isStartSortKeyExclusive,
                        isEndSortKeyExclusive,
                        afterItemKey:
                            typeof afterCursor === "string"
                                ? Index.deserializeOpaqueCursor(partitionKey, afterCursor)
                                : undefined,
                        // Fetch one extra item so we can accurately say whether there are more items
                        // at the beginning or end of the query.
                        limit: typeof limit === "number" ? limit + 1 : limit,
                        descending,
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

                const hasMoreItems = typeof limit === "number" && items.length > limit;

                // Remove any items we over-fetched to determine if there were items after the
                // limit. (Should just be one.)
                while (typeof limit === "number" && items.length > limit) {
                    items.pop();
                }

                return {
                    readTime,
                    indexName: config.name,
                    // We should have removed all null items past our limit above.
                    items: items as ReadonlyArray<NonNullable<(typeof items)[number]>>,
                    hasMoreItems,
                };
            },
        };
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
        context: ActionContext,
        options: {
            partitionKey: IndexPartitionKey;
            startSortKey?: IndexSortKey;
            endSortKey?: IndexSortKey;
            isStartSortKeyExclusive?: boolean;
            isEndSortKeyExclusive?: boolean;
            /**
             * Our query will return all values after this cursor. Behaves the same as
             * `startSortKey` but is more precise since an index can contain multiple items
             * with the same sort key.
             */
            afterCursor?: DynamoIndexCursor;
            // Required to specify a limit or the `All` string. So if you intentionally
            // want everything you have to say so.
            limit: number | "All";
            descending?: boolean;
        },
    ): Promise<DynamoGeneralRealtimeIndexQuery<Model>>;
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
