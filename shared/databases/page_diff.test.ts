import {
    applyPageDiff,
    diffPage,
    shouldIgnorePageInvalidation,
} from "~/shared/databases/page_diff.js";
import {sqlitePageSize} from "~/shared/databases/sqlite_constants.js";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";

function makePage(size: number, fill = 0): Uint8Array {
    const page = new Uint8Array(size);
    page.fill(fill);
    return page;
}

describe("diffPage", () => {
    test("identical pages produce empty diff", () => {
        const page = makePage(64, 0xaa);
        expect(diffPage(page, page)).toEqual([]);
    });

    test("single byte change produces one span of length 1", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[10] = 0xff;

        const diff = diffPage(before, after);

        expect(diff).toEqual([{offset: 10, data: new Uint8Array([0xff])}]);
    });

    test("contiguous changed region produces one span", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[4] = 1;
        after[5] = 2;
        after[6] = 3;

        const diff = diffPage(before, after);

        expect(diff).toEqual([{offset: 4, data: new Uint8Array([1, 2, 3])}]);
    });

    test("two distant changed regions produce two spans", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[2] = 0xaa;
        // Gap of 20 bytes (> 8) between changes.
        after[23] = 0xbb;

        const diff = diffPage(before, after);

        expect(diff).toHaveLength(2);
        expect(diff[0]).toEqual({offset: 2, data: new Uint8Array([0xaa])});
        expect(diff[1]).toEqual({offset: 23, data: new Uint8Array([0xbb])});
    });

    test("regions separated by <= 8 unchanged bytes are merged", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[10] = 0xaa;
        // Gap of exactly 8 bytes (indices 11-18 unchanged).
        after[19] = 0xbb;

        const diff = diffPage(before, after);

        expect(diff).toHaveLength(1);
        expect(diff[0]!.offset).toBe(10);
        expect(diff[0]!.data.length).toBe(10);
        expect(diff[0]!.data[0]).toBe(0xaa);
        expect(diff[0]!.data[9]).toBe(0xbb);
    });

    test("regions separated by > 8 unchanged bytes are not merged", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[10] = 0xaa;
        // Gap of 9 bytes (indices 11-19 unchanged).
        after[20] = 0xbb;

        const diff = diffPage(before, after);

        expect(diff).toHaveLength(2);
    });

    test("full page change produces one span", () => {
        const before = makePage(32);
        const after = makePage(32, 0xff);

        const diff = diffPage(before, after);

        expect(diff).toHaveLength(1);
        expect(diff[0]!.offset).toBe(0);
        expect(diff[0]!.data.length).toBe(32);
    });

    test("change at end of page", () => {
        const before = makePage(64);
        const after = makePage(64);
        after[63] = 0xfe;

        const diff = diffPage(before, after);

        expect(diff).toEqual([{offset: 63, data: new Uint8Array([0xfe])}]);
    });

    test("asserts buffers are same length", () => {
        expect(() => diffPage(makePage(32), makePage(64))).toThrow("same length");
    });
});

describe("applyPageDiff", () => {
    test("empty diff returns base unchanged", () => {
        const base = makePage(64, 0xaa);

        const result = applyPageDiff(base, []);

        expect(areUint8ArraysEqual(result, base)).toBe(true);
    });

    test("does not mutate base", () => {
        const base = makePage(64);
        const original = new Uint8Array(base);

        applyPageDiff(base, [{offset: 0, data: new Uint8Array([0xff])}]);

        expect(areUint8ArraysEqual(base, original)).toBe(true);
    });

    test("applies single span", () => {
        const base = makePage(64);
        const result = applyPageDiff(base, [{offset: 5, data: new Uint8Array([1, 2, 3])}]);

        expect(result[4]).toBe(0);
        expect(result[5]).toBe(1);
        expect(result[6]).toBe(2);
        expect(result[7]).toBe(3);
        expect(result[8]).toBe(0);
    });
});

describe("shouldIgnorePageInvalidation", () => {
    test("non-page-0 is never ignored", () => {
        expect(shouldIgnorePageInvalidation(1, [])).toBe(false);
        expect(shouldIgnorePageInvalidation(5, [])).toBe(false);
    });

    test("page 0 with empty diff is ignored", () => {
        expect(shouldIgnorePageInvalidation(0, [])).toBe(true);
    });

    test("page 0 with only change counter at offset 24 is ignored", () => {
        const diff = [{offset: 24, data: new Uint8Array([1, 2, 3, 4])}];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(true);
    });

    test("page 0 with only change counter at offset 92 is ignored", () => {
        const diff = [{offset: 92, data: new Uint8Array([5, 6, 7, 8])}];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(true);
    });

    test("page 0 with both change counters is ignored", () => {
        const diff = [
            {offset: 24, data: new Uint8Array([1, 2, 3, 4])},
            {offset: 92, data: new Uint8Array([5, 6, 7, 8])},
        ];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(true);
    });

    test("page 0 with partial change counter is ignored", () => {
        // Only 2 of the 4 bytes changed at offset 24
        const diff = [{offset: 24, data: new Uint8Array([1, 2])}];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(true);
    });

    test("page 0 with change counter + other data is not ignored", () => {
        const diff = [
            {offset: 24, data: new Uint8Array([1, 2, 3, 4])},
            {offset: 200, data: new Uint8Array([0xff])},
        ];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(false);
    });

    test("page 0 with span extending past change counter is not ignored", () => {
        // 5 bytes starting at 24 extends past the 4-byte region
        const diff = [{offset: 24, data: new Uint8Array([1, 2, 3, 4, 5])}];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(false);
    });

    test("page 0 with span starting before change counter is not ignored", () => {
        const diff = [{offset: 23, data: new Uint8Array([1, 2, 3, 4])}];
        expect(shouldIgnorePageInvalidation(0, diff)).toBe(false);
    });
});

describe("round-trip", () => {
    test("applyPageDiff(before, diffPage(before, after)) equals after", () => {
        const before = makePage(sqlitePageSize);
        const after = new Uint8Array(sqlitePageSize);

        // Scatter some changes across the page.
        after.set(before);
        after[0] = 0x01;
        after[100] = 0x42;
        after[101] = 0x43;
        after[2000] = 0xff;
        after[4095] = 0xfe;

        const diff = diffPage(before, after);
        const reconstructed = applyPageDiff(before, diff);

        expect(areUint8ArraysEqual(reconstructed, after)).toBe(true);
    });

    test("round-trip with random data", () => {
        const before = new Uint8Array(sqlitePageSize);
        const after = new Uint8Array(sqlitePageSize);
        // Pseudo-random fill using a simple LCG.
        let seed = 12345;
        for (let i = 0; i < sqlitePageSize; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            before[i] = seed & 0xff;
        }
        for (let i = 0; i < sqlitePageSize; i++) {
            seed = (seed * 1103515245 + 12345) & 0x7fffffff;
            after[i] = seed & 0xff;
        }

        const diff = diffPage(before, after);
        const reconstructed = applyPageDiff(before, diff);

        expect(areUint8ArraysEqual(reconstructed, after)).toBe(true);
    });
});
