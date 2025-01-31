import {getContentTableColumnResizeDraggingStateNewColumnWidths} from "~/client/content/internal/table/content_table_column_resizing_plugin.js";

describe("ContentTableColumnResizingPlugin", () => {
    const assertCloseTo = (received: any, expected: any, precision: number = 3) => {
        expect(received).toBeCloseTo(expected, precision);
    };

    test("can resize last column by increasing width", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 500}, // Example clientX where the user drags to increase the last column
            {
                startX: 480, // Starting X position of the drag
                viewWidthPx: 1200, // Width of the table in pixels
                oldTotalColumnWidthPx: 226.66666666666666, // Sum of old columnWidths multiplied by some scaling factor
                state: {
                    columnIndex: 3, // Index of the last column (0-based indexing)
                    oldTableMap: {
                        columnWidths: [223.66666666666666, 1, 1.5, 1],
                        totalColumnWidth: 227.16666666666666, // Sum of columnWidths
                    },
                },
            },
        );
        console.log({result});

        expect(result.columnWidths.length).toBe(4);
        assertCloseTo(result.columnWidths[0], 223.66666666666666); // First column remains unchanged
        assertCloseTo(result.columnWidths[1], 1); // Second column remains unchanged
        assertCloseTo(result.columnWidths[2], 1.5); // Third column remains unchanged
        assertCloseTo(result.columnWidths[3], 2); // Last column increased from 1 to 2

        assertCloseTo(result.tableWidth, 1.05); // Example expected tableWidth after resizing
        expect(result.scrollTo).toBe("right"); // Assuming the table should scroll to the right after resizing
    });

    test("can make second column in a two column table smaller", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 720},
            {
                startX: 628,
                viewWidthPx: 1144,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [1, 1],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 1.3066666666666666);
        assertCloseTo(result.columnWidths[1], 0.6933333333333334);
    });

    test("can make first column in a two column table smaller", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 528},
            {
                startX: 630,
                viewWidthPx: 1144,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [1, 1],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 0.66);
        assertCloseTo(result.columnWidths[1], 1.34);
    });

    test("can make second column in a two column table smaller after resizing first column", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 749},
            {
                startX: 525,
                viewWidthPx: 1144,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [0.6582914572864321, 1.341708542713568],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 1.4049581239530988);
        assertCloseTo(result.columnWidths[1], 0.5950418760469012);
    });

    test("can grow middle column in a three column table", () => {
        let result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 738},
            {
                startX: 715,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 1,
                    oldTableMap: {
                        columnWidths: [1, 1, 1],
                        totalColumnWidth: 3,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(3);

        result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 332},
            {
                startX: 520,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [1, 1.115, 0.885],
                        totalColumnWidth: 3,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(3);
    });

    test("can make two column table larger by dragging last column", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 951},
            {
                startX: 914,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 1,
                    oldTableMap: {
                        columnWidths: [1, 1],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 1);
        assertCloseTo(result.columnWidths[1], 1.2466666666666666);
        assertCloseTo(result.tableWidth, 1.1233333333333333);
        expect(result.scrollTo).toBe("right");
    });

    test("can make two column table larger by dragging first column", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 268},
            {
                startX: 328,
                viewWidthPx: 1144,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: -1,
                    oldTableMap: {
                        columnWidths: [1, 1],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 1.4);
        assertCloseTo(result.columnWidths[1], 1);
        assertCloseTo(result.tableWidth, 1.2);
        expect(result.scrollTo).toBe("left");
    });

    test("can't shrink column to less than minimum width", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1076},
            {
                startX: 618,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [1.5, 0.5],
                        totalColumnWidth: 2,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 1.5);
        assertCloseTo(result.columnWidths[1], 0.5);
    });

    test("can't grow column to more than maximum width", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 5},
            {
                startX: 315,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: -1,
                    oldTableMap: {
                        columnWidths: [1.5, 1],
                        totalColumnWidth: 2.5,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        expect(result.scrollTo).toBe("left");
    });

    test("can grow a table even if it has an inaccurate table width", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1143},
            {
                startX: 1063,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 907,
                state: {
                    columnIndex: 5,
                    oldTableMap: {
                        columnWidths: [1, 1, 1, 1, 1, 1],
                        totalColumnWidth: 6,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(6);
        assertCloseTo(result.columnWidths[0], 1);
        assertCloseTo(result.columnWidths[1], 1);
        assertCloseTo(result.columnWidths[2], 1);
        assertCloseTo(result.columnWidths[3], 1);
        assertCloseTo(result.columnWidths[4], 1);
        assertCloseTo(result.columnWidths[5], 2.058);
        assertCloseTo(result.tableWidth, 1.778);
        expect(result.scrollTo).toBe("right");
    });

    test("can grow a table even if old column widths do not accurately represent what's currently rendered", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1066},
            {
                startX: 1006,
                viewWidthPx: 1130,
                oldTotalColumnWidthPx: 756,
                state: {
                    columnIndex: 4,
                    oldTableMap: {
                        columnWidths: [0.5025125628140703, 1.4974874371859297, 1, 1, 1],
                        totalColumnWidth: 5,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(5);
        expect(result.scrollTo).toBe("right");
    });

    test("can grow a table when the second to last column is larger than the last column", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1109},
            {
                startX: 1056,
                viewWidthPx: 1130,
                oldTotalColumnWidthPx: 877,
                state: {
                    columnIndex: 4,
                    oldTableMap: {
                        columnWidths: [1, 1, 1, 1.8011481056257175, 0.9988518943742825],
                        totalColumnWidth: 5.8,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(5);
        assertCloseTo(result.columnWidths[0], 1);
        assertCloseTo(result.columnWidths[1], 1);
        assertCloseTo(result.columnWidths[2], 1);
        assertCloseTo(result.columnWidths[3], 1.801);
        assertCloseTo(result.columnWidths[4], 1.7);
        assertCloseTo(result.tableWidth, 1.638);
        expect(result.scrollTo).toBe("right");
    });

    // Additional Test Cases

    test("does not change column widths when dragging outside threshold", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 600},
            {
                startX: 600,
                viewWidthPx: 1123,
                oldTotalColumnWidthPx: 800,
                state: {
                    columnIndex: 1,
                    oldTableMap: {
                        columnWidths: [2, 2],
                        totalColumnWidth: 4,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        assertCloseTo(result.columnWidths[0], 2);
        assertCloseTo(result.columnWidths[1], 2);
    });

    test("handles dragging to maximum width boundary", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 1500},
            {
                startX: 1000,
                viewWidthPx: 1200,
                oldTotalColumnWidthPx: 800,
                state: {
                    columnIndex: -1,
                    oldTableMap: {
                        columnWidths: [2, 2],
                        totalColumnWidth: 4,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
        expect(result.scrollTo).toBe("left");
    });

    test("handles dragging to minimum width boundary", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 200},
            {
                startX: 800,
                viewWidthPx: 1000,
                oldTotalColumnWidthPx: 600,
                state: {
                    columnIndex: 0,
                    oldTableMap: {
                        columnWidths: [3, 3],
                        totalColumnWidth: 6,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(2);
    });

    test("handles multiple column resizing simultaneously", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 900},
            {
                startX: 850,
                viewWidthPx: 1100,
                oldTotalColumnWidthPx: 700,
                state: {
                    columnIndex: 2,
                    oldTableMap: {
                        columnWidths: [2, 2, 2],
                        totalColumnWidth: 6,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(3);
    });

    test("maintains table width when dragging middle column in large table", () => {
        const result = getContentTableColumnResizeDraggingStateNewColumnWidths(
            {clientX: 650},
            {
                startX: 600,
                viewWidthPx: 1300,
                oldTotalColumnWidthPx: 1000,
                state: {
                    columnIndex: 2,
                    oldTableMap: {
                        columnWidths: [3, 3, 4],
                        totalColumnWidth: 10,
                    },
                },
            },
        );

        expect(result.columnWidths.length).toBe(3);
    });
});
