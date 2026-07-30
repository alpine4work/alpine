import {IGif} from "@giphy/js-types";
import {computeGifPickerRowLayout} from "~/client/web/content/internal/compute_gif_picker_row_layout.js";

function makeGif(width: number, height: number): IGif {
    return {
        id: `${width}x${height}`,
        images: {
            fixed_width: {width, height, url: ""},
        },
    } as unknown as IGif;
}

describe("computeGifPickerRowLayout", () => {
    test("returns empty layout for empty input", () => {
        const layout = computeGifPickerRowLayout([], 400, {targetRowHeight: 100, gutter: 8});
        expect(layout).toMatchObject({items: [], containerHeight: 0});
    });

    test("returns empty layout for zero container width", () => {
        const gifs = [makeGif(200, 200)];
        const layout = computeGifPickerRowLayout(gifs, 0, {targetRowHeight: 100, gutter: 8});
        expect(layout).toMatchObject({items: [], containerHeight: 0});
    });

    test("lays out a single GIF at target row height", () => {
        const gifs = [makeGif(200, 200)];
        const layout = computeGifPickerRowLayout(gifs, 400, {targetRowHeight: 100, gutter: 8});
        expect(layout.items).toHaveLength(1);
        // Single GIF that doesn't fill the row stays at target height.
        expect(layout.items[0]).toMatchObject({
            top: 0,
            left: 0,
            row: 0,
            height: 100,
        });
    });

    test("fills a row when GIFs exceed container width", () => {
        // 4 square GIFs at 100px target height = 400px, plus 3 \* 8px gutter = 424px
        // total. Container is 400px, so the row should be finalized and items scaled down.
        const gifs = [makeGif(100, 100), makeGif(100, 100), makeGif(100, 100), makeGif(100, 100)];
        const layout = computeGifPickerRowLayout(gifs, 400, {targetRowHeight: 100, gutter: 8});

        // All 4 items should be in row 0.
        for (const item of layout.items) {
            expect(item.row).toBe(0);
        }

        // Total width should approximately fill the container.
        const totalWidth =
            layout.items.reduce((sum, item) => sum + item.width, 0) + (layout.items.length - 1) * 8;
        expect(totalWidth).toBeCloseTo(400, 0);
    });

    test("creates multiple rows", () => {
        // 8 square GIFs — should create 2 rows of 4 with 400px container and 100px target
        // height.
        const gifs = Array.from({length: 8}, () => makeGif(100, 100));
        const layout = computeGifPickerRowLayout(gifs, 400, {targetRowHeight: 100, gutter: 8});

        const rows = new Set(layout.items.map(item => item.row));
        expect(rows.size).toBe(2);
    });

    test("handles extreme aspect ratios by clamping", () => {
        // Very wide GIF (10:1 AR) should be clamped to 2.5.
        const gifs = [makeGif(1000, 100), makeGif(100, 100)];
        const layout = computeGifPickerRowLayout(gifs, 400, {targetRowHeight: 100, gutter: 8});

        expect(layout.items).toHaveLength(2);
        // The wide GIF should be wider than the square one.
        expect(layout.items[0]!.width).toBeGreaterThan(layout.items[1]!.width);
    });

    test("handles all same aspect ratio", () => {
        const gifs = Array.from({length: 6}, () => makeGif(200, 100));
        const layout = computeGifPickerRowLayout(gifs, 400, {targetRowHeight: 100, gutter: 8});

        // All items within the same row should have the same height.
        const rowHeights = new Map<number, number>();
        for (const item of layout.items) {
            const existing = rowHeights.get(item.row);
            if (existing !== undefined) {
                expect(item.height).toBeCloseTo(existing, 5);
            } else {
                rowHeights.set(item.row, item.height);
            }
        }
    });

    test("items in a filled row sum to container width within tolerance", () => {
        const gifs = [makeGif(300, 200), makeGif(200, 200), makeGif(250, 200), makeGif(150, 200)];
        const containerWidth = 400;
        const gutter = 8;
        const layout = computeGifPickerRowLayout(gifs, containerWidth, {
            targetRowHeight: 100,
            gutter,
        });

        // Group items by row.
        const rowItems = new Map<number, typeof layout.items>();
        for (const item of layout.items) {
            const row = rowItems.get(item.row) ?? [];
            // This is fine since we're building a local mutable map for testing.
            (row as Array<(typeof layout.items)[number]>).push(item);
            rowItems.set(item.row, row);
        }

        // Each full row (not the last) should fill the width.
        for (const [row, items] of rowItems) {
            if (row < Math.max(...rowItems.keys())) {
                const totalWidth =
                    items.reduce((sum, item) => sum + item.width, 0) + (items.length - 1) * gutter;
                expect(totalWidth).toBeCloseTo(containerWidth, 0);
            }
        }
    });
});
