import {shuffleArray} from "~/shared/helpers/array/shuffle_array.js";
import {realmTaskTitleClientId} from "~/shared/id/realm_task_title_client_id.js";
import {
    TaskTitleSnapshotDeleteSet,
    compareTaskTitleSnapshotForSearchEntityTitleVersion,
} from "~/shared/search/compare_search_entity_versions.js";

test("can compare task title snapshots", () => {
    expect(
        compareTaskTitleSnapshotForSearchEntityTitleVersion(
            {
                sv: new Map([
                    [123, 7],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
            {
                sv: new Map([
                    [123, 7],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
        ),
    ).toEqual(0);

    expect(
        compareTaskTitleSnapshotForSearchEntityTitleVersion(
            {
                sv: new Map([
                    [123, 7],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
            {
                sv: new Map([
                    [123, 8],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
        ),
    ).toEqual(-1);

    expect(
        compareTaskTitleSnapshotForSearchEntityTitleVersion(
            {
                sv: new Map([
                    [123, 8],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
            {
                sv: new Map([
                    [123, 7],
                    [456, 16],
                    [789, 2],
                ]),
                ds: {clients: new Map()},
            },
        ),
    ).toEqual(1);

    const snapshots: Array<{sv: Map<number, number>; ds: TaskTitleSnapshotDeleteSet}> = [
        {sv: new Map(), ds: {clients: new Map()}},
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([[456, [{clock: 2, len: 1}]]]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [
                        123,
                        [
                            {clock: 0, len: 1},
                            {clock: 3, len: 1},
                        ],
                    ],
                    [
                        456,
                        [
                            {clock: 2, len: 2},
                            {clock: 10, len: 3},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [
                        456,
                        [
                            {clock: 2, len: 3},
                            {clock: 10, len: 2},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [123, [{clock: 0, len: 2}]],
                    [
                        456,
                        [
                            {clock: 2, len: 3},
                            {clock: 10, len: 2},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([[456, [{clock: 2, len: 5}]]]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [
                        456,
                        [
                            {clock: 2, len: 3},
                            {clock: 10, len: 3},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [123, [{clock: 0, len: 7}]],
                    [
                        456,
                        [
                            {clock: 2, len: 1},
                            {clock: 10, len: 1},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [123, [{clock: 0, len: 7}]],
                    [
                        456,
                        [
                            {clock: 2, len: 1},
                            {clock: 10, len: 2},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [123, [{clock: 0, len: 7}]],
                    [
                        realmTaskTitleClientId.get(),
                        [
                            {clock: 2, len: 1},
                            {clock: 10, len: 1},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 8],
                [456, 16],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [123, 8],
                [456, 16],
                [789, 1],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [123, 8],
                [456, 16],
                [789, 2],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [123, 8],
                [456, 16],
                [789, 2],
            ]),
            ds: {
                clients: new Map([
                    [
                        456,
                        [
                            {clock: 2, len: 3},
                            {clock: 10, len: 2},
                        ],
                    ],
                ]),
            },
        },
        {
            sv: new Map([
                [123, 8],
                [456, 16],
                [realmTaskTitleClientId.get(), 1],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [456, 16],
                [realmTaskTitleClientId.get(), 2],
            ]),
            ds: {clients: new Map()},
        },
        {
            sv: new Map([
                [123, 7],
                [456, 16],
                [realmTaskTitleClientId.get(), 2],
            ]),
            ds: {clients: new Map()},
        },
    ];

    for (let i = 0; i < 100; i++) {
        const shuffledSnapshots = shuffleArray([...snapshots]).sort(
            compareTaskTitleSnapshotForSearchEntityTitleVersion,
        );

        expect(shuffledSnapshots).toEqual(snapshots);
    }
});
