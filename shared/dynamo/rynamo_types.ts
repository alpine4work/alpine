import {
    DynamoIndexCursor,
    DynamoIndexCursorSchema,
    DynamoIndexPartitionKey,
    DynamoIndexPartitionKeySchema,
    DynamoItemKey,
    DynamoItemKeySchema,
    DynamoItemPartitionKey,
    DynamoItemPartitionKeySchema,
} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {ObjectSchema, Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    ServerSynchronizationCheckpoint,
    ServerSynchronizationCheckpointSchema,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * The result of reading an individual item from a realtime DynamoDB table.
 *
 * We use both the names "item" and "model" in these types. "Item" refers to the
 * underlying item in the DynamoDB table. Clients do not have access to this item
 * as it may contain private internal data. Instead clients have access to a
 * "model" which is a nicely formatted object for use on the client.
 */
export type RynamoItem<Model> = {
    /**
     * Unique identifier for the item within the DynamoDB table the item came from.
     */
    readonly key: DynamoItemKey;

    /**
     * The current version of the item. Ignore any events for the same item key before
     * this version.
     */
    readonly version: number;

    /**
     * The model value the client will use to render this item. May not contain all
     * internal properties from the DynamoDB table. May contain relevant data from
     * other tables.
     */
    readonly model: Model;
};

export function createRynamoItemSchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<RynamoItem<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        key: DynamoItemKeySchema,
        version: Schema.integer.min(0),
        model: ModelSchema,
    });
}

/**
 * The result of a query for a range of items in a realtime DynamoDB table.
 *
 * You query for a range of items in a DynamoDB partition. The order of items is
 * determined by their sort key. Items in a DynamoDB query won't change their
 * order. Since the sort key is a part of the item's primary key.
 *
 * Queries can be run in descending order. In this case the order of `items` is
 * reversed from how they are stored is in the table.
 */
export type RynamoQueryResult<Model> = {
    /**
     * At what point in time is this data up-to-date? When we connect to realtime on
     * the client we should load all changes between the `checkpoint` and the current
     * time in case the query updated while we were disconnected from realtime. In
     * practice we read from `checkpoint - 3min` to the current time to handle clock
     * skew and eventually consistent reads.
     */
    readonly checkpoint: ServerSynchronizationCheckpoint;

    /**
     * The partition key this query result is for. A query can only cover one
     * partition. All items will be a part of the same partition.
     */
    readonly partitionKey: DynamoItemPartitionKey;

    /**
     * The inclusive upper bound of items we should expect in this query. If an item
     * with this key exists then it'll be included in the query.
     */
    readonly startItemKey: DynamoItemKey | null;

    /**
     * The inclusive lower bound of items we should expect in this query. If an item
     * with this key exists then it'll be included in the query.
     */
    readonly endItemKey: DynamoItemKey | null;

    /**
     * Information about this page of query results. Includes the direction we were
     * paginating in (`FromStart` or `FromEnd`), whether there's a next page, and the
     * item key we started querying the page from.
     */
    readonly pageInfo:
        | {
              readonly type: "FromStart";
              readonly afterItemKey: DynamoItemKey | null;
              readonly hasNextPage: boolean;
          }
        | {
              readonly type: "FromEnd";
              readonly beforeItemKey: DynamoItemKey | null;
              readonly hasPreviousPage: boolean;
          };

    /**
     * The items returned by this query in order. The item order is based on the
     * lexicographic order of their keys.
     *
     * You can run a query in descending mode. In that case items will be in reverse
     * order from how they're actually stored.
     */
    readonly items: ReadonlyArray<RynamoItem<Model>>;
};

export function createRynamoQuerySchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<RynamoQueryResult<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        checkpoint: ServerSynchronizationCheckpointSchema,
        partitionKey: DynamoItemPartitionKeySchema,
        startItemKey: DynamoItemKeySchema.nullable(),
        endItemKey: DynamoItemKeySchema.nullable(),
        pageInfo: Schema.union({
            FromStart: Schema.object({
                type: Schema.value("FromStart"),
                afterItemKey: DynamoItemKeySchema.nullable(),
                hasNextPage: Schema.boolean,
            }),
            FromEnd: Schema.object({
                type: Schema.value("FromEnd"),
                beforeItemKey: DynamoItemKeySchema.nullable(),
                hasPreviousPage: Schema.boolean,
            }),
        }),
        items: Schema.array(
            Schema.object({
                key: DynamoItemKeySchema,
                version: Schema.integer.min(0),
                model: ModelSchema,
            }),
        ),
    });
}

/**
 * The result of a query for a range of items on a realtime DynamoDB table index.
 *
 * Indexes have a different order of items than the base table. Items may move
 * around the index as their attributes change whereas they stay locked in their
 * table position.
 *
 * Queries can be run in descending order. In this case the order of `items` is
 * reversed from how they are stored is in the base index.
 */
