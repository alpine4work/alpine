import {InternalError} from "~/shared/error/error.open_source.js";
import {DataBuilderView} from "~/shared/helpers/binary/data_builder_view.js";
import {getVarInt, pushVarInt} from "~/shared/helpers/binary/var_int.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {decodeId, encodeId, idByteLength} from "~/shared/id/id.open_source.js";
import {TaskActivityEntryId} from "~/shared/id/types/id_types.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {getTaskActorKey} from "~/shared/tasks/get_task_actor_key.js";
import {TaskActivityActor} from "~/shared/tasks/task_activity.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";

/**
 * One title/notes activity window decoded from a window chunk item. Which content
 * field the window covers is determined by the sort range its chunk was read from,
 * not encoded per window.
 *
 * Times are second precision — plenty for windows that debounce over minutes, and
 * what lets the encoding spend a few bytes per window on both timestamps.
 */
export type TaskActivityWindowForActor<Actor> = {
    /** Stable identity; also keys the window's `WindowSnapshot` item. */
    readonly activityEntryId: TaskActivityEntryId;
    /** When the window's earliest source update committed (second precision). */
    readonly firstActivityTime: Date;
    /** When the window's latest source update committed (second precision). */
    readonly lastActivityTime: Date;
    /** True when the window's updates net out to no content change. */
    readonly wasReverted: boolean;
    /**
     * The content version range the window covers, or null when it couldn't be
     * attributed (a title crash-recovery fallback window).
     */
    readonly fromVersion: number | null;
    readonly toVersion: number | null;
    /**
     * The first contributors, in first-contribution order, capped at
     * `maxStoredActorsPerWindow`. The feed renders "A, B, C and N others" so storing
     * every contributor buys nothing — `totalActorCount` carries the N. The full dedup
     * list lives on the window's internal snapshot item.
     */
    readonly actors: ReadonlyArray<Actor | null>;
    /** Distinct contributors ever, including those beyond the stored cap. */
    readonly totalActorCount: number;
};

/**
 * One entry of a chunk item's actor dictionary; windows reference it by index.
 */
export type TaskActivityWindowChunkActor = {
    readonly accountId: AccountId;
    /** Bot provenance ("via bot X"), or null for a direct update. */
    readonly fromBotAccountId: AccountId | null;
};

/**
 * The format of the binary window records in a chunk, written as a one-byte header
 * element at the front of the chunk's `windows` array (see
 * `encodeTaskActivityWindows()`). The layout needs a version because these records
 * are opaque bytes the item schema can't see inside, so schema evolution never
 * covers them.
 *
 * It lives INSIDE the binary rather than beside it as an item attribute so the
 * version and the records it describes can't drift apart: every write replaces the
 * whole `windows` value, header included. A separate attribute had to be
 * re-stamped by hand at every rewrite site, and a missed one would label a new
 * encoder's records with the old version — silently dropping those windows from
 * feeds, since readers skip chunks whose version they don't know.
 */
export const taskActivityWindowFormatVersion = 1;

/**
 * Cap on a chunk item's total window bytes. Sized so the hot item stays cheap:
 * every absorb rewrites the whole item (DynamoDB bills writes by full item size),
 * and every chunk update is re-broadcast to realtime subscribers.
 *
 * In practice, we'd like to keep the entire DynamoDB item under 2Kb so that
 * worst-case writes cost us 2 WCUs. We set the limit to slightly less than 2Kb
 * (108 bytes less, to be exact) as a factor of safety. The overhead of the
 * DynamoDb item shouldn't exceed 100 bytes.
 *
 * A window record is ~26–32 bytes typically. So this cap fits roughly 65–75
 * windows per chunk — months of regular editing, since a window is a whole editing
 * burst separated by 10+ idle minutes; most tasks never roll over. The cap is also
 * the write-cost knob: an absorb costs 1–2 WCUs while a chunk is young but ~5 WCUs
 * once the item nears the cap. Lowering the cap (e.g. 1024 ≈ 35 windows) trades a
 * few more items on the load-all read — which barely notices — for cheaper absorbs
 * at the tail.
 */
// 2Kb - ~100 bytes to account for overhead of the DynamoDB item
export const taskActivityWindowChunkMaxByteLength = 1900;

