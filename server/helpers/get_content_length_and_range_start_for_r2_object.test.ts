import {getContentLengthAndRangeStartForR2Object} from "~/server/helpers/get_content_length_and_range_start_for_r2_object.js";

describe("getContentLengthAndRangeStartForR2Object", () => {
    test("treats a missing range as the full object", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 1000,
            }),
        ).toMatchObject({
            contentRange: "bytes 0-999/1000",
            contentLength: 1000,
            isRangeSatisfiable: true,
        });
    });

    test("maps a suffix range to the last N bytes", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 1000,
                range: {suffix: 100},
            }),
        ).toMatchObject({
            contentRange: "bytes 900-999/1000",
            contentLength: 100,
            isRangeSatisfiable: true,
        });
    });

    test("clamps a suffix range larger than the file to the full object", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 100,
                range: {suffix: 500},
            }),
        ).toMatchObject({
            contentRange: "bytes 0-99/100",
            contentLength: 100,
            isRangeSatisfiable: true,
        });
    });

    test("uses explicit offset and length for a byte range", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 1000,
                range: {offset: 100, length: 200},
            }),
        ).toMatchObject({
            contentRange: "bytes 100-299/1000",
            contentLength: 200,
            isRangeSatisfiable: true,
        });
    });

    test("defaults missing length to bytes from offset through end", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 1000,
                range: {offset: 250},
            }),
        ).toMatchObject({
            contentRange: "bytes 250-999/1000",
            contentLength: 750,
            isRangeSatisfiable: true,
        });
    });

    test("defaults missing offset to zero", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 500,
                range: {length: 50},
            }),
        ).toMatchObject({
            contentRange: "bytes 0-49/500",
            contentLength: 50,
            isRangeSatisfiable: true,
        });
    });

    test("marks a range as not satisfiable when offset is at or past the object size", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 100,
                range: {offset: 100, length: 1},
            }),
        ).toMatchObject({
            contentRange: "bytes */100",
            contentLength: 1,
            isRangeSatisfiable: false,
        });
    });

    test("marks a range as not satisfiable when offset plus length extends past the object", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 100,
                range: {offset: 50, length: 100},
            }),
        ).toMatchObject({
            contentRange: "bytes */100",
            contentLength: 100,
            isRangeSatisfiable: false,
        });
    });

    test("marks a range as not satisfiable when explicit length exceeds the object from offset zero", () => {
        expect(
            getContentLengthAndRangeStartForR2Object({
                size: 100,
                range: {length: 150},
            }),
        ).toMatchObject({
            contentRange: "bytes */100",
            contentLength: 150,
            isRangeSatisfiable: false,
        });
    });
});
