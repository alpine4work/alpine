import {Schema} from "~/shared/schema/schema.js";

/**
 * Cursor of an entry in an account's feed. This is used to paginate through a
 * feed. The client shouldn't care about what's inside the cursor. The cursor is an
 * implementation detail of the server.
 *
 * But let's still describe the server implementation, a cursor is made of two
 * indexes.
 *
 * - `entryBlockIndex`: On the server a feed is represented as a list of feed entry
 *   blocks. Each block has at least 1 entry and at most 10 entries (as of
 *   2025-05-18). Entry blocks are sorted in reverse order so entry block index 4
 *   is above entry block index 3.
 *
 * - `entryBlockInnerIndex`: The index of the entry within to block. So if each
 *   block has 1-10 entries then the inner index will be 0-9 indicating which
 *   specific entry in the block this cursor represents.
 */
export type FeedEntryCursor = readonly [entryBlockIndex: number, entryBlockInnerIndex: number];

export const FeedEntryCursorSchema = Schema.tuple([Schema.integer.min(0), Schema.integer.min(0)]);