/**
 * How many actors one window record stores. The value is UI headroom, not a byte
 * constraint: every stored actor costs exactly 1 byte (a dictionary index) whether
 * or not it has bot provenance — `from` bot accounts live once in the item-level
 * dictionary, never per window. Feed copy truncates to "A, B, C and N others", so
 * eight covers any plausible rendering while `totalActorCount` carries the N. The
 * cap also keeps the per-chunk actor dictionary far from `maxActorDictionarySize`.
 */
export const maxStoredActorsPerWindow = 8;

/**
 * Window records reference actors as one unsigned byte, with the top value
 * reserved as a sentinel meaning "null actor" — a system update with no
 * responsible account. Null actors are never dictionary entries, so the sentinel
 * can't collide with a real index.
 */
const nullActorIndex = 0xff;

/**
 * The sentinel bounds the dictionary: indexes 0–254 are usable, so a chunk item
 * holds at most 255 distinct actors. The engine checks
 * `countTaskActivityWindowChunkActors()` before writing and rolls to a fresh chunk
 * instead of overflowing, so encoding's throw is a backstop, not a reachable
 * failure.
 */
export const maxActorDictionarySize = nullActorIndex;

const wasRevertedFlag = 1;
const hasVersionsFlag = 2;

// NOTE(activity-actor-cap): Windows store at most `maxStoredActorsPerWindow`
// actors plus a total contributor count (Ian's call — feed copy is always "A, B, C
// and N others", so the tail actors bought bytes, not information). Bot provenance
// (`from`) IS kept: it costs one dictionary entry per distinct bot actor per chunk
// (~16 bytes), not per window, and dropping it would make windows the only
// activity surface that silently credits "Ian" for "Ian via ReviewBot". Revisit if
// a diff view ever becomes the canonical attribution surface.

// Window record layout (all integers are protobuf-style varints unless noted):
//
// - start delta seconds from the chunk's base time, clamped at 0 since commit-time
//   clock skew can put a window marginally before the base (1–2 bytes early in a
//   chunk, 3 past ~4.5 hours, 4 past ~24 days)
// - duration seconds (1–2 bytes; the 15 minute window cap fits in 2)
// - activityEntryId (16 raw bytes — the dominant cost of every record)
// - flags (u8, bit0 = wasReverted, bit1 = has versions)
// - fromVersion and toVersion when flagged (1 byte each while small, 3 bytes each
//   for heavily-edited notes)
// - total distinct contributor count (1 byte until 128 contributors)
// - stored actor count (capped at `maxStoredActorsPerWindow`), then per stored
//   actor a dictionary index (u8, 0xff = null actor, a system update) — 1 byte per
//   stored actor regardless of bot provenance (`from` accounts live once in the
//   item's dictionary, never per window)
//
// Typical record: ~27–33 bytes, dominated by the fixed 16-byte window id rather
// than actors or versions; the worst case is ~37 bytes (an old chunk's 4-byte
// start delta, 3-byte notes versions, all eight actor slots used). See
// `taskActivityWindowChunkMaxByteLength` for what that means per chunk.

/**
 * Encodes windows into the parallel chunk item attributes: the actor dictionary
 * (distinct actors in first-appearance order) and one binary record per window.
 * Encoding is a full rewrite from structured data every time — chunks are small
 * (see `taskActivityWindowChunkMaxByteLength`) so nothing is patched in place.
 *
 * Explicit encode/decode calls on purpose, rather than a lazy transform class
 * (`createSchemaLazyTransformClass()`) or serialization at the DynamoDB boundary:
 *
 * 1. Decoding needs `baseTime` and the `actors` dictionary, which live in sibling
 *    attributes on the chunk item. A lazy transform deserializes from its own
 *    field's value alone, so it can't reach them.
 * 2. The window engine's placement rules reason directly about encoded byte sizes
 *    (chunk caps, rollover), so hiding the codec would bury that arithmetic.
 * 3. Keeping items encoded end-to-end means realtime events ship the compact bytes
 *    instead of inflated structured windows.
 */
