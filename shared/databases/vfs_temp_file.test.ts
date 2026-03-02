import {VfsTempFile} from "~/shared/databases/vfs_temp_file.js";

describe("VfsTempFile", () => {
    describe("read", () => {
        test("empty file returns short read with zero-filled buffer", () => {
            const file = new VfsTempFile();
            const buf = new Uint8Array(10);
            buf.fill(0xff);
            expect(file.read(buf, 0)).toBe(false);
            expect(buf.every(b => b === 0)).toBe(true);
        });

        test("read beyond file size returns short read", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            const buf = new Uint8Array(4);
            buf.fill(0xff);
            expect(file.read(buf, 10)).toBe(false);
            expect(buf.every(b => b === 0)).toBe(true);
        });

        test("read within file size returns data", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([10, 20, 30, 40, 50]), 0);
            const buf = new Uint8Array(3);
            expect(file.read(buf, 1)).toBe(true);
            expect(buf).toEqual(new Uint8Array([20, 30, 40]));
        });

        test("read spanning past end returns partial data and zeros", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            const buf = new Uint8Array(5);
            buf.fill(0xff);
            expect(file.read(buf, 1)).toBe(false);
            expect(buf).toEqual(new Uint8Array([2, 3, 0, 0, 0]));
        });

        test("read exact file contents returns true", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([7, 8, 9]), 0);
            const buf = new Uint8Array(3);
            expect(file.read(buf, 0)).toBe(true);
            expect(buf).toEqual(new Uint8Array([7, 8, 9]));
        });
    });

    describe("write", () => {
        test("write to empty file sets size", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            expect(file.fileSize()).toBe(3);
        });

        test("write extending past current size grows file", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2]), 0);
            file.write(new Uint8Array([3, 4, 5]), 1);
            expect(file.fileSize()).toBe(4);
            const buf = new Uint8Array(4);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 3, 4, 5]));
        });

        test("write within existing data does not grow file", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3, 4, 5]), 0);
            file.write(new Uint8Array([9]), 2);
            expect(file.fileSize()).toBe(5);
            const buf = new Uint8Array(5);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 9, 4, 5]));
        });

        test("multiple writes accumulate correctly", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2]), 0);
            file.write(new Uint8Array([3, 4]), 2);
            file.write(new Uint8Array([5, 6]), 4);
            const buf = new Uint8Array(6);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 3, 4, 5, 6]));
        });

        test("write at non-zero offset leaves gap as zeros", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([42]), 5);
            expect(file.fileSize()).toBe(6);
            const buf = new Uint8Array(6);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([0, 0, 0, 0, 0, 42]));
        });
    });

    describe("truncate", () => {
        test("truncate to zero clears file", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            file.truncate(0);
            expect(file.fileSize()).toBe(0);
            const buf = new Uint8Array(3);
            expect(file.read(buf, 0)).toBe(false);
        });

        test("truncate shrink zeros old data", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3, 4, 5]), 0);
            file.truncate(2);
            expect(file.fileSize()).toBe(2);

            // Expand back and verify old data is gone.
            file.truncate(5);
            const buf = new Uint8Array(5);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 0, 0, 0]));
        });

        test("truncate expand fills new region with zeros", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2]), 0);
            file.truncate(5);
            expect(file.fileSize()).toBe(5);
            const buf = new Uint8Array(5);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 0, 0, 0]));
        });

        test("truncate to same size is a no-op", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            file.truncate(3);
            expect(file.fileSize()).toBe(3);
            const buf = new Uint8Array(3);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 3]));
        });
    });

    describe("fileSize", () => {
        test("initially zero", () => {
            expect(new VfsTempFile().fileSize()).toBe(0);
        });

        test("reflects writes", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array(100), 0);
            expect(file.fileSize()).toBe(100);
            file.write(new Uint8Array(1), 200);
            expect(file.fileSize()).toBe(201);
        });

        test("reflects truncates", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array(100), 0);
            file.truncate(50);
            expect(file.fileSize()).toBe(50);
            file.truncate(200);
            expect(file.fileSize()).toBe(200);
        });
    });

    describe("data integrity sequences", () => {
        test("write, truncate shrink, expand, read gap is zeros", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 0);
            file.truncate(3);
            file.truncate(8);

            const buf = new Uint8Array(8);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 3, 0, 0, 0, 0, 0]));
        });

        test("overwrite preserves surrounding data", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3, 4, 5]), 0);
            file.write(new Uint8Array([99]), 2);
            const buf = new Uint8Array(5);
            file.read(buf, 0);
            expect(buf).toEqual(new Uint8Array([1, 2, 99, 4, 5]));
        });

        test("large write triggers buffer growth and preserves data", () => {
            const file = new VfsTempFile();
            const data = new Uint8Array(10000);
            for (let i = 0; i < data.length; i++) {
                data[i] = i & 0xff;
            }
            file.write(data, 0);
            expect(file.fileSize()).toBe(10000);

            const buf = new Uint8Array(10000);
            expect(file.read(buf, 0)).toBe(true);
            expect(buf).toEqual(data);
        });

        test("close does not crash", () => {
            const file = new VfsTempFile();
            file.write(new Uint8Array([1, 2, 3]), 0);
            file.close();
            // No assertion — just verifying no throw.
        });

        test("sync does not crash", () => {
            const file = new VfsTempFile();
            file.sync();
        });
    });
});
