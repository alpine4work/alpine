// NOTE(calebmer): These are in `shared/id/types` instead of
// `shared/api/specification/types` because we need to be able to import it from
// `shared/tasks` and `server/tasks` code which don't depend on the broad API
// specification package.

/**
 * An opaque cursor which tells you the position of a task in some query. For
 * example, the position of a task in a task collection.
 *
 * An encoded base64 representation of a `TaskQuerySortCursor`. But we also encode
 * the `TaskQueryNormalizedSort`s into the query so we can verify that the API
 * client is giving us back a well formed cursor for the sort they requested.
 */
export type ApiTaskQueryCursor = string & {readonly _ApiTaskQueryCursor: never};

/**
 * An opaque cursor which tells you the position of a task in some collection.
 *
 * This includes a subset of the data in `ApiTaskQueryCursor` for a manually sorted
 * collection. We can omit the `createdTime` (which doesn't matter when moving
 * tasks in a collection) and only include the first ~23 bits of the
 * `TaskCollectionId` so we can save some bytes returned by the API.
 */
export type ApiTaskCollectionCursor = string & {readonly _ApiTaskCollectionCursor: never};