export function encodeTaskActivityWindows(
    windows: ReadonlyArray<TaskActivityWindowForActor<TaskCreator>>,
    baseTime: Date,
): {
    actors: Array<TaskActivityWindowChunkActor>;
    windows: Array<Uint8Array>;
} {
    const actors: Array<TaskActivityWindowChunkActor> = [];
    // Keyed by a string instead of the actor object because each window holds its own
    // actor object — reference identity can't deduplicate them.
    const actorIndexByKey = new Map<string, number>();
    for (const window of windows) {
        // Only the stored slice enters the dictionary. Windows can arrive with an uncapped
        // actor list (the engine's open window carries the full snapshot list), and actors
        // past the stored cap are never referenced by a record — a dictionary entry for
        // them would cost bytes without carrying information.
        for (const actor of window.actors.slice(0, maxStoredActorsPerWindow)) {
            if (actor === null) continue;
            const key = getTaskActorKey(actor);
            if (actorIndexByKey.has(key)) continue;
            actorIndexByKey.set(key, actors.length);
            actors.push({
                accountId: actor.accountId,
                fromBotAccountId: actor.from?.accountId ?? null,
            });
        }
    }
    if (actors.length > maxActorDictionarySize) {
        throw new InternalError("Too many distinct actors for one window chunk");
    }

    const windowRecords = windows.map(window => {
        const view = new DataBuilderView();

        pushVarInt(
            view,
            Math.max(
                0,
                Math.floor((window.firstActivityTime.getTime() - baseTime.getTime()) / 1000),
            ),
        );
        pushVarInt(
            view,
            Math.max(
                0,
                Math.ceil(
                    (window.lastActivityTime.getTime() - window.firstActivityTime.getTime()) / 1000,
                ),
            ),
        );
        view.pushUint8s(decodeId(window.activityEntryId));

        const hasVersions = window.fromVersion !== null && window.toVersion !== null;
        view.pushUint8(
            (window.wasReverted ? wasRevertedFlag : 0) | (hasVersions ? hasVersionsFlag : 0),
        );
        if (hasVersions) {
            pushVarInt(view, window.fromVersion);
            pushVarInt(view, window.toVersion);
        }

        pushVarInt(view, window.totalActorCount);

        const storedActors = window.actors.slice(0, maxStoredActorsPerWindow);
        pushVarInt(view, storedActors.length);
        for (const actor of storedActors) {
            if (actor === null) {
                view.pushUint8(nullActorIndex);
                continue;
            }
            const actorIndex = actorIndexByKey.get(getTaskActorKey(actor));
            // `!== undefined` and not a plain truthiness assert — index 0 is valid.
            assert(actorIndex !== undefined, "Window actor is missing from the chunk dictionary");
            view.pushUint8(actorIndex);
        }

        return view.build();
    });

    // The header goes first so a reader can learn the format before interpreting any
    // record — and so it's impossible to write records without writing their version.
    return {
        actors,
        windows: [new Uint8Array([taskActivityWindowFormatVersion]), ...windowRecords],
    };
}

