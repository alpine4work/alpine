import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * Tests if two ranges overlap at all.
 */
// Implementation from:
// https://stackoverflow.com/questions/3269434/whats-the-most-efficient-way-to-test-if-two-ranges-overlap
export function areRangesOverlapping(start1: number, end1: number, start2: number, end2: number) {
    assert(start1 <= end1);
    assert(start2 <= end2);
    return start1 <= end2 && end1 >= start2;
}
