import {DynamoContext} from "~/server/dynamo/context/dynamo_context";
import {DynamoTransactionEntry} from "~/server/dynamo/helpers/dynamo_transaction_entry";
import {DynamoReadConsistency} from "~/server/dynamo/internal/dynamo_client";
import {DynamoCondition} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {
    DynamoIndexCursor,
    DynamoItemKey,
    DynamoTableSchema,
    DynamoTableSchemaIndexConfig,
    DynamoTableSchemaIndexKeyAttributesConfigBase,
    DynamoTableSchemaIndexKeyAttributesType,
    DynamoTableSchemaTypesBase,
} from "~/server/dynamo/internal/dynamo_table_schema";
import {DynamoTableSchemaTypes} from "~/server/dynamo/internal/types/dynamo_table_schema_types";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection";
import {ObjectFromEntries} from "~/shared/helpers/types/object_from_entries";

// NOCOMMIT: Document item vs model naming
type DynamoRealtimeItemResult<Model> = {
    readonly readTime: Date;
    readonly key: DynamoItemKey;
    readonly version: number;
    readonly model: Model;
};

type DynamoRealtimeQueryResult<Model> = {
    readonly readTime: Date;
    readonly items: ReadonlyArray<{
        readonly key: DynamoItemKey;
        readonly version: number;
        readonly model: Model;
    }>;
    readonly hasMoreItems: boolean;
};

type DynamoRealtimeIndexQueryResult<Model> = {
    readonly readTime: Date;
    readonly indexName: string;
    readonly items: ReadonlyArray<{
        readonly cursor: DynamoIndexCursor;
        readonly key: DynamoItemKey;
        readonly version: number;
        readonly model: Model;
    }>;
    readonly hasMoreItems: boolean;
};

// NOCOMMIT: Explain why we don't currently support deleting items
type DynamoRealtimeEvent<Model> =
    | DynamoRealtimeCreateItemEvent<Model>
    | DynamoRealtimeUpdateItemEvent<Model>;

type DynamoRealtimeCreateItemEvent<Model> = {
    readonly type: "CreateItem";
    readonly key: DynamoItemKey;
    readonly version: number;
    readonly model: Model;
    readonly cursorByIndexName: ReadonlyMap<string, DynamoIndexCursor>;
};

type DynamoRealtimeUpdateItemEvent<Model> = {
    readonly type: "UpdateItem";
    readonly key: DynamoItemKey;
    readonly version: number;
    readonly model: Model;
    readonly cursorByIndexName: ReadonlyMap<string, DynamoIndexCursor>;
};

export type DynamoRealtimeTableSchemaGetTypes<Schema extends DynamoRealtimeTableSchema<any, any>> =
    Schema extends DynamoRealtimeTableSchema<infer Types, any> ? Types : never;

type DynamoRealtimeTableSchemaPartitionModelConfigType<
    PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof PartitionsConfig]: [
        PartitionsConfig[Index]["name"],
        DynamoRealtimeTableSchemaSortRangeModelConfigType<
            PartitionsConfig[Index],
            PartitionsConfig[Index]["sortRanges"]
        >,
    ];
}>;

type DynamoRealtimeTableSchemaSortRangeModelConfigType<
    PartitionConfig extends DynamoTableSchemaTypes.Partition.ConfigBase,
    SortRangesConfig extends ReadonlyArray<DynamoTableSchemaTypes.SortRange.ConfigBase>,
> = ObjectFromEntries<{
    [Index in keyof SortRangesConfig]: [
        SortRangesConfig[Index]["name"],
        {
            build: (
                context: DynamoContext,
                item: DynamoTableSchemaTypes.ItemType<PartitionConfig, SortRangesConfig[Index]>,
            ) => Promise<unknown>;
        },
    ];
}>;

type DynamoRealtimeTableSchemaModelMapType<
    ModelsConfig extends {
        [partitionType: string]: {[sortRangeType: string]: {build: () => Promise<any>}};
    },
> = {
    [Key1 in keyof ModelsConfig]: {
        [Key2 in keyof ModelsConfig[Key1]]: Awaited<ReturnType<ModelsConfig[Key1][Key2]["build"]>>;
    };
};

export class DynamoRealtimeTableSchema<
    Types extends DynamoTableSchemaTypesBase,
    ModelMap extends {[partitionType: string]: {[sortRangeType: string]: any}},
