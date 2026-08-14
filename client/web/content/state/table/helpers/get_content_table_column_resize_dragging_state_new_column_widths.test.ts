import {getContentTableColumnResizeDraggingStateNewColumnWidths} from "~/client/web/content/state/table/helpers/get_content_table_column_resize_dragging_state_new_column_widths.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

const blockWidthPx = contentStyles.blockMaxWidthRem["desktop"] * remPxBySpacingScale["small"];

test("making last column in 4-column table larger increases table width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(942, {
            startX: 860,
            blockWidthPx,
            tableWrapperWidthPx: 968,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {tableWidth: 1, columnWidths: [1, 1, 1, 1], totalColumnWidth: 4},
            },
        }),
    ).toEqual({
        tableWidth: 1.25,
        columnWidths: [1, 1, 1, 2],
        totalColumnWidth: 5,
        scrollLeftPx: 150,
    });
});

test("making last column in 4-column table smaller decreases table width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(891, {
            startX: 935,
            blockWidthPx,
            tableWrapperWidthPx: 968,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {tableWidth: 1.25, columnWidths: [1, 1, 1, 2], totalColumnWidth: 5},
            },
        }),
    ).toEqual({
        tableWidth: 1.0833333333333335,
        columnWidths: [1, 1, 1, 1.3333333333333333],
        totalColumnWidth: 4.333333333333333,
        scrollLeftPx: -100,
    });
});

test("can make first column larger in a two column table when columns start at same width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(750, {
            startX: 706,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 0,
                oldTableMap: {tableWidth: 1.125, columnWidths: [1, 1], totalColumnWidth: 2},
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1.1851851851851851, 0.8148148148148149],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make first column larger in a two column table when columns start at different widths", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1510, {
            startX: 795,
            blockWidthPx,
            tableWrapperWidthPx: 1188,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1.3333333333333333, 0.6666666666666667],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1.4814814814814814, 0.5185185185185186],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make first column smaller in a two column table when columns start at same width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(650, {
            startX: 709,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [0.8888888888888888, 1.1111111111111112],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make second column in a two column table smaller when table width is larger than block width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(901, {
            startX: 1018,
            blockWidthPx,
            tableWrapperWidthPx: 1188,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [1, 0.7777777777777778],
        totalColumnWidth: 1.7777777777777777,
        scrollLeftPx: -75,
    });
});

test("can\u2019t make second column in a two column table smaller when table width is the same as block width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(697, {
            startX: 1043,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {tableWidth: 1, columnWidths: [1, 1], totalColumnWidth: 2},
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [1, 1],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can\u2019t make first column in a two column table smaller if it means the second column would be over the max width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(431, {
            startX: 499,
            blockWidthPx,
            tableWrapperWidthPx: 1090,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [0.8338270142180095, 1.6661729857819905],
                    totalColumnWidth: 2.5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.25,
        columnWidths: [0.8333333333333335, 1.6666666666666665],
        totalColumnWidth: 2.5,
        scrollLeftPx: 0,
    });
});

// Interior column resizing - small tables (≤ 4 columns)
test("can resize second interior column in 3-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(860, {
            startX: 817,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 1],
                    totalColumnWidth: 3,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1.1111111111111112, 0.8888888888888888],
        totalColumnWidth: 3,
        scrollLeftPx: 0,
    });
});

test("can resize third column in 4-column table when starting column widths are the same", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(920, {
            startX: 873,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 1, 1],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 1.1851851851851851, 0.8148148148148149],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("can resize third column in 4-column table when starting column widths are different", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(949, {
            startX: 926,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 0.6666666666666666, 1.666666666666667, 0.6666666666666666],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 0.6666666666666666, 1.740740740740741, 0.5925925925925926],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

// Interior column resizing - larger tables (> 4 columns)
test("can resize interior column in 5-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(610, {
            startX: 566,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.4066666666666667,
                    columnWidths: [
                        1, 0.6666666666666666, 1.6666666666666667, 1, 0.6666666666666667,
                    ],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.5524444444444445,
        columnWidths: [1, 1.1848341232227486, 1.6666666666666667, 1, 0.6666666666666667],
        totalColumnWidth: 5.518167456556083,
        scrollLeftPx: 0,
    });
});

test("can resize interior column in large table with many columns", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(810, {
            startX: 760,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 5,
                oldTableMap: {
                    tableWidth: 4.125,
                    columnWidths: [
                        1, 0.666452026121289, 1.6666666666666667, 1, 0.9996780391819333,
                        0.9996780391819334, 0.9996780391819334, 0.6666666666666667, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1, 1,
                    ],
                    totalColumnWidth: 21.998819477000424,
                },
            },
        }),
    ).toEqual({
        tableWidth: 4.187550309077414,
        columnWidths: [
            1, 0.666452026121289, 1.6666666666666667, 1, 0.9996780391819333, 1.3332617864848744,
            0.9996780391819334, 0.6666666666666667, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        totalColumnWidth: 22.332403224303363,
        scrollLeftPx: 0,
    });
});

