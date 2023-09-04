import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {
    VtencBigUint64Set,
    decodeVtencBigUint64List,
    encodeVtencBigUint64Set,
    isVtencBigInt64SetEmpty,
} from "~/shared/helpers/number/vtenc_big_uint_64_set.js";
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
 * JSON we'd max out at ~285 pages. That's not even enough for one new page a
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

/**
 * A compressed set of `TaskNotepadPageId`s. Allows for cached interchange
 * between an uncompressed and compressed set. Convenient since if we
 * deserialize from the database then serialize to the client, we don't need to
 * re-encode the compressed set.
 */
export class TaskNotepadPageIdCompressedSet {
    private _ids: ReadonlySet<TaskNotepadPageId> | null;
    private _compressedIds: VtencBigUint64Set | null;

    private constructor(
        ids: ReadonlySet<TaskNotepadPageId> | null,
        compressedIds: VtencBigUint64Set | null,
    ) {
        this._ids = ids;
        this._compressedIds = compressedIds;
    }

    public static fromIds(ids: ReadonlySet<TaskNotepadPageId>) {
        return new TaskNotepadPageIdCompressedSet(ids, null);
    }

    public static fromCompressedIds(compressedIds: VtencBigUint64Set) {
        return new TaskNotepadPageIdCompressedSet(null, compressedIds);
    }

    /**
     * Get the notepad pages in uncompressed set format. If this class was
     * initialized with the compressed set format we will decompress once and cache
     * the result.
     */
    public getIds(): ReadonlySet<TaskNotepadPageId> {
        if (this._ids === null) {
            assert(this._compressedIds !== null);
            this._ids = new Set(
                mapIterable(decodeVtencBigUint64List(this._compressedIds), Number),
            ) as Set<TaskNotepadPageId>;
        }

        return this._ids;
    }

    /**
     * Get the notepad pages in compressed set format. If this class was
     * initialized with the uncompressed set format we will compress once and cache
     * the result.
     */
    public getCompressedIds(): VtencBigUint64Set {
        if (this._compressedIds === null) {
            assert(this._ids !== null);
            this._compressedIds = encodeVtencBigUint64Set(mapIterable(this._ids, BigInt));
        }

        return this._compressedIds;
    }

    /**
     * Is the set empty? Will use either the compressed or uncompressed format
     * depending on what's available. We don't need to decompress to tell if the
     * set is empty.
     */
    public isEmpty(): boolean {
        if (this._ids !== null) return this._ids.size === 0;
        if (this._compressedIds !== null) return isVtencBigInt64SetEmpty(this._compressedIds);
        assert(false);
    }
}

export const TaskNotepadPageIdCompressedSetSchema =
    Schema.bytes.transform<TaskNotepadPageIdCompressedSet>({
        serialize: pageIds => {
            return pageIds.getCompressedIds();
        },
        deserialize: pageIds => {
            return TaskNotepadPageIdCompressedSet.fromCompressedIds(pageIds as VtencBigUint64Set);
        },
    });
