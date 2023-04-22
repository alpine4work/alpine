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
    DynamoGeneralRealtimeIndexQueryResult,
    DynamoGeneralRealtimeItemResult,
    DynamoGeneralRealtimeQueryResult,
} from "~/shared/dynamo/dynamo_general_realtime_types";
import {DynamoIndexCursor} from "~/shared/dynamo/dynamo_opaque_strings";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries";

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

    private readonly _serializeOpaqueCursorByIndexNameByItemType = new Map<
        string,
        Map<string, (item: Types["Item"]) => DynamoIndexCursor>
    >();

    public static new<
        const PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
        const ModelsConfig extends DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<PartitionsConfig>,
    >(config: {
        name: string;
        partitions: PartitionsConfig;
        models: ModelsConfig;
    }): DynamoGeneralRealtimeTableSchema<
        DynamoTableSchemaTypes.Types<{name: string; partitions: PartitionsConfig}>,
        DynamoGeneralRealtimeTableSchemaModelMapType<ModelsConfig>
    > {
        return new DynamoGeneralRealtimeTableSchema(DynamoTableSchema.new(config), config.models);
    }

    private constructor(
        table: DynamoTableSchema<Types>,
        models: DynamoGeneralRealtimeTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >,
    ) {
        this._table = table;
        this._models = models;
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

    private _getCursorByIndexName(item: Types["Item"]): ReadonlyMap<string, DynamoIndexCursor> {
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

    private async _broadcastEventTransaction<Model>(
        context: ActionContext,
        event: ReadonlyArray<DynamoGeneralRealtimeEvent<Model>>,
    ): Promise<void> {
        // NOCOMMIT: Implement!
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
    ): Promise<
        DynamoGeneralRealtimeItemResult<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
    > {
        // We backfill realtime updates to `readTime` so it should be before the data
        // is saved to the database to avoid missing realtime updates.
        const readTime = new Date();

        await this._table.createItem(context, item);

        const key = this._table.serializeOpaqueItemKey(item);
        const model = await this._buildModel(context, item);
        const version = item.updateLockVersion ?? 0;

        await this._broadcastEventTransaction(context, [
            {
                type: "CreateItem",
                key,
                version,
                model,
                cursorByIndexName: this._getCursorByIndexName(item),
            },
        ]);

        return {
            readTime,
            key,
            version,
            model,
        };
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
    ): Promise<
        DynamoGeneralRealtimeItemResult<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>
    > {
        // We backfill realtime updates to `readTime` so it should be before the data
        // is saved to the database to avoid missing realtime updates.
        const readTime = new Date();

        const newItem = await this._table.updateItem(context, itemKey, async item => {
            const newItem = await update(item);
            assert(newItem, "Deleting items is currently unsupported with a realtime schema");
            return newItem;
        });
        assert(newItem, "Deleting items is currently unsupported with a realtime schema");

        const key = this._table.serializeOpaqueItemKey(itemKey);
        const version: number = newItem.updateLockVersion ?? 0;
        const model = await this._buildModel(context, newItem);

        await this._broadcastEventTransaction(context, [
            {
                type: "UpdateItem",
                key,
                version,
                model,
                cursorByIndexName: this._getCursorByIndexName(newItem),
            },
        ]);

        return {
            readTime,
            version,
            key,
            model,
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
        context: ActionContext,
        item: Item,
    ): Promise<
        DynamoGeneralRealtimeItemResult<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>
    > {
        // We backfill realtime updates to `readTime` so it should be before the data
        // is saved to the database to avoid missing realtime updates.
        const readTime = new Date();

        await this._table.directlyUpdateItem(context, item);

        const key = this._table.serializeOpaqueItemKey(item);
        const version: number = item.updateLockVersion ?? 0;
        const model = await this._buildModel(context, item);

        await this._broadcastEventTransaction(context, [
            {
                type: "UpdateItem",
                key,
                version,
                model,
                cursorByIndexName: this._getCursorByIndexName(item),
            },
        ]);

        return {
            readTime,
            version,
            key,
            model,
        };
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
        const getEvents: Array<
            (context: ActionContext) => Promise<{
                schema: DynamoGeneralRealtimeTableSchema<any, any>;
                event: DynamoGeneralRealtimeEvent<unknown>;
            }>
        > = [];

        await DynamoTableSchema.executeTransaction(
            context,
            entries.map(entry => {
                if (entry instanceof DynamoTransactionEntry) return entry;
                const {entry: actualEntry, getEvent} = entry._get(privateSymbol);
                getEvents.push(getEvent);
                return actualEntry;
            }),
            options,
        );

        const eventsBySchema = new Map<
            DynamoGeneralRealtimeTableSchema<
                DynamoTableSchemaTypesBase,
                {[partitionType: string]: {[sortRangeType: string]: any}}
            >,
            Array<DynamoGeneralRealtimeEvent<unknown>>
        >();

        await runAllPromises(
            getEvents.map(async getEvent => {
                const {schema, event} = await getEvent(context);
                getOrSetDefaultMapValue(eventsBySchema, schema, () => []).push(event);
            }),
        );

        await runAllPromises(
            mapIterable(eventsBySchema, async ([schema, events]) => {
                await schema._broadcastEventTransaction(context, events);
            }),
        );
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
        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionCreateItem(item),
            async context => {
                const key = this._table.serializeOpaqueItemKey(item);
                const version: number = item.updateLockVersion ?? 0;
                const model = await this._buildModel(context, item);

                return {
                    schema: this,
                    event: {
                        type: "CreateItem",
                        key,
                        version,
                        model,
                        cursorByIndexName: this._getCursorByIndexName(item),
                    },
                };
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
        return DynamoGeneralRealtimeTransactionEntry._new(
            privateSymbol,
            this._table.transactionDirectlyUpdateItem(item),
            async context => {
                const key = this._table.serializeOpaqueItemKey(item);
                const version: number = item.updateLockVersion ?? 0;
                const model = await this._buildModel(context, item);

                return {
                    schema: this,
                    event: {
                        type: "UpdateItem",
                        key,
                        version,
                        model,
                        cursorByIndexName: this._getCursorByIndexName(item),
                    },
                };
            },
        );
    }

    /**
     * Checks whether an item exists and optionally some other conditions on
     * the item. If this condition fails then the entire transaction fails.
     */
    public transactionConditionCheck<Key extends Types["ItemKey"]>(
        key: Key,
        condition?: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        return this._table.transactionConditionCheck(key, condition);
    }

    /**
     * Checks that an item does not exist as a part of a transaction. If this
     * condition fails then the entire transaction fails.
     */
    public transactionDoesNotExistConditionCheck<Key extends Types["ItemKey"]>(
        key: Key,
    ): DynamoTransactionEntry {
        return this._table.transactionDoesNotExistConditionCheck(key);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null.
     */
    public getItemIfExists<Key extends Types["ItemKey"]>(
        context: ActionContext,
        key: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        return this._table.getItemIfExists(context, key, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     */
    public getItem<Key extends Types["ItemKey"]>(
        context: ActionContext,
        key: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        return this._table.getItem(context, key, options);
    }

    /**
     * Get an item from the database and if it doesn't exist then return null. Also
     * returns all the auxillary information a client will need to maintain this
     * data in realtime.
     */
    public async getModelIfExists<Key extends Types["ItemKey"]>(
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoGeneralRealtimeItemResult<
        ModelMap[Key["partitionType"]][Key["sortRangeType"]]
    > | null> {
        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const item = await this._table.getItemIfExists(context, itemKey, options);
        if (!item) return null;

        const key = this._table.serializeOpaqueItemKey(item);
        const version: number = item.updateLockVersion ?? 0;
        const model = await this._buildModel(context, item);

        return {
            readTime,
            key,
            version,
            model,
        };
    }

    /**
     * Get an item from the database and if it doesn't exist then throw an error.
     * Also returns all the auxillary information a client will need to maintain
     * this data in realtime.
     */
    public async getModel<Key extends Types["ItemKey"]>(
        context: ActionContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<
        DynamoGeneralRealtimeItemResult<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>
    > {
        // We backfill realtime updates to `readTime` so it should be before the data
        // is read from the database to avoid missing realtime updates.
        const readTime = new Date();

        const item = await this._table.getItem(context, itemKey, options);

        const key = this._table.serializeOpaqueItemKey(item);
        const version: number = item.updateLockVersion ?? 0;
        const model = await this._buildModel(context, item);

        return {
            readTime,
            key,
            version,
            model,
        };
    }

    /**
     * Query a range of items from the table. Highly efficient as DynamoDB
     * collocates related data. Also returns all the auxillary information
     * necessary for a client to keep a query up-to-date in realtime.
     */
    public async query<
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
        DynamoGeneralRealtimeQueryResult<
            ModelMap[PartitionKey["partitionType"]][Types["QueryKeyMap"][PartitionKey["partitionType"]][StartSortKey["sortRangeType"]][EndSortKey["sortRangeType"]]]
        >
    > {
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

                const key = this._table.serializeOpaqueItemKey(item);
                const version: number = item.updateLockVersion ?? 0;
                const model = await this._buildModel(context, item);

                return {
                    key,
                    version,
                    model,
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
        const Index = this._table.addExpensiveFullIndex({
            ...config,
            // For realtime tables, always include the primary key in the index sort key so
            // that index keys are unique and we can correctly sort items in user-land.
            includePrimaryKeyInSortKey: true,
        });

        for (const {partitionType, sortRangeType} of config.itemTypes) {
            const itemType = `${partitionType}#${sortRangeType}`;
            const serializeOpaqueCursorByIndexName = getOrSetDefaultMapValue(
                this._serializeOpaqueCursorByIndexNameByItemType,
                itemType,
                () => new Map(),
            );
            assert(!serializeOpaqueCursorByIndexName.has(config.name));
            serializeOpaqueCursorByIndexName.set(config.name, item =>
                Index.serializeOpaqueCursor(item),
            );
        }

        return {
            partitionKeyAttributes: Index.partitionKeyAttributes,
            sortKeyAttributes: Index.sortKeyAttributes,

            query: async (
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
                DynamoGeneralRealtimeIndexQueryResult<
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
                                ? Index.deserializeOpaqueCursor(afterCursor)
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

                        const key = this._table.serializeOpaqueItemKey(item);
                        const version: number = item.updateLockVersion ?? 0;
                        const model = await this._buildModel(context, item);

                        return {
                            cursor: Index.serializeOpaqueCursor(item),
                            key,
                            version,
                            model,
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
    query(
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
    ): Promise<DynamoGeneralRealtimeIndexQueryResult<Model>>;
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
    private readonly _getEvent: (context: ActionContext) => Promise<{
        schema: DynamoGeneralRealtimeTableSchema<any, any>;
        event: DynamoGeneralRealtimeEvent<unknown>;
    }>;

    private constructor(
        entry: DynamoTransactionEntry,
        getEvent: (context: ActionContext) => Promise<{
            schema: DynamoGeneralRealtimeTableSchema<any, any>;
            event: DynamoGeneralRealtimeEvent<unknown>;
        }>,
    ) {
        this._entry = entry;
        this._getEvent = getEvent;
    }

    public static _new(
        symbol: typeof privateSymbol,
        entry: DynamoTransactionEntry,
        getEvent: (context: ActionContext) => Promise<{
            schema: DynamoGeneralRealtimeTableSchema<any, any>;
            event: DynamoGeneralRealtimeEvent<unknown>;
        }>,
    ): DynamoGeneralRealtimeTransactionEntry {
        // `privateSymbol` is only accessible in this module so this assert makes sure
        // we don't call this method from outside of this module.
        assert(symbol === privateSymbol);

        return new DynamoGeneralRealtimeTransactionEntry(entry, getEvent);
    }

    public _get(symbol: typeof privateSymbol) {
        // `privateSymbol` is only accessible in this module so this assert makes sure
        // we don't call this method from outside of this module.
        assert(symbol === privateSymbol);

        return {
            entry: this._entry,
            getEvent: this._getEvent,
        };
    }
}
