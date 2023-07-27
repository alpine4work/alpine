import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {
    VtencBigUint64Set,
    decodeVtencBigUint64List,
    encodeVtencBigUint64Set,
} from "~/shared/helpers/number/vtenc_big_int_64_set.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * The ID for a task notepad page. The underlying format is the milliseconds
 * elapsed since the Unix epoch. Or the same number returned by `Date.now()`.
 *
 * We store these notepad pages in a set and compress them with
 * `VtencBigInt64Set` so we can load all the account's pages at once from a
 * single DynamoDB item without needing to lazy load them. Hopefully up to
 * really high scales.
 *
 * In practice we've observed `VtencBigInt64Set` gives us an ~50% compression
 * ratio for ~100 `TaskNotepadPageId`s compared to a raw binary
 * representation. Each `TaskNotepadPageId` is 64 bits when stored in binary
 * and ~112 bits when stored in JSON text. So in different formats 100 pages
 * would take:
 *
 * - JSON text format: 1.4kb
 * - Raw binary format: 0.8kb
 * - Compressed binary format: 0.4kb
 *
 * The maximum size of a DynamoDB item is 400kb. If we stored notepad pages in
 * text we'd max out at ~285 pages. That's not even enough for one new page a
 * day for a year! With compression we max out at ~1000 pages. Which is more
 * comfortable but still may be reachable by some users.
 */
export type TaskNotepadPageId = number & {readonly _TaskNotepadPageId: never};

/**
 * Generates a new `TaskNotepadPageId` as the current time.
 */
export function generateTaskNotepadPageId(): TaskNotepadPageId {
    return Date.now() as TaskNotepadPageId;
}

export const TaskNotepadPageIdSchema = Schema.integer as Schema<any> as Schema<TaskNotepadPageId>;

export const TaskNotepadPageIdCompressedSetSchema = Schema.bytes.transform<
    ReadonlySet<TaskNotepadPageId>
>({
    serialize: pageIds => {
        return encodeVtencBigUint64Set(mapIterable(pageIds, BigInt));
    },
    deserialize: pageIds => {
        return new Set(
            mapIterable(decodeVtencBigUint64List(pageIds as VtencBigUint64Set), Number),
        ) as Set<TaskNotepadPageId>;
    },
});
