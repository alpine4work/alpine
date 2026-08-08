import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

test("adds an inferred error message", () => {
    expect(() => {
        const value: string | null = null;
        assertExists(value);
    }).toThrow("Assertion failure: `value`");
});
