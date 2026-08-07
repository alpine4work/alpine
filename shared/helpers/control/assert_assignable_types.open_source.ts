// We wrap the types in arrays to prevent distributive union behavior.
type Extends<Type1, Type2> = [Type1] extends [Type2] ? true : false;

type MismatchArgs<Test> = Test extends true ? [] : [never];

type Not<Test> = Test extends true ? false : true;

/**
 * Tests that `Type1` is assignable to `Type2`. If `Type1` is not assignable you
 * will get a type error but not a runtime error. This function does nothing at
 * runtime.
 *
 * Useful for forcing a developer to update a piece of code when updating the
 * corresponding type. Or for explicitly declaring a type-level invariant.
 *
 * This implementation is based off the [`expect-type`][1] package.
 *
 * [1]: https://github.com/mmkal/expect-type/tree/main
 */
export function assertAssignableTypes<Type1, Type2>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...MISMATCH: MismatchArgs<Extends<Type1, Type2>>
): void {
    // Does nothing at runtime
}

/**
 * Tests that `Type1` is NOT assignable to `Type2`. If `Type1` is assignable to
 * `Type2` you will get a type error but not a runtime error. This function does
 * nothing at runtime.
 *
 * Inverse of `assertAssignableTypes()`. See documentation on that function for
 * more information.
 */
export function assertNotAssignableTypes<Type1, Type2>(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    ...MISMATCH: MismatchArgs<Not<Extends<Type1, Type2>>>
): void {
    // Does nothing at runtime
}
