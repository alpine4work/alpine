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