export function decodeTaskActivityWindows(input: {
    baseTime: Date;
    actors: ReadonlyArray<TaskActivityWindowChunkActor>;
    windows: ReadonlyArray<Uint8Array>;
}): Array<TaskActivityWindowForActor<TaskCreator>>;
export function decodeTaskActivityWindows(input: {
    baseTime: Date;
    actors: ReadonlyArray<TaskActivityActor>;
    windows: ReadonlyArray<Uint8Array>;
}): Array<TaskActivityWindowForActor<TaskActivityActor>>;
export function decodeTaskActivityWindows({
    baseTime,
    actors,
    windows,
}: {
    baseTime: Date;
    actors: ReadonlyArray<TaskActivityWindowChunkActor | TaskActivityActor>;
    windows: ReadonlyArray<Uint8Array>;
}): Array<TaskActivityWindowForActor<TaskCreator | TaskActivityActor>> {
    // An unknown format version means the chunk was written by a newer build than this
    // reader. Render the feed without its windows instead of throwing — the decode
    // runs during render, so a throw would take down the whole task page for every
    // not-yet-updated client the moment the format is ever bumped. A chunk with no
    // header at all is unreadable for the same reason, so it takes the same path.
    const formatVersion = windows[0]?.[0];
    if (formatVersion !== taskActivityWindowFormatVersion) {
        return [];
    }
    const windowRecords = windows.slice(1);

    const dictionary: Array<TaskCreator | TaskActivityActor> = actors.map(actor =>
        "account" in actor
            ? actor
            : {
                  accountId: actor.accountId,
                  from:
                      actor.fromBotAccountId === null
                          ? null
                          : {type: "Bot", accountId: actor.fromBotAccountId},
              },
    );

    return windowRecords.map(bytes => {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let offset = 0;

        const startDeltaVarInt = getVarInt(view, offset);
        const startDeltaSeconds = startDeltaVarInt.value;
        offset = startDeltaVarInt.byteOffset;

        const durationVarInt = getVarInt(view, offset);
        const durationSeconds = durationVarInt.value;
        offset = durationVarInt.byteOffset;

        const activityEntryId = encodeId<TaskActivityEntryId>(bytes, offset);
        offset += idByteLength;

        const flags = view.getUint8(offset);
        offset += 1;
        let fromVersion: number | null = null;
        let toVersion: number | null = null;
        if (flags & hasVersionsFlag) {
            const fromVersionVarInt = getVarInt(view, offset);
            fromVersion = fromVersionVarInt.value;
            offset = fromVersionVarInt.byteOffset;
            const toVersionVarInt = getVarInt(view, offset);
            toVersion = toVersionVarInt.value;
            offset = toVersionVarInt.byteOffset;
        }

        const totalActorCountVarInt = getVarInt(view, offset);
        const totalActorCount = totalActorCountVarInt.value;
        offset = totalActorCountVarInt.byteOffset;

        const actorCountVarInt = getVarInt(view, offset);
        const actorCount = actorCountVarInt.value;
        offset = actorCountVarInt.byteOffset;
        const windowActors: Array<TaskCreator | TaskActivityActor | null> = [];
        for (let actorIndex = 0; actorIndex < actorCount; actorIndex++) {
            const dictionaryIndex = view.getUint8(offset);
            offset += 1;
            if (dictionaryIndex === nullActorIndex) {
                windowActors.push(null);
            } else {
                const actor = dictionary[dictionaryIndex];
                if (!actor) throw new InternalError("Window actor index out of range");
                windowActors.push(actor);
            }
        }

        // Bytes past the fields this reader knows are tolerated deliberately: it lets a
        // newer writer append fields to the record without bumping the format version.
        // Records _shorter_ than expected still fail hard — the `DataView` reads above
        // throw on out-of-range offsets.

        const firstActivityTime = new Date(baseTime.getTime() + startDeltaSeconds * 1000);
        return {
            activityEntryId,
            firstActivityTime,
            lastActivityTime: new Date(firstActivityTime.getTime() + durationSeconds * 1000),
            wasReverted: (flags & wasRevertedFlag) === wasRevertedFlag,
            fromVersion,
            toVersion,
            actors: windowActors,
            totalActorCount,
        };
    });
}

/**
 * Distinct dictionary actors the given windows would need. The engine compares
 * this against `maxActorDictionarySize` when deciding to roll to a new chunk —
 * rolling is the same path as the byte cap, so encoding never actually throws the
 * dictionary error in practice. Counts only the stored actor slice of each window,
 * matching what `encodeTaskActivityWindows()` actually puts in the dictionary — an
 * open window's uncapped in-memory actor list must not force a roll (or worse,
 * overflow a single-window chunk) on actors that would never be stored.
 */
export function countTaskActivityWindowChunkActors(
    windows: ReadonlyArray<TaskActivityWindowForActor<TaskCreator>>,
): number {
    const keys = new Set<string>();
    for (const window of windows) {
        for (const actor of window.actors.slice(0, maxStoredActorsPerWindow)) {
            if (actor !== null) keys.add(getTaskActorKey(actor));
        }
    }
    return keys.size;
}

/**
 * The DynamoDB bytes of a chunk item's window-derived attributes — the binary
 * records plus the actor dictionary — compared against the chunk cap. The
 * dictionary must be counted: it is rewritten with the item on every absorb and
 * DynamoDB bills writes by full item size, so leaving it out would let a
 * many-contributor chunk quietly grow past the write-cost budget the cap exists to
 * enforce.
 */
export function getTaskActivityWindowChunkByteLength({
    actors,
    windows,
}: {
    actors: ReadonlyArray<TaskActivityWindowChunkActor>;
    windows: ReadonlyArray<Uint8Array>;
}): number {
    const recordsByteLength = windows.reduce(
        (byteLength, record) => byteLength + record.byteLength,
        0,
    );
    const dictionaryByteLength = actors.reduce(
        (byteLength, actor) => byteLength + getDictionaryEntryByteLength(actor),
        0,
    );
    return recordsByteLength + dictionaryByteLength;
}

/**
 * Approximate DynamoDB bytes for one dictionary entry: the `accountId` and
 * `fromBotAccountId` attribute names (25 chars) plus ~3 bytes of map overhead,
 * then the id values themselves (a null bot provenance serializes as 1 byte).
 */
function getDictionaryEntryByteLength(actor: TaskActivityWindowChunkActor): number {
    return 28 + actor.accountId.length + (actor.fromBotAccountId?.length ?? 1);
}
