import {
    DynamoIndexCursor,
    DynamoIndexCursorSchema,
    DynamoItemKey,
    DynamoItemKeySchema,
} from "~/shared/dynamo/dynamo_opaque_strings";
import {ObjectSchema, Schema} from "~/shared/schema/schema";

/**
 * The result of reading an individual item from a realtime DynamoDB table.
 *
 * We use both the names "item" and "model" in these types. "Item" refers to
 * the underlying item in the DynamoDB table. Clients do not have access to
 * this item as it may contain private internal data. Instead clients have
 * access to a "model" which is a nicely formatted object for use on
 * the client.
 */
export type DynamoGeneralRealtimeItem<Model> = {
    /**
     * When did the read for this data start? When we connect to realtime on the
     * client we should load all changes between the `readTime` and the current
     * time in case the item updated while we were disconnected from realtime. In
     * practice we read from `readTime - 10min` to the current time to handle clock
     * skew and eventually consistent reads.
     */
    // NOCOMMIT: Remove this? We only need it on the queries I think. Explain in
    // documentation that to backfill updates to an item we re-read it.
    readonly readTime: Date;

    /**
     * Unique identifier for the item within the DynamoDB table the item came from.
     */
    readonly key: DynamoItemKey;

    /**
     * The current version of the item. Ignore any events for the same item key
     * before this version.
     */
    readonly version: number;

    /**
     * The model value the client will use to render this item. May not contain all
     * internal properties from the DynamoDB table. May contain relevant data
     * from other tables.
     */
    readonly model: Model;
};

export function createDynamoGeneralRealtimeItemSchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeItem<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        readTime: Schema.date,
        key: DynamoItemKeySchema,
        version: Schema.integer.min(0),
        model: ModelSchema,
    });
}

/**
 * The result of a query for a range of items on a realtime DynamoDB table.
 *
 * Differs from `DynamoGeneralRealtimeIndexQueryResult` in that the item key
 * determines the ordering of items instead of the cursor.
 */
export type DynamoGeneralRealtimeQuery<Model> = {
    /**
     * When did the read for this data start? When we connect to realtime on the
     * client we should load all changes between the `readTime` and the current
     * time in case the item updated while we were disconnected from realtime. In
     * practice we read from `readTime - 10min` to the current time to handle clock
     * skew and eventually consistent reads.
     */
    readonly readTime: Date;

    /**
     * The items returned by this query in order.
     *
     * You can run a query in descending mode. In that case items will be in
     * reverse order from how they're actually stored.
     */
    readonly items: ReadonlyArray<{
        readonly key: DynamoItemKey;
        readonly version: number;
        readonly model: Model;
    }>;

    /**
     * Are there more items in this query? When you execute a query you provide
     * optional bounds and a limit. If we reach the limit but there are still more
     * items then we set this to true. It means the client should load another page
     * of data when needed.
     */
    readonly hasMoreItems: boolean;
};

export function createDynamoGeneralRealtimeQuerySchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeQuery<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        readTime: Schema.date,
        items: Schema.array(
            Schema.object({
                key: DynamoItemKeySchema,
                version: Schema.integer.min(0),
                model: ModelSchema,
            }),
        ),
        hasMoreItems: Schema.boolean,
    });
}

/**
 * The result of a query for a range of items on a realtime DynamoDB table
 * index.
 *
 * Indexes have a different order of items than the base table. Items may move
 * around the index as their attributes change whereas they stay locked in
 * their table position.
 *
 * Queries can be run in descending order. In this case the order of `items` is
 * reversed from how they are stored is in the base index.
 */
export type DynamoGeneralRealtimeIndexQuery<Model> = {
    /**
     * When did the read for this data start? When we connect to realtime on the
     * client we should load all changes between the `readTime` and the current
     * time in case the item updated while we were disconnected from realtime. In
     * practice we read from `readTime - 10min` to the current time to handle clock
     * skew and eventually consistent reads.
     */
    readonly readTime: Date;

    /**
     * What is the name of the index that provides the order for this query? You
     * will compare this against the index names in `cursorByIndexName` from
     * `DynamoGeneralRealtimeEvent`. You can not compare cursors across indexes.
     */
    readonly indexName: string;

    /**
     * The items returned by this query in order.
     *
     * You can run a query in descending mode. In that case items will be in
     * reverse order from how they're actually stored.
     *
     * Every item includes its cursor to help you figure out the relative order of
     * items in this query. When a new item is created (or an existing item
     * updated) you can take the item's cursor and figure out where the item now
     * lives in this list.
     */
    readonly items: ReadonlyArray<{
        readonly cursor: DynamoIndexCursor;
        readonly key: DynamoItemKey;
        readonly version: number;
        readonly model: Model;
    }>;

    /**
     * Are there more items in this query? When you execute a query you provide
     * optional bounds and a limit. If we reach the limit but there are still more
     * items then we set this to true. It means the client should load another page
     * of data when needed.
     */
    readonly hasMoreItems: boolean;
};

export function createDynamoGeneralRealtimeIndexQuerySchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeIndexQuery<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        readTime: Schema.date,
        indexName: Schema.string,
        items: Schema.array(
            Schema.object({
                cursor: DynamoIndexCursorSchema,
                key: DynamoItemKeySchema,
                version: Schema.integer.min(0),
                model: ModelSchema,
            }),
        ),
        hasMoreItems: Schema.boolean,
    });
}

/**
 * An event representing some update to a realtime DynamoDB table.
 *
 * Remember that these events may arrive out-of-order! We include version
 * numbers for items so that you can apply the events in the correct order no
 * matter the order in which they arrive.
 */
export type DynamoGeneralRealtimeEvent<Model> =
    | DynamoGeneralRealtimeCreateItemEvent<Model>
    | DynamoGeneralRealtimeUpdateItemEvent<Model>;

export function createDynamoGeneralRealtimeEventSchema<Model>(
    ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeEvent<Model>> {
    return Schema.union({
        CreateItem: createDynamoGeneralRealtimeCreateItemEventSchema(ModelSchema),
        UpdateItem: createDynamoGeneralRealtimeUpdateItemEventSchema(ModelSchema),
    });
}

/**
 * Event for when a new item is created.
 */
export type DynamoGeneralRealtimeCreateItemEvent<Model> = {
    readonly type: "CreateItem";
    readonly item: DynamoGeneralRealtimeItem<Model>;
    readonly cursorByIndexName: ReadonlyMap<string, DynamoIndexCursor>;
};

function createDynamoGeneralRealtimeCreateItemEventSchema<Model>(
    _ModelSchema: Schema<Model>,
): ObjectSchema<DynamoGeneralRealtimeCreateItemEvent<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        type: Schema.value("CreateItem"),
        item: createDynamoGeneralRealtimeItemSchema(ModelSchema),
        cursorByIndexName: Schema.map(Schema.string, DynamoIndexCursorSchema),
    });
}

/**
 * Event for when an item is updated.
 */
export type DynamoGeneralRealtimeUpdateItemEvent<Model> = {
    readonly type: "UpdateItem";
    readonly item: DynamoGeneralRealtimeItem<Model>;
    readonly cursorByIndexName: ReadonlyMap<string, DynamoIndexCursor>;
};

function createDynamoGeneralRealtimeUpdateItemEventSchema<Model>(
    _ModelSchema: Schema<Model>,
): ObjectSchema<DynamoGeneralRealtimeUpdateItemEvent<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        type: Schema.value("UpdateItem"),
        item: createDynamoGeneralRealtimeItemSchema(ModelSchema),
        cursorByIndexName: Schema.map(Schema.string, DynamoIndexCursorSchema),
    });
}
