import {clamp} from "~/shared/helpers/number/clamp.open_source.js";

test("returns values inside the requested range", () => {
    expect(clamp(1, 2, 3)).toBe(2);
});

test("clamps values outside the requested range", () => {
    expect(clamp(1, -1, 3)).toBe(1);
    expect(clamp(1, 4, 3)).toBe(3);
});
