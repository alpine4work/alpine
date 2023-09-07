/**
 * Casts the provided value to some type.
 *
 * The is a type safe way to cast a value into a type unlike the `x as T`
 * expression which will work if the two types have anything in common.
 *
 * Example:
 *
 * ```ts
 * const x: string | number = 42;
 *
 * x as string; // Ok
 *
 * cast<string>(x); // Error
 * ```
 *
 * Also serves as the identity function since it always returns its argument.
 */
export function cast<Type>(value: Type): Type {
    return value;
}
