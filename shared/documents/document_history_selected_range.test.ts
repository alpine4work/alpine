import {DocumentHistoryGroup} from "~/shared/documents/document_history_model.js";
import {getDocumentHistorySelectedRange} from "~/shared/documents/document_history_selected_range.js";

const initialVersionCreatedTime = new Date("2026-08-20T12:00:00.000Z");

const groups: ReadonlyArray<DocumentHistoryGroup> = [
    {
        startVersion: 0,
        endVersion: 4,
        startTime: initialVersionCreatedTime,
        endTime: new Date("2026-08-20T12:04:00.000Z"),
        contributors: [{id: null, from: null}],
        entries: [
            {
                startVersion: 2,
                endVersion: 4,
                startTime: new Date("2026-08-20T12:02:00.000Z"),
                endTime: new Date("2026-08-20T12:04:00.000Z"),
                contributors: [{id: null, from: null}],
            },
            {
                startVersion: 0,
                endVersion: 2,
                startTime: initialVersionCreatedTime,
                endTime: new Date("2026-08-20T12:02:00.000Z"),
                contributors: [{id: null, from: null}],
            },
        ],
    },
];

test("selects the entry that ends at a shared version boundary", () => {
    expect(
        getDocumentHistorySelectedRange({
            groups,
            version: 2,
            isGroupSelection: false,
            initialVersionCreatedTime,
        }),
    ).toEqual({
        type: "Entry",
        endVersion: 2,
        parentGroupEndVersion: 4,
        range: {startVersion: 0, endVersion: 2},
        showInitialContentAsAdditions: true,
    });
});

test("selects the entry in the older group at a shared group boundary", () => {
    const groupsAtBoundary: ReadonlyArray<DocumentHistoryGroup> = [
        {
            startVersion: 2,
            endVersion: 4,
            startTime: new Date("2026-08-20T12:02:00.000Z"),
            endTime: new Date("2026-08-20T12:04:00.000Z"),
            contributors: [{id: null, from: null}],
            entries: [
                {
                    startVersion: 3,
                    endVersion: 4,
                    startTime: new Date("2026-08-20T12:03:00.000Z"),
                    endTime: new Date("2026-08-20T12:04:00.000Z"),
                    contributors: [{id: null, from: null}],
                },
                {
                    startVersion: 2,
                    endVersion: 3,
                    startTime: new Date("2026-08-20T12:02:00.000Z"),
                    endTime: new Date("2026-08-20T12:03:00.000Z"),
                    contributors: [{id: null, from: null}],
                },
            ],
        },
        {
            startVersion: 0,
            endVersion: 2,
            startTime: initialVersionCreatedTime,
            endTime: new Date("2026-08-20T12:02:00.000Z"),
            contributors: [{id: null, from: null}],
            entries: [
                {
                    startVersion: 0,
                    endVersion: 2,
                    startTime: initialVersionCreatedTime,
                    endTime: new Date("2026-08-20T12:02:00.000Z"),
                    contributors: [{id: null, from: null}],
                },
            ],
        },
    ];

    expect(
        getDocumentHistorySelectedRange({
            groups: groupsAtBoundary,
            version: 2,
            isGroupSelection: false,
            initialVersionCreatedTime,
        }),
    ).toEqual({
        type: "Entry",
        endVersion: 2,
        parentGroupEndVersion: 2,
        range: {startVersion: 0, endVersion: 2},
        showInitialContentAsAdditions: true,
    });
});