test("cannot resize column below minimum width in a 4-column table", () => {
    // trying to resize 3rd column below min width in a 4 column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(400, {
            startX: 818,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 0.6666666666666666, 1.3333333333333335],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 0.5925925925925926, 1.4074074074074074],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("cannot resize above maximum width in a 4-column table", () => {
    // trying to resize 3rd column below min width in a 4 column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1200, {
            startX: 818,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 0.6666666666666666, 1.3333333333333335],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 1.4074074074074074, 0.5925925925925926],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("cannot resize column above maximum width in a 5-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1341, {
            startX: 804,
            blockWidthPx,
            tableWrapperWidthPx: 1003,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [1, 1, 1, 1, 1],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.8333333333333333,
        columnWidths: [1, 1, 1, 3.3333333333333335, 1],
        totalColumnWidth: 7.333333333333334,
        scrollLeftPx: 0,
    });
});

test("cannot resize column below minimum width in a 5-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(-54, {
            startX: 808,
            blockWidthPx,
            tableWrapperWidthPx: 1003,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [1, 1, 1, 1, 1],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1, 1, 0.6666666666666666, 1],
        totalColumnWidth: 4.666666666666666,
        scrollLeftPx: 0,
    });
});

test("making last column in 4-column table larger increases table width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(942, {
            startX: 860,
            blockWidthPx,
            tableWrapperWidthPx: 968,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1,
                    columnWidths: [1, 1, 1, 1],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.2733333333333334,
        columnWidths: [1, 1, 1, 2.0933333333333333],
        totalColumnWidth: 5.093333333333334,
        scrollLeftPx: 164,
    });
});

test("making last column in 4-column table smaller decreases table width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(891, {
            startX: 935,
            blockWidthPx,
            tableWrapperWidthPx: 968,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [1, 1, 1, 2],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.1033333333333335,
        columnWidths: [1, 1, 1, 1.4133333333333333],
        totalColumnWidth: 4.413333333333333,
        scrollLeftPx: -88,
    });
});

test("can make first column larger in a two column table when columns start at same width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(750, {
            startX: 706,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1.1303703703703705, 0.8696296296296295],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make first column larger in a two column table when columns start at different widths (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1510, {
            startX: 795,
            blockWidthPx,
            tableWrapperWidthPx: 1188,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1.3333333333333333, 0.6666666666666667],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1.4814814814814814, 0.5185185185185186],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make first column smaller in a two column table when columns start at same width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(650, {
            startX: 709,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [0.8251851851851851, 1.1748148148148148],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can make second column in a two column table smaller when table width is larger than block width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(901, {
            startX: 1018,
            blockWidthPx,
            tableWrapperWidthPx: 1188,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [1, 0.7777777777777778],
        totalColumnWidth: 1.7777777777777777,
        scrollLeftPx: -75,
    });
});

test("can\u2019t make second column in a two column table smaller when table width is the same as block width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(697, {
            startX: 1043,
            blockWidthPx,
            tableWrapperWidthPx: 1238,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1,
                    columnWidths: [1, 1],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [1, 1],
        totalColumnWidth: 2,
        scrollLeftPx: 0,
    });
});

test("can\u2019t make first column in a two column table smaller if it means the second column would be over the max width (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(431, {
            startX: 499,
            blockWidthPx,
            tableWrapperWidthPx: 1090,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [0.8338270142180095, 1.6661729857819905],
                    totalColumnWidth: 2.5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.25,
        columnWidths: [0.8333333333333335, 1.6666666666666665],
        totalColumnWidth: 2.5,
        scrollLeftPx: 0,
    });
});

// Interior column resizing - small tables (≤ 4 columns)
test("can resize second interior column in 3-column table (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(860, {
            startX: 817,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 1],
                    totalColumnWidth: 3,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1.191111111111111, 0.808888888888889],
        totalColumnWidth: 3,
        scrollLeftPx: 0,
    });
});

test("can resize third column in 4-column table when starting column widths are the same (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(920, {
            startX: 873,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 1, 1],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 1.2785185185185186, 0.7214814814814814],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("can resize third column in 4-column table when starting column widths are different (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(949, {
            startX: 926,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 0.6666666666666666, 1.666666666666667, 0.6666666666666666],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 0.6666666666666666, 1.740740740740741, 0.5925925925925926],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

// Interior column resizing - larger tables (> 4 columns)
test("can resize interior column in 5-column table (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(610, {
            startX: 566,
            blockWidthPx,
            tableWrapperWidthPx: 1243,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1.4066666666666667,
                    columnWidths: [
                        1, 0.6666666666666666, 1.6666666666666667, 1, 0.6666666666666667,
                    ],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.5533333333333335,
        columnWidths: [1, 1.187993680884676, 1.6666666666666667, 1, 0.6666666666666667],
        totalColumnWidth: 5.52132701421801,
        scrollLeftPx: 0,
    });
});

