import {Schema} from "~/shared/schema/schema.js";

/**
 * An opaque string representing the primary key of a DynamoDB item.
 *
 * The lexicographic order of items in different partitions is arbitrary and
 * has no meaning. The lexicographic order of items within a partition follows
 * the sort key.
 *
 * The string uses a base64 encoding so the data within is opaque but easily
 * reversible. Make sure to only share this string with clients who are allowed
 * to read the data within the item's primary key.
 *
 * Developers shouldn't try to parse the string for information. Instead data
 * relevant to the client should be sent by other means.
 */
export type DynamoItemKey = string & {readonly _DynamoItemKey: never};

export const DynamoItemKeySchema = Schema.string as Schema<any> as Schema<DynamoItemKey>;

/**
 * An opaque string representing a position in a DynamoDB index.
 *
 * The lexicographic order of this string mostly corresponds to the order of
 * items in the index. Except for in one important edge case: If two items have
 * the same index key DynamoDB does not specify how the items are sorted. The
 * lexicographic order of cursors does not correspond to DynamoDB's internal
 * sorting of conflicting index items.
 *
 * If you want the lexicographic order of this string to EXACTLY match the
 * order of items in the index then set `includePrimaryKeyInSortKey` to true on
 * your index. This will use the item's primary key to tiebreak the order.
 *
 * The string uses a base64 encoding so the data within is opaque but easily
 * reversible. Make sure to only share this string with clients who are allowed
 * to read the data within the item's index key AND primary key.
 *
 * Developers shouldn't try to parse the string for information. Instead data
 * relevant to the client should be sent by other means.
 */
export type DynamoIndexCursor = string & {readonly _DynamoIndexCursor: never};

export const DynamoIndexCursorSchema = Schema.string as Schema<any> as Schema<DynamoIndexCursor>;
