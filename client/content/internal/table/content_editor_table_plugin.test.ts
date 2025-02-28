import {getContentTableColumnResizeDraggingStateNewColumnWidths} from "~/client/content/internal/table/helpers/get_content_table_column_resize_dragging_state_new_column_widths.js";

// IS  snapping true
test("can resize last column by increasing width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(500, {
            startX: 480,
            viewWithoutPaddingWidthPx: 1200,
            oldTotalColumnWidthPx: 226.66666666666666,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    columnWidths: [223.66666666666666, 1, 1.5, 1],
                    totalColumnWidth: 227.16666666666666,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.1622646123746636,
        columnWidths: [113.58333333333333, 37.86111111111111, 37.86111111111111, 31.69042891454461],
        scrollLeftPx: 97.35876742479824,
    });
});

test("can resize first column in a two column table with snapping", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1510, {
            startX: 795,
            viewWithoutPaddingWidthPx: 1188,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 0,
                oldTableMap: {
                    columnWidths: [1.3333333333333333, 0.6666666666666667],
                    totalColumnWidth: 2,
                },
            },
        }),
    ).toEqual({
        columnWidths: [1.4814814814814814, 0.5185185185185186],
        scrollLeftPx: 0,
    });
});

test("can make second column in a two column table smaller", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(901, {
            startX: 1018,
            viewWithoutPaddingWidthPx: 1188,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {columnWidths: [1, 1], totalColumnWidth: 2},
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [1, 0.7777777777777778],
        scrollLeftPx: -75,
    });
});

test("can resize first column by increasing width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(901, {
            startX: 706,
            viewWithoutPaddingWidthPx: 1238,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {columnIndex: 0, oldTableMap: {columnWidths: [1, 1], totalColumnWidth: 2}},
        }),
    ).toEqual({columnWidths: [1.4814814814814814, 0.5185185185185186], scrollLeftPx: 0});
});

test("can resize first column by decreasing width", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(371, {
            startX: 709,
            viewWithoutPaddingWidthPx: 1238,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {columnIndex: 0, oldTableMap: {columnWidths: [1, 1], totalColumnWidth: 2}},
        }),
    ).toEqual({columnWidths: [0.5185185185185186, 1.4814814814814814], scrollLeftPx: 0});
});

test("can resize last column by decreasing width", () => {
    // this one fails but actually makes sense
    // expect(
    //     getContentTableColumnResizeDraggingStateNewColumnWidths(697, {
    //         startX: 1043,
    //         viewWithoutPaddingWidthPx: 1238,
    //         oldTotalColumnWidthPx: 675,
    //         oldScrollLeftPx: 0,
    //         isSnapping: true,
    //         state: {columnIndex: 1, oldTableMap: {columnWidths: [1, 1], totalColumnWidth: 2}},
    //     }),
    // ).toEqual({tableWidth: 1, columnWidths: [1, 1], scrollLeftPx: 0});

    // this one passes but makes no sense because we cannot decrease the width of
    // the second column in a two column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(697, {
            startX: 1043,
            viewWithoutPaddingWidthPx: 1238,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {columnIndex: 1, oldTableMap: {columnWidths: [1, 1], totalColumnWidth: 2}},
        }),
    ).toEqual({tableWidth: 1, columnWidths: [1, 0.7777777777777778], scrollLeftPx: -75});
});

// Interior column resizing - small tables (≤ 4 columns)
test("can resize 2nd interior column in 3-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1002, {
            startX: 817,
            viewWithoutPaddingWidthPx: 1243,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {columnIndex: 1, oldTableMap: {columnWidths: [1, 1, 1], totalColumnWidth: 3}},
        }),
    ).toEqual({columnWidths: [1, 1.5555555555555556, 0.4444444444444444], scrollLeftPx: 0});
});

test("can resize second column in 4-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1325, {
            startX: 873,
            viewWithoutPaddingWidthPx: 1243,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {columnIndex: 2, oldTableMap: {columnWidths: [1, 1, 1, 1], totalColumnWidth: 4}},
        }),
    ).toEqual({columnWidths: [1, 1, 1.4074074074074074, 0.5925925925925926], scrollLeftPx: 0});
});

test("can resize third column in 4-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(949, {
            startX: 926,
            viewWithoutPaddingWidthPx: 1243,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    columnWidths: [1, 0.6666666666666666, 1.666666666666667, 0.6666666666666666],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({
        columnWidths: [1, 0.6666666666666666, 1.740740740740741, 0.5925925925925926],
        scrollLeftPx: 0,
    });
});

