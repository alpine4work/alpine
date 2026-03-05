import {assert} from "~/shared/helpers/control/assert.js";

test("adds an inferred error message", () => {
    expect(() => {
        const value: number = 3;
        assert(value === 2);
    }).toThrow("Assertion failure: `value === 2`");
});

test("adds an inferred error message that spans multiple lines", () => {
    function superLongComplicatedFunctionCallWithMultipleLongVariables(
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        variable1: unknown,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        variable2: unknown,
    ) {
        return null;
    }

    expect(() => {
        assert(
            superLongComplicatedFunctionCallWithMultipleLongVariables(
                42,
                superLongComplicatedFunctionCallWithMultipleLongVariables("a", "b"),
            ),
        );
    }).toThrow(
        // eslint-disable-next-line cyberworlds/string-quotes
        'Assertion failure: `superLongComplicatedFunctionCallWithMultipleLongVariables(42, superLongComplicatedFunctionCallWithMultipleLongVariables("a", "b"))`',
    );
});
