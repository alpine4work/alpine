import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Create a mapping of strings to integers. Integers are more efficient to
 * encode then strings. So if you have a fixed list of strings and encoding
 * efficiency matters, this utility may be helpful to you.
 *
 * It's generally recommended to avoid using 0 so that 0 can be reserved for
 * null values in a binary encoding.
 */
export function createEnumIntegerMapping<const Mapping extends {[key: string]: number}>(
    mapping: Mapping,
): {
    is(number: number): number is Mapping[keyof Mapping];
    assert(number: number): Mapping[keyof Mapping];
    into(string: keyof Mapping): Mapping[keyof Mapping];
    from(integer: Mapping[keyof Mapping]): keyof Mapping;
} {
    const stringByInteger = new Map<number, string>();

    for (const [string, integer] of Object.entries(mapping)) {
        assert(!stringByInteger.has(integer), "Integers must be unique");
        stringByInteger.set(integer, string);
    }

    const is = (number: number): number is Mapping[keyof Mapping] => stringByInteger.has(number);

    return {
        is,
        assert: number => {
            assert(is(number));
            return number;
        },
        into: string => mapping[string],
        from: integer => stringByInteger.get(integer)!,
    };
}