test("can resize interior column in large table with many columns (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(810, {
            startX: 760,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 5,
                oldTableMap: {
                    tableWidth: 4.125,
                    columnWidths: [
                        1, 0.666452026121289, 1.6666666666666667, 1, 0.9996780391819333,
                        0.9996780391819334, 0.9996780391819334, 0.6666666666666667, 1, 1, 1, 1, 1,
                        1, 1, 1, 1, 1, 1, 1, 1, 1,
                    ],
                    totalColumnWidth: 21.998819477000424,
                },
            },
        }),
    ).toEqual({
        tableWidth: 4.208333333333333,
        columnWidths: [
            1, 0.666452026121289, 1.6666666666666667, 1, 0.9996780391819333, 1.4440986346768918,
            0.9996780391819334, 0.6666666666666667, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        totalColumnWidth: 22.44324007249538,
        scrollLeftPx: 0,
    });
});

test("cannot resize column below minimum width in a 4-column table (without snapping)", () => {
    // trying to resize 3rd column below min width in a 4 column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(400, {
            startX: 818,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 0.6666666666666666, 1.3333333333333335],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 0.5925925925925926, 1.4074074074074074],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("cannot resize above maximum width in a 4-column table (without snapping)", () => {
    // trying to resize 3rd column below min width in a 4 column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1200, {
            startX: 818,
            blockWidthPx,
            tableWrapperWidthPx: 1248,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    tableWidth: 1.125,
                    columnWidths: [1, 1, 0.6666666666666666, 1.3333333333333335],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.125,
        columnWidths: [1, 1, 1.4074074074074074, 0.5925925925925926],
        totalColumnWidth: 4,
        scrollLeftPx: 0,
    });
});

test("cannot resize column above maximum width in a 5-column table (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1341, {
            startX: 804,
            blockWidthPx,
            tableWrapperWidthPx: 1003,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [1, 1, 1, 1, 1],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.8333333333333333,
        columnWidths: [1, 1, 1, 3.3333333333333335, 1],
        totalColumnWidth: 7.333333333333334,
        scrollLeftPx: 0,
    });
});

test("cannot resize column below minimum width in a 5-column table (without snapping)", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(-54, {
            startX: 808,
            blockWidthPx,
            tableWrapperWidthPx: 1003,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1.25,
                    columnWidths: [1, 1, 1, 1, 1],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1, 1, 0.6666666666666666, 1],
        totalColumnWidth: 4.666666666666666,
        scrollLeftPx: 0,
    });
});

// Scrolling behavior
test("updates scroll left when resizing causes scrolling", () => {
    // i tried to resize column which caused scrolling, in 7 col table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1417, {
            startX: 977,
            blockWidthPx,
            tableWrapperWidthPx: 1120,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 4,
                oldTableMap: {
                    tableWidth: 2.0833333333333335,
                    columnWidths: [
                        0.7782381629939827, 0.9416681772227187, 1.3930463117592282,
                        0.7711786222454865, 0.7711786222454866, 0.7711786222454865, 1,
                    ],
                    totalColumnWidth: 6.4264885187123895,
                },
            },
        }),
    ).toEqual({
        tableWidth: 2.666666666666667,
        columnWidths: [
            0.7782381629939827, 0.9416681772227187, 1.3930463117592282, 0.7711786222454865,
            2.570595407484956, 0.7711786222454865, 1,
        ],
        totalColumnWidth: 8.225905303951858,
        scrollLeftPx: 136,
    });
});

// Table width constraints
test("maintains minimum table width of 1", () => {
    // tried to resize 2 column table to smaller than tableWidth 1 failed to do so in
    // UI and in test as well
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(568, {
            startX: 939,
            blockWidthPx,
            tableWrapperWidthPx: 1120,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    tableWidth: 1,
                    columnWidths: [0.33333333333333326, 1.6666666666666663],
                    totalColumnWidth: 1.9999999999999996,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [0.33333333333333326, 1.6666666666666663],
        totalColumnWidth: 1.9999999999999996,
        scrollLeftPx: 0,
    });
});

test("resize is within 1px of the minimum table width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1139, {
            startX: 1142,
            blockWidthPx: 675,
            tableWrapperWidthPx: 1435,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    tableWidth: 1,
                    columnWidths: [
                        0.9993800324959757, 0.9993800324959757, 0.9993800324959757,
                        0.9934665411794316,
                    ],
                    totalColumnWidth: 3.991606638667359,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [
            0.9993800324959757, 0.9993800324959757, 0.9993800324959757, 0.9934665411794316,
        ],
        totalColumnWidth: 3.991606638667359,
        scrollLeftPx: 0,
    });
});
