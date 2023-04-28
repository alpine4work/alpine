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
// NOCOMMIT: Explain why we don't need `readTime` here.
export type DynamoGeneralRealtimeItem<Model> = {
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
        key: DynamoItemKeySchema,
        version: Schema.integer.min(0),
        model: ModelSchema,
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
export type DynamoGeneralRealtimeIndexQueryResult<Model> = {
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
     * The upper bound of items we should expect in this query.
     *
     * Not a full `DynamoIndexCursor` but you can compare orders between this
     * bound string and `DynamoIndexCursor`s.
     */
    readonly startCursorBound: string | null;

    /**
     * The lower bound of items we should expect in this query.
     *
     * Not a full `DynamoIndexCursor` but you can compare orders between this
     * bound string and `DynamoIndexCursor`s.
     */
    readonly endCursorBound: string | null;

    /**
     * Information about this page of query results. Includes the direction we were
     * paginating in (`FromStart` or `FromEnd`), whether there's a next page, and
     * the cursor we started querying the page from.
     */
    readonly pageInfo:
        | {
              readonly type: "FromStart";
              readonly afterCursor: DynamoIndexCursor | null;
              readonly hasNextPage: boolean;
          }
        | {
              readonly type: "FromEnd";
              readonly beforeCursor: DynamoIndexCursor | null;
              readonly hasPreviousPage: boolean;
          };

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
    readonly items: ReadonlyArray<
        {
            readonly cursor: DynamoIndexCursor;
        } & DynamoGeneralRealtimeItem<Model>
    >;
};

export function createDynamoGeneralRealtimeIndexQuerySchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeIndexQueryResult<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        readTime: Schema.date,
        indexName: Schema.string,
        startCursorBound: Schema.string.nullable(),
        endCursorBound: Schema.string.nullable(),
        pageInfo: Schema.union({
            FromStart: Schema.object({
                type: Schema.value("FromStart"),
                afterCursor: DynamoIndexCursorSchema.nullable(),
                hasNextPage: Schema.boolean,
            }),
            FromEnd: Schema.object({
                type: Schema.value("FromEnd"),
                beforeCursor: DynamoIndexCursorSchema.nullable(),
                hasPreviousPage: Schema.boolean,
            }),
        }),
        items: Schema.array(
            Schema.object({
                cursor: DynamoIndexCursorSchema,
                key: DynamoItemKeySchema,
                version: Schema.integer.min(0),
                model: ModelSchema,
            }),
        ),
    });
}

/**
 * An event representing some update to a realtime DynamoDB table.
 *
 * Remember that these events may arrive out-of-order! We include version
 * numbers for items so that you can apply the events in the correct order no
 * matter the order in which they arrive.
 */
// TODO(calebmer): This should eventually get a delete event.
export type DynamoGeneralRealtimeEvent<Model> = DynamoGeneralRealtimePutItemEvent<Model>;

export function createDynamoGeneralRealtimeEventSchema<Model>(
    ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeEvent<Model>> {
    return Schema.union({
        PutItem: createDynamoGeneralRealtimePutItemEventSchema(ModelSchema),
    });
}

/**
 * Event for when a new item is created or updated.
 */
export type DynamoGeneralRealtimePutItemEvent<Model> = {
    readonly type: "PutItem";
    readonly readTime: Date;
    readonly item: DynamoGeneralRealtimeItem<Model>;
    readonly cursorByIndexName: ReadonlyMap<string, DynamoIndexCursor>;
};

function createDynamoGeneralRealtimePutItemEventSchema<Model>(
    _ModelSchema: Schema<Model>,
): ObjectSchema<DynamoGeneralRealtimePutItemEvent<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        type: Schema.value("PutItem"),
        readTime: Schema.date,
        item: createDynamoGeneralRealtimeItemSchema(ModelSchema),
        cursorByIndexName: Schema.map(Schema.string, DynamoIndexCursorSchema),
    });
}

export type DynamoGeneralRealtimeBackfillResult<Model> =
    | {
          readonly type: "Unavailable";
      }
    | {
          readonly type: "Available";
          readonly eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<Model>>;
      };

export function createDynamoGeneralRealtimeBackfillResultSchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<DynamoGeneralRealtimeBackfillResult<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.union({
        Unavailable: Schema.object({
            type: Schema.value("Unavailable"),
        }),
        Available: Schema.object({
            type: Schema.value("Available"),
            eventTransaction: Schema.array(createDynamoGeneralRealtimeEventSchema(ModelSchema)),
        }),
    });
}
