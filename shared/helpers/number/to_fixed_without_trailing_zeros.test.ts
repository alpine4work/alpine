import {toFixedWithoutTrailingZeros} from "~/shared/helpers/number/to_fixed_without_trailing_zeros.open_source.js";

test.each([
    [1, 3, "1"],
    [1.2, 3, "1.2"],
    [1.23, 3, "1.23"],
    [1.234, 3, "1.234"],
    [1.235, 2, "1.24"],
    [0, 3, "0"],
    [-1.2, 3, "-1.2"],
    [1.6, 0, "2"],
    [-1.6, 0, "-2"],
    [12.3456, 3, "12.346"],
    [-12.3456, 3, "-12.346"],
    [0.0001, 4, "0.0001"],
    [0.0001, 3, "0"],
    [999.999, 2, "1000"],
    [123_456_789.5, 2, "123456789.5"],
    [Number.POSITIVE_INFINITY, 3, "Infinity"],
    [Number.NaN, 3, "NaN"],
])(
    // eslint-disable-next-line cyberworlds/string-quotes
    'toFixedWithoutTrailingZeros(%s, %s) => "%s"',
    (value, fractionDigits, expected) => {
        expect(toFixedWithoutTrailingZeros(value, fractionDigits)).toBe(expected);
    },
);
