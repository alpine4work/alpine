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
                    oldTableWidth: 1,
                    columnIndex: 0,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({tableWidth: 1, columnWidths: [1.3082077051926297, 0.6917922948073703]});
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
                    oldTableWidth: 1,
                    columnIndex: 0,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({tableWidth: 1, columnWidths: [0.6582914572864321, 1.341708542713568]});
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
                    oldTableWidth: 1,
                    columnIndex: 0,
                    oldColumnWidths: [0.6582914572864321, 1.341708542713568],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({tableWidth: 1, columnWidths: [1.4087102177554438, 0.5912897822445562]});
});

test("can grow middle column in a three column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 800},
            {
                startX: 728,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    oldTableWidth: 1,
                    columnIndex: 1,
                    oldColumnWidths: [1, 1, 1],
                    oldTotalColumnWidth: 3,
                },
            },
        ),
    ).toEqual({tableWidth: 1, columnWidths: [1, 1.36241610738255, 0.63758389261745]});

    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 487},
            {
                startX: 529,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    oldTableWidth: 1,
                    columnIndex: 0,
                    oldColumnWidths: [1, 1.36241610738255, 0.63758389261745],
                    oldTotalColumnWidth: 3,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [0.7885906040268456, 1.5738255033557045, 0.63758389261745],
    });
});

test("can make two column table larger by dragging last column", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1019},
            {
                startX: 928,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    oldTableWidth: 1,
                    columnIndex: 1,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.2989949748743719,
        columnWidths: [1, 1.5979899497487438],
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
                    oldTableWidth: 1,
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
            {clientX: 1077},
            {
                startX: 627,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    oldTableWidth: 1,
                    columnIndex: 0,
                    oldColumnWidths: [1, 1],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({tableWidth: 1, columnWidths: [1.5979899497487438, 0.4020100502512563]});
});

test("can't grow column to more than maximum width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 5},
            {
                startX: 331,
                viewWidthPx: 1144,
                oldTableWidthPx: 600,
                state: {
                    oldTableWidth: 1,
                    columnIndex: -1,
                    oldColumnWidths: [1.4338358458961473, 0.5661641541038527],
                    oldTotalColumnWidth: 2,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.082077051926298,
        columnWidths: [1.5979899497487438, 0.5661641541038527],
        scrollTo: "left",
    });
});

test("can grow a table even if it has an inaccurate table width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1118},
            {
                startX: 1051,
                viewWidthPx: 1144,
                oldTableWidthPx: 848,
                state: {
                    oldTableWidth: 1,
                    columnIndex: 6,
                    oldColumnWidths: [1, 1, 1, 1, 1, 1, 1],
                    oldTotalColumnWidth: 7,
                },
            },
        ),
    ).toEqual({
        tableWidth: 1.638793650793651,
        columnWidths: [1, 1, 1, 1, 1, 1, 2.1166666666666667],
        scrollTo: "right",
    });
});
