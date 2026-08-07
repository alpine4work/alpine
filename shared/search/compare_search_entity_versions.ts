import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {
    HybridLogicalTime,
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {defaultCompareStrings} from "~/shared/helpers/string/default_compare_strings.open_source.js";
import {realmTaskTitleClientId} from "~/shared/id/realm_task_title_client_id.js";
import {TaskTitleSnapshot, decodeTaskTitleSnapshot} from "~/shared/tasks/title/task_title.js";

export function compareSearchChatEntityVersion(
    version1: number | null,
    version2: number | null,
): -1 | 0 | 1 {
    if (version1 === null) {
        if (version2 === null) return 0;
        return -1;
    }

    if (version2 === null) return 1;

    if (version1 < version2) return -1;
    if (version1 > version2) return 1;
    return 0;
}

export function compareSearchPostEntityVersions(
    version1: {version: number; channelVersion: number},
    version2: {version: number; channelVersion: number},
): -1 | 0 | 1 {
    if (version1.version > version2.version) return 1;
    if (version1.version < version2.version) return -1;

    if (version1.channelVersion > version2.channelVersion) return 1;
    if (version1.channelVersion < version2.channelVersion) return -1;

    return 0;
}

export function compareSearchTaskEntityTitleVersions(
    version1: {
        readonly titleSnapshot: TaskTitleSnapshot;
        readonly deletedTime?: HybridLogicalTime;
    },
    version2: {
        readonly titleSnapshot: TaskTitleSnapshot;
        readonly deletedTime?: HybridLogicalTime;
    },
): -1 | 0 | 1 {
    return (
        compareHybridLogicalTimes(
            version1.deletedTime ?? zeroHybridLogicalTime,
            version2.deletedTime ?? zeroHybridLogicalTime,
        ) ||
        compareTaskTitleSnapshotForSearchEntityTitleVersion(
            decodeTaskTitleSnapshot(version1.titleSnapshot),
            decodeTaskTitleSnapshot(version2.titleSnapshot),
        )
    );
}

export type TaskTitleSnapshotDeleteSet = {
    readonly clients: ReadonlyMap<
        number,
        ReadonlyArray<{readonly clock: number; readonly len: number}>
    >;
};

/**
 * Compare two Yjs CRDT snapshots from `TaskTitle`. At a low level the way a Yjs
 * CRDT works is each client has its own version number that increments on every
 * addition. This is represented by a snapshots which contains a state vector where
 * the keys are `clientId`s and the values are `version`s. Yjs CRDTs also have a
 * delete set which separately tracks deletions.
 *
 * Resolving conflicts in a Yjs CRDT is a complicated affair and can't be
 * simplified to CRDT a is newer than CRDT b yet that's exactly what we want to do
 * here since we only have the snapshot and not the full CRDT.
 *
 * If we have `snapshot1` with a state vector that looks like this:
 *
 * ```
 * {
 *     123 => 7,
 *     456 => 16,
 *     789 => 2,
 * }
 * ```
 *
 * ...and `snapshot2` with a state vector that looks like this:
 *
 * ```
 * {
 *     123 => 8,
 *     456 => 16,
 *     789 => 2,
 * }
 * ```
 *
 * We clearly know that `snapshot2` is newer than `snapshot1` since the only
 * changed key is 123.
 *
 * However, what if `snapshot2`'s state vector is:
 *
 * ```
 * {
 *     123 => 8,
 *     456 => 16,
 *     789 => 1,
 * }
 * ```
 *
 * ...or `snapshot2`'s state vector is:
 *
 * ```
 * {
 *     123 => 8,
 *     456 => 16,
 * }
 * ```
 *
 * In both these cases, key 789 is changed in addition to key 123. We know key 123
 * is newer in `snapshot2` but key 789 is older in `snapshot2`. This is where Yjs
 * steps in, saves the day, and is able to properly merge two `TaskTitle`s in this
 * state by taking some data from `snapshot1` and some data from `snapshot2`. In
 * this case, we're not merging some data from the first task title and some data
 * from the second, we want to make an educated guess and pick ONE task title we
 * think is newer than the other.
 *
 * In practice, we don't expect conflicts like this to be an issue for search
 * entity task titles. Since a search entity's state vector should always be
 * monotonically increasing because we have a centralized source of truth in
 * OpenSearch which always has the latest task title. There shouldn't be weird
 * conflicts unless we're merging with data the user is typing on their local
 * machine that hasn't been synced to the search index yet.
 */
export function compareTaskTitleSnapshotForSearchEntityTitleVersion(
    snapshot1: {
        readonly sv: ReadonlyMap<number, number>;
        readonly ds: TaskTitleSnapshotDeleteSet;
    },
    snapshot2: {
        readonly sv: ReadonlyMap<number, number>;
        readonly ds: TaskTitleSnapshotDeleteSet;
    },
): -1 | 0 | 1 {
    return (
        compareTaskTitleStateVectorForSearchEntityTitleVersion(snapshot1.sv, snapshot2.sv) ||
        compareTaskTitleDeleteSetForSearchEntityTitleVersion(snapshot1.ds, snapshot2.ds)
    );
}

function compareTaskTitleStateVectorForSearchEntityTitleVersion(
    stateVector1: ReadonlyMap<number, number>,
    stateVector2: ReadonlyMap<number, number>,
): -1 | 0 | 1 {
    const mismatches: Array<{
        clientId: number;
        version1: number | undefined;
        version2: number | undefined;
        maxVersion: number;
    }> = [];

    for (const [clientId, version1] of stateVector1) {
        const version2 = stateVector2.get(clientId);
        if (version1 === version2) continue;

        mismatches.push({
            clientId,
            version1,
            version2,
            maxVersion: version2 !== undefined && version2 > version1 ? version2 : version1,
        });
    }

    for (const [clientId, version2] of stateVector2) {
        const version1 = stateVector1.get(clientId);
        if (version1 !== undefined) continue;

        mismatches.push({
            clientId,
            version1,
            version2,
            maxVersion: version2,
        });
    }

    if (mismatches.length === 0) return 0;

    mismatches.sort(
        (mismatch1, mismatch2) =>
            // Sort mismatches from our realm's client last. If we have a mismatch from our
            // realm's client then this is the one we should use. In theory this should have
            // the best UX in offline mode since if the user is typing while offline on stale
            // data we always let their update win here.
            (mismatch1.clientId === realmTaskTitleClientId.get() ? 1 : 0) -
                (mismatch2.clientId === realmTaskTitleClientId.get() ? 1 : 0) ||
            // Sort mismatches with a larger `maxVersion` last.
            mismatch1.maxVersion - mismatch2.maxVersion ||
            // Sort mismatches with a larger `clientId` last.
            mismatch1.clientId - mismatch2.clientId,
    );

    const mismatch = mismatches[mismatches.length - 1]!;

    if (mismatch.version1 === undefined) {
        if (mismatch.version2 === undefined) return 0;
        return -1;
    }

    if (mismatch.version2 === undefined) return 1;

    if (mismatch.version1 < mismatch.version2) return -1;
    if (mismatch.version1 > mismatch.version2) return 1;
    return 0;
}

function compareTaskTitleDeleteSetForSearchEntityTitleVersion(
    deleteSet1: TaskTitleSnapshotDeleteSet,
    deleteSet2: TaskTitleSnapshotDeleteSet,
): -1 | 0 | 1 {
    const mismatches: Array<{
        clientId: number;
        deleteCount1: number;
        deleteCount2: number;
        deleteItems1String: string;
        deleteItems2String: string;
    }> = [];

    for (const [clientId, deleteItems1] of deleteSet1.clients) {
        const deleteItems1String = JSON.stringify(
            deleteItems1.map(deleteItem => [deleteItem.clock, deleteItem.len]),
        );

        const deleteItems2 = deleteSet2.clients.get(clientId) ?? emptyArray;
        const deleteItems2String = JSON.stringify(
            deleteItems2.map(deleteItem => [deleteItem.clock, deleteItem.len]),
        );

        if (deleteItems1String === deleteItems2String) continue;

        let deleteCount1 = 0;
        for (const deleteItem of deleteItems1) {
            deleteCount1 += deleteItem.len;
        }

        let deleteCount2 = 0;
        for (const deleteItem of deleteItems2) {
            deleteCount2 += deleteItem.len;
        }

        mismatches.push({
            clientId,
            deleteCount1,
            deleteCount2,
            deleteItems1String,
            deleteItems2String,
        });
    }

    for (const [clientId, deleteItems2] of deleteSet2.clients) {
        const deleteItems1 = deleteSet1.clients.get(clientId);
        if (deleteItems1 !== undefined) continue;

        const deleteItems1String = JSON.stringify(emptyArray);

        const deleteItems2String = JSON.stringify(
            deleteItems2.map(deleteItem => [deleteItem.clock, deleteItem.len]),
        );

        const deleteCount1 = 0;

        let deleteCount2 = 0;
        for (const deleteItem of deleteItems2) {
            deleteCount2 += deleteItem.len;
        }

        mismatches.push({
            clientId,
            deleteCount1,
            deleteCount2,
            deleteItems1String,
            deleteItems2String,
        });
    }

    if (mismatches.length === 0) return 0;

    mismatches.sort(
        (mismatch1, mismatch2) =>
            // Sort mismatches from our realm's client last. If we have a mismatch from our
            // realm's client then this is the one we should use. In theory this should have
            // the best UX in offline mode since if the user is typing while offline on stale
            // data we always let their update win here.
            (mismatch1.clientId === realmTaskTitleClientId.get() ? 1 : 0) -
                (mismatch2.clientId === realmTaskTitleClientId.get() ? 1 : 0) ||
            // Sort mismatches with a larger max delete count last.
            Math.max(mismatch1.deleteCount1, mismatch1.deleteCount2) -
                Math.max(mismatch2.deleteCount1, mismatch2.deleteCount2) ||
            // Sort mismatches with a larger `clientId` last.
            mismatch1.clientId - mismatch2.clientId,
    );

    const mismatch = mismatches[mismatches.length - 1]!;

    if (mismatch.deleteCount1 < mismatch.deleteCount2) return -1;
    if (mismatch.deleteCount1 > mismatch.deleteCount2) return 1;

    return defaultCompareStrings(mismatch.deleteItems1String, mismatch.deleteItems2String);
}
