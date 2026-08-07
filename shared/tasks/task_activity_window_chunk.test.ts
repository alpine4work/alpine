import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, TaskActivityEntryId} from "~/shared/id/types/id_types.open_source.js";
import {
    TaskActivityWindowForActor,
    decodeTaskActivityWindows,
    encodeTaskActivityWindows,
    getTaskActivityWindowChunkByteLength,
    maxStoredActorsPerWindow,
    taskActivityWindowFormatVersion,
} from "~/shared/tasks/task_activity_window_chunk.js";
import {TaskCreator} from "~/shared/tasks/task_creator.js";

const rachel = {accountId: generateId<AccountId>(), from: null} as const;
const agentBot = {
    accountId: generateId<AccountId>(),
    from: {type: "Bot", accountId: generateId<AccountId>()},
} as const;

function window(
    overrides: Partial<TaskActivityWindowForActor<TaskCreator>>,
): TaskActivityWindowForActor<TaskCreator> {
    const base = {
        activityEntryId: generateChronologicalId<TaskActivityEntryId>(),
        firstActivityTime: new Date("2026-07-01T12:00:00.000Z"),
        lastActivityTime: new Date("2026-07-01T12:04:30.000Z"),
        wasReverted: false,
        fromVersion: 4,
        toVersion: 9,
        actors: [rachel] as ReadonlyArray<typeof rachel | typeof agentBot | null>,
        ...overrides,
    };
    return {...base, totalActorCount: overrides.totalActorCount ?? base.actors.length};
}

test("windows round-trip through the binary chunk encoding", async () => {
    const windows = [
        window({actors: [rachel, agentBot, null]}),
        window({
            firstActivityTime: new Date("2026-07-08T09:30:00.000Z"),
            lastActivityTime: new Date("2026-07-08T09:41:00.000Z"),
            wasReverted: true,
            fromVersion: 9,
            toVersion: 9,
            actors: [agentBot],
        }),
        // A title crash-recovery fallback window with no attributed versions.
        window({fromVersion: null, toVersion: null, actors: [null]}),
    ];

    const baseTime = windows[0]!.firstActivityTime;
    const encoded = encodeTaskActivityWindows(windows, baseTime);

    expect(
        decodeTaskActivityWindows({
            baseTime,
            ...encoded,
        }),
    ).toEqual(windows);
});

test("a chunk of typical windows stays small", async () => {
    const windows = Array.from({length: 32}, (unused, index) =>
        window({
            firstActivityTime: new Date(Date.parse("2026-07-01T12:00:00.000Z") + index * 3600000),
            lastActivityTime: new Date(
                Date.parse("2026-07-01T12:00:00.000Z") + index * 3600000 + 600000,
            ),
            fromVersion: index * 7,
            toVersion: index * 7 + 7,
            actors: [rachel, agentBot],
        }),
    );

    // ~26 bytes per window record plus ~135 bytes for the two-entry actor dictionary —
    // comfortably inside `taskActivityWindowChunkMaxByteLength`.
    expect(
        getTaskActivityWindowChunkByteLength(
            encodeTaskActivityWindows(windows, windows[0]!.firstActivityTime),
        ),
    ).toBeLessThan(1200);
});

test("only stored actors enter the chunk\u2019s actor dictionary", async () => {
    const manyActors = Array.from({length: 12}, () => ({
        accountId: generateId<AccountId>(),
        from: null,
    }));

    const encoded = encodeTaskActivityWindows(
        [window({actors: manyActors})],
        new Date("2026-07-01T12:00:00.000Z"),
    );

    expect(encoded.actors).toHaveLength(maxStoredActorsPerWindow);
});

test("windows with more actors than the stored cap round-trip the total count", async () => {
    const manyActors = Array.from({length: 12}, () => ({
        accountId: generateId<AccountId>(),
        from: null,
    }));
    const windows = [window({actors: manyActors})];

    const baseTime = windows[0]!.firstActivityTime;
    const decoded = decodeTaskActivityWindows({
        baseTime,
        ...encodeTaskActivityWindows(windows, baseTime),
    });

    expect(decoded[0]).toMatchObject({
        actors: manyActors.slice(0, maxStoredActorsPerWindow),
        totalActorCount: 12,
    });
});

test("an unknown window format version decodes to no windows", async () => {
    const windows = [window({})];

    const baseTime = windows[0]!.firstActivityTime;
    const encoded = encodeTaskActivityWindows(windows, baseTime);
    expect(
        decodeTaskActivityWindows({
            baseTime,
            actors: encoded.actors,
            // A newer writer's header, with records this reader can't interpret.
            windows: [
                new Uint8Array([taskActivityWindowFormatVersion + 1]),
                ...encoded.windows.slice(1),
            ],
        }),
    ).toEqual([]);
});

test("a chunk with no format header decodes to no windows", async () => {
    const windows = [window({})];

    const baseTime = windows[0]!.firstActivityTime;
    expect(decodeTaskActivityWindows({baseTime, actors: [], windows: []})).toEqual([]);
});

test("trailing record bytes from a newer writer are tolerated", async () => {
    const windows = [window({})];

    const baseTime = windows[0]!.firstActivityTime;
    const encoded = encodeTaskActivityWindows(windows, baseTime);
    expect(
        decodeTaskActivityWindows({
            baseTime,
            actors: encoded.actors,
            // A newer writer appended a field this reader doesn't know about.
            windows: [
                assertExists(encoded.windows[0]),
                ...encoded.windows.slice(1).map(record => new Uint8Array([...record, 0x2a])),
            ],
        }),
    ).toEqual(windows);
});
