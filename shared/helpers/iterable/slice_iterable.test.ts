import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";

test("clamps array slices to the array length", () => {
    expect(Array.from(sliceIterable(["a", "b"], 0, 10))).toEqual(["a", "b"]);
});