> {
    private readonly _table: DynamoTableSchema<Types>;
    private readonly _models: DynamoRealtimeTableSchemaPartitionModelConfigType<
        DynamoTableSchemaTypes.ConfigBase["partitions"]
    >;

    private readonly _serializeOpaqueCursorByIndexNameByItemType = new Map<
        string,
        Map<string, (item: Types["Item"]) => DynamoIndexCursor>
    >();

    public static new<
        const PartitionsConfig extends ReadonlyArray<DynamoTableSchemaTypes.Partition.ConfigBase>,
        const ModelsConfig extends DynamoRealtimeTableSchemaPartitionModelConfigType<PartitionsConfig>,
    >(config: {
        name: string;
        partitions: PartitionsConfig;
        models: ModelsConfig;
    }): DynamoRealtimeTableSchema<
        DynamoTableSchemaTypes.Types<{name: string; partitions: PartitionsConfig}>,
        DynamoRealtimeTableSchemaModelMapType<ModelsConfig>
    > {
        return new DynamoRealtimeTableSchema(DynamoTableSchema.new(config), config.models);
    }

    private constructor(
        table: DynamoTableSchema<Types>,
        models: DynamoRealtimeTableSchemaPartitionModelConfigType<
            DynamoTableSchemaTypes.ConfigBase["partitions"]
        >,
    ) {
        this._table = table;
        this._models = models;
    }

    private _buildModel<Item extends Types["Item"]>(
        context: DynamoContext,
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
        context: DynamoContext,
        event: ReadonlyArray<DynamoRealtimeEvent<Model>>,
    ): Promise<void> {
        // NOCOMMIT: Implement!
    }

    public async createItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<DynamoRealtimeItemResult<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>> {
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

    public async updateItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        update: (
            item: MergeObjectIntersection<Types["Item"] & Key> | null,
        ) => MaybePromise<MergeObjectIntersection<Types["Item"] & Key>>,
    ): Promise<DynamoRealtimeItemResult<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
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

    public async directlyUpdateItem<Item extends Types["Item"]>(
        context: DynamoContext,
        item: Item,
    ): Promise<DynamoRealtimeItemResult<ModelMap[Item["partitionType"]][Item["sortRangeType"]]>> {
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

    public transactionCreateItem<Item extends Types["Item"]>(item: Item): DynamoTransactionEntry {
        const entry: DynamoTransactionEntryWithGetTransactionEntryEvent =
            this._table.transactionCreateItem(item);

        entry[getTransactionEntryEventSymbol] = async context => {
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
        };

        return entry;
    }

    public transactionDirectlyUpdateItem<Item extends Types["Item"]>(
        item: Item,
    ): DynamoTransactionEntry {
        const entry: DynamoTransactionEntryWithGetTransactionEntryEvent =
            this._table.transactionDirectlyUpdateItem(item);

        entry[getTransactionEntryEventSymbol] = async context => {
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
        };

        return entry;
    }

    public transactionConditionCheck<Key extends Types["ItemKey"]>(
        key: Key,
        condition?: DynamoCondition<Types["Item"] & Key>,
    ): DynamoTransactionEntry {
        return this._table.transactionConditionCheck(key, condition);
    }

    public transactionDoesNotExistConditionCheck<Key extends Types["ItemKey"]>(
        key: Key,
    ): DynamoTransactionEntry {
        return this._table.transactionDoesNotExistConditionCheck(key);
    }

    public getItemIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key> | null> {
        return this._table.getItemIfExists(context, key, options);
    }

    public getItem<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        key: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<MergeObjectIntersection<Types["Item"] & Key>> {
        return this._table.getItem(context, key, options);
    }

    public async getModelIfExists<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoRealtimeItemResult<
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

    public async getModel<Key extends Types["ItemKey"]>(
        context: DynamoContext,
        itemKey: Key,
        options?: {consistency?: DynamoReadConsistency},
    ): Promise<DynamoRealtimeItemResult<ModelMap[Key["partitionType"]][Key["sortRangeType"]]>> {
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

    public async query<
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
    ): Promise<
        DynamoRealtimeQueryResult<
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

    // NOCOMMIT: Note that the index name will be shared with the client
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
    ): DynamoRealtimeTableSchemaIndex<
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
                DynamoRealtimeIndexQueryResult<
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

    public static async _broadcastEventsAfterTransaction(
        context: DynamoContext,
        entries: ReadonlyArray<DynamoTransactionEntryWithGetTransactionEntryEvent>,
    ) {
        // If no entries have a corresponding realtime event then bail early...
        if (entries.every(entry => !entry[getTransactionEntryEventSymbol])) return;

        const eventsBySchema = new Map<
            DynamoRealtimeTableSchema<
                DynamoTableSchemaTypesBase,
                {[partitionType: string]: {[sortRangeType: string]: any}}
            >,
            Array<DynamoRealtimeEvent<unknown>>
        >();

        await runAllPromises(
            entries.map(async entry => {
                const getTransactionEntryEvent = entry[getTransactionEntryEventSymbol];
                if (!getTransactionEntryEvent) return;

                const {schema, event} = await getTransactionEntryEvent(context);

                getOrSetDefaultMapValue(eventsBySchema, schema, () => []).push(event);
            }),
        );

        await runAllPromises(
            mapIterable(eventsBySchema, async ([schema, events]) => {
                await schema._broadcastEventTransaction(context, events);
            }),
        );
    }
}

/**
 * The type to use for accessing an index on our DynamoDB table.
 */
export interface DynamoRealtimeTableSchemaIndex<Model, IndexPartitionKey, IndexSortKey> {
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
    ): Promise<DynamoRealtimeIndexQueryResult<Model>>;
}

const getTransactionEntryEventSymbol = Symbol("getTransactionEntryEvent");

type DynamoTransactionEntryWithGetTransactionEntryEvent = DynamoTransactionEntry & {
    [getTransactionEntryEventSymbol]?: (context: DynamoContext) => Promise<{
        schema: DynamoRealtimeTableSchema<any, any>;
        event: DynamoRealtimeEvent<unknown>;
    }>;
};
