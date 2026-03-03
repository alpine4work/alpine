// We wrap the types in arrays to prevent distributive union behavior.
type Equals<Type1, Type2> = [Type1] extends [Type2]
    ? [Type2] extends [Type1]
        ? true
        : false
    : false;

type MismatchArgs<Test> = Test extends true ? [] : [never];

/**
 * Tests that two types are equal to each other. If they are not equal you will get
 * a type error but not a runtime error. This function does nothing at runtime.
 *
 * Useful for forcing a developer to update a piece of code when updating the
 * corresponding type. Or for explicitly declaring a type-level invariant.
 *
 * This implementation is based off the [`expect-type`][1] package.
 *
 * [1]: https://github.com/mmkal/expect-type/tree/main
 */
export function assertEqualTypes<Type1, Type2>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...MISMATCH: MismatchArgs<Equals<Type1, Type2>>
): void {
    // Does nothing at runtime
}