export type RynamoIndexQueryResult<Model> = {
    /**
     * At what point in time is this data up-to-date? When we connect to realtime on
     * the client we should load all changes between the `checkpoint` and the current
     * time in case the query updated while we were disconnected from realtime. In
     * practice we read from `checkpoint - 3min` to the current time to handle clock
     * skew and eventually consistent reads.
     */
    readonly checkpoint: ServerSynchronizationCheckpoint;

    /**
     * What is the name of the index that provides the order for this query? You will
     * compare this against the index names in `event.indexes` from `RynamoEvent`. You
     * can not compare cursors across indexes.
     */
    readonly indexName: string;

    /**
     * The index partition key this query result is for. A query can only cover one
     * partition. All items will be a part of the same partition.
     */
    readonly partitionKey: DynamoIndexPartitionKey;

    /**
     * The upper bound of items we should expect in this query.
     *
     * Not a full `DynamoIndexCursor` but you can compare orders between this bound
     * string and `DynamoIndexCursor`s.
     */
    readonly startCursorBound: string | null;

    /**
     * The lower bound of items we should expect in this query.
     *
     * Not a full `DynamoIndexCursor` but you can compare orders between this bound
     * string and `DynamoIndexCursor`s.
     */
    readonly endCursorBound: string | null;

    /**
     * Information about this page of query results. Includes the direction we were
     * paginating in (`FromStart` or `FromEnd`), whether there's a next page, and the
     * cursor we started querying the page from.
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
     * You can run a query in descending mode. In that case items will be in reverse
     * order from how they're actually stored.
     *
     * Every item includes its cursor to help you figure out the relative order of
     * items in this query. When a new item is created (or an existing item updated)
     * you can take the item's cursor and figure out where the item now lives in this
     * list.
     */
    readonly items: ReadonlyArray<
        {
            readonly cursor: DynamoIndexCursor;
        } & RynamoItem<Model>
    >;
};

export function createRynamoIndexQuerySchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<RynamoIndexQueryResult<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        checkpoint: ServerSynchronizationCheckpointSchema,
        indexName: Schema.string,
        partitionKey: DynamoIndexPartitionKeySchema,
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
 * Remember that these events may arrive out-of-order! We include version numbers
 * for items so that you can apply the events in the correct order no matter the
 * order in which they arrive.
 */
export type RynamoEvent<Model> = RynamoPutItemEvent<Model> | RynamoDeleteItemEvent;

export function createRynamoEventSchema<Model>(
    ModelSchema: Schema<Model>,
): Schema<RynamoEvent<Model>> {
    return Schema.union({
        PutItem: createRynamoPutItemEventSchema(ModelSchema),
        DeleteItem: RynamoDeleteItemEventSchema,
    });
}

/**
 * Event for when a new item is created or updated.
 */
export type RynamoPutItemEvent<Model> = {
    readonly type: "PutItem";
    readonly item: RynamoItem<Model>;
    readonly indexes: RynamoPutItemEventIndexes;
};

export type RynamoPutItemEventIndexes = ReadonlyMap<
    string,
    {readonly partitionKey: DynamoIndexPartitionKey; readonly cursor: DynamoIndexCursor}
>;

function createRynamoPutItemEventSchema<Model>(
    _ModelSchema: Schema<Model>,
): ObjectSchema<RynamoPutItemEvent<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.object({
        type: Schema.value("PutItem"),
        item: createRynamoItemSchema(ModelSchema),
        indexes: Schema.map(
            Schema.string,
            Schema.object({
                partitionKey: DynamoIndexPartitionKeySchema,
                cursor: DynamoIndexCursorSchema,
            }),
        ),
    });
}

/**
 * Event for when an item is deleted.
 */
export type RynamoDeleteItemEvent = {
    readonly type: "DeleteItem";
    readonly item: {
        readonly key: DynamoItemKey;
        readonly version: number;
    };
    readonly indexes: ReadonlySet<string>;
};

const RynamoDeleteItemEventSchema = Schema.object({
    type: Schema.value("DeleteItem"),
    item: Schema.object({
        key: DynamoItemKeySchema,
        version: Schema.integer.min(0),
    }),
    indexes: Schema.set(Schema.string),
});

/**
 * A stub event. Implies the existence of a `RynamoEvent` but doesn't include the
 * full data associated with the `RynamoEvent` in case the receiver of a stub is
 * not allowed to view that data.
 */
export type RynamoEventStub = SchemaType<typeof RynamoEventStubSchema>;

export const RynamoEventStubSchema = Schema.object({
    type: Schema.enum(["PutItem", "DeleteItem"]),
    item: Schema.object({
        key: DynamoItemKeySchema,
        version: Schema.integer.min(0),
    }),
});

// NOTE(calebmer): I don't think any code actually depends on this relationship
// between the event type and event stub type but it's nice in theory.
assertAssignableTypes<RynamoEvent<unknown>, RynamoEventStub>();

export type RynamoBackfillResult<Model> =
    | {
          readonly type: "Unavailable";
      }
    | {
          readonly type: "Available";
          readonly checkpoint: ServerSynchronizationCheckpoint;
          readonly events: ReadonlyArray<RynamoEvent<Model>>;
      };

export function createRynamoBackfillResultSchema<Model>(
    _ModelSchema: Schema<Model>,
): Schema<RynamoBackfillResult<Model>> {
    // `Optionalize<T>` does not like generics so use any instead.
    const ModelSchema: Schema<any> = _ModelSchema;

    return Schema.union({
        Unavailable: Schema.object({
            type: Schema.value("Unavailable"),
        }),
        Available: Schema.object({
            type: Schema.value("Available"),
            checkpoint: ServerSynchronizationCheckpointSchema,
            events: Schema.array(createRynamoEventSchema(ModelSchema)),
        }),
    });
}
