import {resolveContentTableColumnWidthPxWithoutCacheForTest} from "~/client/web/content/state/table/helpers/resolve_content_table_column_width_px.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.open_source.js";
import {SpacingScale, remPxBySpacingScale} from "~/shared/design/core/spacing_scale.open_source.js";
import {CommitBlocker} from "~/shared/helpers/types/commit_blocker.js";

const testCases: Array<{
    only?: CommitBlocker;
    columnWidths: Array<number>;
    columnWidthPxs: Array<number>;
    tableWidth?: number;
    actualTableWidth?: number;
}> = [
    {
        columnWidths: [1, 1],
        columnWidthPxs: [300, 300],
    },
    {
        columnWidths: [1, 1, 1],
        columnWidthPxs: [200, 200, 200],
    },
    {
        columnWidths: [1, 1, 1, 1],
        columnWidthPxs: [150, 150, 150, 150],
    },
    {
        tableWidth: 1.25,
        columnWidths: [1, 1, 1, 1, 1],
        columnWidthPxs: [150, 150, 150, 150, 150],
    },
    {
        tableWidth: 1.5,
        columnWidths: [1, 1, 1, 1, 1, 1],
        columnWidthPxs: [150, 150, 150, 150, 150, 150],
    },
    {
        tableWidth: 1.75,
        columnWidths: [1, 1, 1, 1, 1, 1, 1],
        columnWidthPxs: [150, 150, 150, 150, 150, 150, 150],
    },
    {
        tableWidth: 2,
        columnWidths: [1, 1, 1, 1, 1, 1, 1, 1],
        columnWidthPxs: [150, 150, 150, 150, 150, 150, 150, 150],
    },
    {
        columnWidths: [1.6666666666666667, 0.3333333333333333],
        columnWidthPxs: [500, 100],
    },
    {
        columnWidths: [0.3333333333333333, 1.6666666666666667],
        columnWidthPxs: [100, 500],
    },
    {
        columnWidths: [1.8, 0.2],
        columnWidthPxs: [500, 100],
    },
    {
        columnWidths: [0.2, 1.8],
        columnWidthPxs: [100, 500],
    },
    {
        columnWidths: [0.1, 1.9],
        columnWidthPxs: [100, 500],
    },
    {
        columnWidths: [0.6666666666666666, 1.3333333333333335],
        columnWidthPxs: [199.99999999999994, 400.00000000000006],
    },
    {
        columnWidths: [0.6666666666666666, 1.3333333333333335, 1],
        columnWidthPxs: [133.33333333333331, 266.6666666666667, 200],
    },
    {
        tableWidth: 1.5833333333333335,
        columnWidths: [
            0.9999999999999996, 1.6666666666666663, 1.3333333333333333, 0.6666666666666665,
            1.6666666666666665,
        ],
        columnWidthPxs: [
            150.00000000000003, 250.00000000000003, 200.00000000000003, 100, 250.00000000000006,
        ],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1, 1, 0.6666666666666666, 1],
        columnWidthPxs: [150, 150, 150, 100.00000000000001, 150],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 1, 1, 3.333333333333333, 1],
        columnWidthPxs: [
            150.00000000000003, 150.00000000000003, 150.00000000000003, 499.99999999999994,
            150.00000000000003,
        ],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1, 1, 0.3, 1],
        columnWidthPxs: [
            149.99999999999997, 149.99999999999997, 149.99999999999997, 100, 149.99999999999997,
        ],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 1, 1, 6, 1],
        columnWidthPxs: [150, 150, 150, 500, 150],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1, 1, 1e-10, 1],
        columnWidthPxs: [150, 150, 150, 100, 150],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 1, 1, 1e10, 1],
        columnWidthPxs: [150, 150, 150, 500, 150],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 0.15, 1, 0.3, 1],
        columnWidthPxs: [166.66666666666666, 100, 166.66666666666666, 100, 166.66666666666669],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 12, 1, 6, 1],
        columnWidthPxs: [100, 485.71428571428567, 100, 314.2857142857143, 100],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 6, 1, 0.3, 1],
        columnWidthPxs: [100, 300, 100, 100, 100],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 0.45, 1, 0.3, 1],
        columnWidthPxs: [166.66666666666669, 100, 166.66666666666669, 100, 166.66666666666669],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 0.45, 1, 6, 1],
        columnWidthPxs: [166.66666666666663, 100, 166.66666666666663, 500, 166.66666666666663],
    },
    {
        tableWidth: 1.1666666666666667,
        columnWidths: [1, 1.5, 1, 0.3, 1],
        columnWidthPxs: [
            145.83333333333334, 162.49999999999994, 145.83333333333334, 100, 145.83333333333334,
        ],
    },
    {
        tableWidth: 1.8333333333333335,
        columnWidths: [1, 1.5, 1, 6, 1],
        columnWidthPxs: [
            147.6190476190476, 157.14285714285714, 147.6190476190476, 500, 147.6190476190476,
        ],
    },
    {
        tableWidth: 1,
        columnWidths: [1, 1, 1, 1, 1, 1, 1, 1, 1],
        columnWidthPxs: [100, 100, 100, 100, 100, 100, 100, 100, 100],
        actualTableWidth: 1.5,
    },
];

for (const testCase of testCases) {
    const test = testCase.only ? globalThis.test.only : globalThis.test;

    test(`column widths = [${testCase.columnWidths.join(", ")}], table width = ${
        testCase.tableWidth ?? 1
    }`, () => {
        let totalColumnWidth = 0;
        for (const columnWidth of testCase.columnWidths) totalColumnWidth += columnWidth;

        const platform: Platform = "desktop";
        const spacingScale: SpacingScale = "small";
        const remPx = remPxBySpacingScale[spacingScale];
        const blockWidthPx = contentStyles.blockMaxWidthRem[platform] * remPx;

        const columnWidthPxs = resolveContentTableColumnWidthPxWithoutCacheForTest(
            totalColumnWidth,
            testCase.columnWidths,
            testCase.tableWidth ?? 1,
            blockWidthPx,
            contentStyles.tableColumnMinWidthRem * remPx,
            contentStyles.tableColumnMaxWidthRem * remPx,
        );

        expect(columnWidthPxs).toEqual(testCase.columnWidthPxs);

        expect(columnWidthPxs.reduce((a, b) => a + b, 0) / blockWidthPx).toBeCloseTo(
            testCase.actualTableWidth ?? testCase.tableWidth ?? 1,
            10,
        );
    });
}
