import {
    computeFileRowLayout,
    computeFileRowWidths,
    fileRowBlockWidthPxForServerAndClipboard,
} from "~/shared/content/compute_file_row_widths.js";
import {
    contentFileMinSizeRem,
    contentFileRowGapWidthRem,
} from "~/shared/design/core/content_shared_styles.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";

const containerWidth = fileRowBlockWidthPxForServerAndClipboard;
const gapWidth = contentFileRowGapWidthRem * remPxBySpacingScale.small;
const minElementWidth = contentFileMinSizeRem * remPxBySpacingScale.small;

function sumWidths(widths: Array<number>): number {
    return Math.round(widths.reduce((sum, w) => sum + w, 0) * 1000000) / 1000000;
}

test("single square file fills the row", () => {
    const widths = computeFileRowWidths([{width: 500, height: 500}], {containerWidth});
    expect(widths).toEqual([1]);
});

test("single wide file fills the row", () => {
    const widths = computeFileRowWidths([{width: 2000, height: 500}], {containerWidth});
    expect(widths).toEqual([1]);
});

test("single tall file fills the row", () => {
    const widths = computeFileRowWidths([{width: 500, height: 2000}], {containerWidth});
    expect(widths).toEqual([1]);
});

test("two equal square files split evenly", () => {
    const widths = computeFileRowWidths(
        [
            {width: 500, height: 500},
            {width: 500, height: 500},
        ],
        {containerWidth},
    );
    expect(widths).toEqual([0.5, 0.5]);
    expect(sumWidths(widths)).toBe(1);
});

test("two files with different aspect ratios", () => {
    const widths = computeFileRowWidths(
        [
            {width: 1000, height: 500},
            {width: 500, height: 500},
        ],
        {containerWidth},
    );
    // The wider file should get more space.
    expect(widths[0]!).toBeGreaterThan(widths[1]!);
    expect(sumWidths(widths)).toBe(1);
});

test("three equal files split evenly", () => {
    const widths = computeFileRowWidths(
        [
            {width: 500, height: 500},
            {width: 500, height: 500},
            {width: 500, height: 500},
        ],
        {containerWidth},
    );
    expect(widths[0]).toBeCloseTo(0.333333, 4);
    expect(widths[1]).toBeCloseTo(0.333333, 4);
    expect(widths[2]).toBeCloseTo(0.333333, 4);
    expect(sumWidths(widths)).toBeCloseTo(1, 4);
});

test("wide file next to tall file", () => {
    const widths = computeFileRowWidths(
        [
            {width: 2000, height: 500},
            {width: 500, height: 2000},
        ],
        {containerWidth},
    );
    // Wide file should be much wider than the tall one.
    expect(widths[0]!).toBeGreaterThan(widths[1]!);
    expect(sumWidths(widths)).toBe(1);
});

test("files with null width assume fair share", () => {
    const widths = computeFileRowWidths(
        [
            {width: null, height: 500},
            {width: null, height: 500},
        ],
        {containerWidth},
    );
    expect(widths).toEqual([0.5, 0.5]);
});

test("mixed known and unknown widths", () => {
    const widths = computeFileRowWidths(
        [
            {width: 1000, height: 500},
            {width: null, height: 500},
        ],
        {containerWidth},
    );
    expect(sumWidths(widths)).toBe(1);
});

test("extreme aspect ratios are clamped in multi-file rows", () => {
    const widths = computeFileRowWidths(
        [
            {width: 10000, height: 100},
            {width: 100, height: 10000},
        ],
        {containerWidth},
    );
    // Neither should dominate entirely due to aspect ratio clamping.
    expect(widths[0]!).toBeLessThan(0.95);
    expect(widths[1]!).toBeGreaterThan(0.05);
    expect(sumWidths(widths)).toBe(1);
});

test("phone screenshot next to standard photo", () => {
    const widths = computeFileRowWidths(
        [
            {width: 828, height: 1792},
            {width: 3992, height: 2992},
        ],
        {containerWidth},
    );
    // Standard photo is wider, should get more space.
    expect(widths[0]!).toBeLessThan(widths[1]!);
    expect(sumWidths(widths)).toBe(1);
});

test("three files: standard, tall, wide", () => {
    const widths = computeFileRowWidths(
        [
            {width: 3992, height: 2992},
            {width: 5339, height: 7118},
            {width: 4096, height: 1716},
        ],
        {containerWidth},
    );
    // Wide file should be widest, tall should be narrowest.
    expect(widths[2]!).toBeGreaterThan(widths[0]!);
    expect(widths[0]!).toBeGreaterThan(widths[1]!);
    expect(sumWidths(widths)).toBe(1);
});

// computeFileRowLayout tests

test("layout: all files share the same height", () => {
    const layouts = computeFileRowLayout(
        [
            {width: 1000, height: 500},
            {width: 500, height: 800},
            {width: 300, height: 300},
        ],
        {containerWidth, spacingScale: "small"},
    );
    expect(layouts[0]!.height).toBe(layouts[1]!.height);
    expect(layouts[1]!.height).toBe(layouts[2]!.height);
});

test("layout: widths sum to container width", () => {
    const layouts = computeFileRowLayout(
        [
            {width: 1000, height: 500},
            {width: 500, height: 500},
        ],
        {containerWidth, spacingScale: "small"},
    );
    expect(layouts[0]!.width + gapWidth + layouts[1]!.width).toBeCloseTo(containerWidth, 0);
});

test("layout: respects min height from shared styles", () => {
    const layouts = computeFileRowLayout([{width: 1000, height: 100}], {
        containerWidth,
        spacingScale: "small",
    });
    expect(layouts[0]!.height).toBeGreaterThanOrEqual(minElementWidth);
});

test("layout: respects max height", () => {
    const layouts = computeFileRowLayout([{width: 100, height: 5000}], {
        containerWidth,
        spacingScale: "small",
        maxHeight: 400,
    });
    expect(layouts[0]!.height).toBeLessThanOrEqual(400);
});

test("layout: widthFr sums to ~1", () => {
    const layouts = computeFileRowLayout(
        [
            {width: 1000, height: 500},
            {width: 500, height: 800},
        ],
        {containerWidth, spacingScale: "small"},
    );
    const totalFr = layouts[0]!.widthFr + layouts[1]!.widthFr;
    expect(totalFr).toBeCloseTo(1, 2);
});

test("layout: underfills when container is too narrow for min element widths", () => {
    // Use a very small container that can't fit two files at minElementWidth.
    const narrowContainer = minElementWidth * 1.5;
    const layouts = computeFileRowLayout(
        [
            {width: 100, height: 100},
            {width: 100, height: 100},
        ],
        {containerWidth: narrowContainer, spacingScale: "small"},
    );
    // Each file is at least minElementWidth even though they don't fit in the
    // container.
    expect(layouts[0]!.width).toBeGreaterThanOrEqual(minElementWidth - 1);
    expect(layouts[1]!.width).toBeGreaterThanOrEqual(minElementWidth - 1);
});