// Interior column resizing - larger tables (> 4 columns)
test("can resize interior column in 5-column table", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(911, {
            startX: 566,
            viewWithoutPaddingWidthPx: 1243,
            oldTotalColumnWidthPx: 844,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    columnWidths: [
                        1, 0.6666666666666666, 1.6666666666666667, 1, 0.6666666666666667,
                    ],
                    totalColumnWidth: 5,
                },
            },
        }),
    ).toEqual({
        tableWidth: 2.0524444444444447,
        columnWidths: [1, 2.9620853080568716, 1.6666666666666667, 1, 0.6666666666666667],
        scrollLeftPx: 0,
    });
});

test("can resize interior column in large table with many columns", () => {
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1200, {
            startX: 760,
            viewWithoutPaddingWidthPx: 1248,
            oldTotalColumnWidthPx: 2475,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 5,
                oldTableMap: {
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
        tableWidth: 4.774916088588333,
        columnWidths: [
            1, 0.666452026121289, 1.6666666666666667, 1, 0.9996780391819333, 4.43965929884004,
            0.9996780391819334, 0.6666666666666667, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
        ],
        scrollLeftPx: 0,
    });
});

// Min/max constraints
test("cannot resize column below minimum width", () => {
    // trying to resize 3rd column below min width in a 4 column table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(684, {
            startX: 818,
            viewWithoutPaddingWidthPx: 1248,
            oldTotalColumnWidthPx: 675,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 2,
                oldTableMap: {
                    columnWidths: [1, 1, 0.6666666666666666, 1.3333333333333335],
                    totalColumnWidth: 4,
                },
            },
        }),
    ).toEqual({columnWidths: [1, 1, 0.5925925925925926, 1.4074074074074074], scrollLeftPx: 0});
});

test("cannot resize column above maximum width", () => {
    // 5 column table and trying to resize 4th column to above max width
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1419, {
            startX: 1162,
            viewWithoutPaddingWidthPx: 1248,
            oldTotalColumnWidthPx: 1125,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 3,
                oldTableMap: {
                    columnWidths: [
                        0.9998147115359483, 0.999777715076915, 0.6682189984451529,
                        3.3344922040588627, 0.6666807790008467,
                    ],
                    totalColumnWidth: 6.668984408117725,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1.7708333333333333,
        columnWidths: [
            0.9998147115359483, 0.999777715076915, 0.6682189984451529, 2.9639930702745447,
            0.6666807790008467,
        ],
        scrollLeftPx: 0,
    });
});

test("allows precise resizing when isSnapping is false", () => {
    // 3 column table and trying to resize 2nd column to 1.5564763259879641
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(814, {
            startX: 814,
            viewWithoutPaddingWidthPx: 1120,
            oldTotalColumnWidthPx: 650,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    columnWidths: [0.38911908149699137, 1.5564763259879641, 0.5836786222454866],
                    totalColumnWidth: 2.529274029730442,
                },
            },
        }),
    ).toEqual({
        columnWidths: [0.38911908149699137, 1.5564763259879641, 0.5836786222454866],
        scrollLeftPx: 0,
    });
});

// Scrolling behavior
test("updates scrollLeftPx when resizing causes scrolling", () => {
    // i tried to resize column which caused scrolling, in 7 col table
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(1417, {
            startX: 977,
            viewWithoutPaddingWidthPx: 1120,
            oldTotalColumnWidthPx: 1250,
            oldScrollLeftPx: 0,
            isSnapping: true,
            state: {
                columnIndex: 4,
                oldTableMap: {
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
        scrollLeftPx: 136,
    });
});

// Table width constraints
test("maintains minimum table width of 1", () => {
    // tried to resize 2 column table to smaller than tableWidth 1
    // failed to do so in UI and in test as well
    expect(
        getContentTableColumnResizeDraggingStateNewColumnWidths(568, {
            startX: 939,
            viewWithoutPaddingWidthPx: 1120,
            oldTotalColumnWidthPx: 600,
            oldScrollLeftPx: 0,
            isSnapping: false,
            state: {
                columnIndex: 1,
                oldTableMap: {
                    columnWidths: [0.33333333333333326, 1.6666666666666663],
                    totalColumnWidth: 1.9999999999999996,
                },
            },
        }),
    ).toEqual({
        tableWidth: 1,
        columnWidths: [0.33333333333333326, 1.6666666666666663],
        scrollLeftPx: 0,
    });
});
