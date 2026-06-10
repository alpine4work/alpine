/* eslint-disable cyberworlds/string-quotes */
import {isIfRangeConditionSatisfied} from "~/server/helpers/is_if_range_condition_satisfied.js";

const etag = '"abc123"';
const uploaded = new Date("2026-01-01T00:00:00.000Z");
const object = {httpEtag: etag, uploaded};

describe("isIfRangeConditionSatisfied", () => {
    describe("ETag validators", () => {
        test("returns true when ETag matches exactly", () => {
            expect(isIfRangeConditionSatisfied(object, '"abc123"')).toBe(true);
        });

        test("returns false when ETag does not match", () => {
            expect(isIfRangeConditionSatisfied(object, '"different"')).toBe(false);
        });

        test("returns false for a weak ETag even if the opaque part matches", () => {
            expect(isIfRangeConditionSatisfied(object, 'W/"abc123"')).toBe(false);
        });
    });

    describe("HTTP-date validators", () => {
        test("returns true when the date matches the upload time to the second", () => {
            expect(isIfRangeConditionSatisfied(object, "Thu, 01 Jan 2026 00:00:00 GMT")).toBe(true);
        });

        test("returns false when the date is before the upload time", () => {
            expect(isIfRangeConditionSatisfied(object, "Wed, 31 Dec 2025 23:59:59 GMT")).toBe(
                false,
            );
        });

        test("returns false when the date is after the upload time", () => {
            expect(isIfRangeConditionSatisfied(object, "Thu, 01 Jan 2026 00:00:01 GMT")).toBe(
                false,
            );
        });

        test("returns false for an unparseable date", () => {
            expect(isIfRangeConditionSatisfied(object, "not-a-date")).toBe(false);
        });
    });
});
