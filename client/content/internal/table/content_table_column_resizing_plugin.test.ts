import {getContentTableColumnResizeDraggingStateNewColumnWidths} from "~/client/content/internal/table/content_table_column_resizing_plugin.js";

test("can make second column in a two column table smaller", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 720},
            {
                startX: 628,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        columnWidths: [1.3082077051926297, 0.6917922948073703],
    });
});

test("can make first column in a two column table smaller", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 528},
            {
                startX: 630,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        columnWidths: [0.6582914572864321, 1.341708542713568],
    });
});

test("can make second column in a two column table smaller after resizing first column", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 749},
            {
                startX: 525,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldColumnWidths: [0.6582914572864321, 1.341708542713568],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        columnWidths: [1.4087102177554438, 0.5912897822445562],
    });
});

test("can grow middle column in a three column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 738},
            {
                startX: 715,
                viewWidthPx: 1123,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: 1,
                    oldColumnWidths: [1, 1, 1],
                    oldTotalColumnWidth: 3,
                },
            },
        ),
    ).toEqual({
        columnWidths: [1, 1.1157718120805369, 0.8842281879194631],
    });

    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 332},
            {
                startX: 520,
                viewWidthPx: 1123,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldColumnWidths: [1, 1.1157718120805369, 0.8842281879194631],
                    oldTotalColumnWidth: 3,
                },
            },
        ),
    ).toEqual({
        columnWidths: [0.7550335570469799, 1.3607382550335567, 0.8842281879194631],
    });
});

test("can make two column table larger by dragging last column", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 951},
            {
                startX: 914,
                viewWidthPx: 1123,
                oldTableWidthPx: 600,
                state: {columnIndex: 1, oldColumnWidths: [1, 1], oldTotalColumnWidth: 2},
            },
        ),
    ).toEqual({
        tableWidth: 1.1239530988274706,
        columnWidths: [1, 1.2479061976549413],
        scrollTo: "right",
    });
});

test("can make two column table larger by dragging first column", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 268},
            {
                startX: 328,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    columnIndex: -1,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.2010050251256281,
        columnWidths: [1.4020100502512562, 1],
        scrollTo: "left",
    });
});

test("can't shrink column to less than minimum width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1076},
            {
                startX: 618,
                viewWidthPx: 1123,
                oldTableWidthPx: 600,
                state: {columnIndex: 0, oldColumnWidths: [1, 1], oldTotalColumnWidth: 2},
            },
        ),
    ).toEqual({
        columnWidths: [1.4974874371859297, 0.5025125628140703],
    });
});

test("can't grow column to more than maximum width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 5},
            {
                startX: 315,
                viewWidthPx: 1123,
                oldTableWidthPx: 600,
                state: {columnIndex: -1, oldColumnWidths: [1, 1], oldTotalColumnWidth: 2},
            },
        ),
    ).toEqual({
        tableWidth: 1.2487437185929648,
        columnWidths: [1.4974874371859297, 1],
        scrollTo: "left",
    });
});

test("can grow a table even if it has an inaccurate table width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1143},
            {
                startX: 1063,
                viewWidthPx: 1123,
                oldTableWidthPx: 907,
                state: {
                    columnIndex: 5,
                    oldColumnWidths: [1, 1, 1, 1, 1, 1],
                    oldTotalColumnWidth: 6,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.7804074074074074,
        columnWidths: [1, 1, 1, 1, 1, 2.066666666666667],
        scrollTo: "right",
    });
});

test("can grow a table even if old column widths do not accurately represent what's currently rendered", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1066},
            {
                startX: 1006,
                viewWidthPx: 1130,
                oldTableWidthPx: 756,
                state: {
                    columnIndex: 4,
                    oldColumnWidths: [0.5025125628140703, 1.4974874371859297, 1, 1, 1],
                    oldTotalColumnWidth: 5,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.4616,
        columnWidths: [1, 1, 1, 1, 1.8],
        scrollTo: "right",
    });
});

test("can grow a table when the second to last column is larger than the last column", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1109},
            {
                startX: 1056,
                viewWidthPx: 1130,
                oldTableWidthPx: 877,
                state: {
                    columnIndex: 4,
                    oldColumnWidths: [1, 1, 1, 1.8011481056257175, 0.9988518943742825],
                    oldTotalColumnWidth: 5.8,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.6395503252965942,
        columnWidths: [1, 1, 1, 1.8011481056257175, 1.704707233065442],
        scrollTo: "right",
    });
});
