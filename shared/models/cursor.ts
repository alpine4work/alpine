import {Schema} from "~/shared/schema/schema";

/**
 * A cursor is any opaque string used for cursor based pagination.
 *
 * The implementation of a cursor is up to the pagination implementation. We
 * recommend pagination implementations base64 encode their cursors so clients
 * don't rely on server details. However this only makes the contents of the
 * cursor opaque and does not encrypt content. Since cursors are shared with
 * the client they should be public knowledge.
 */
export type Cursor = string & {readonly _Cursor: never};

export const CursorSchema = Schema.string as Schema<any> as Schema<Cursor>;
