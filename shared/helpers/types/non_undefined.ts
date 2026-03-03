/**
 * Remove `undefined` from a type.
 *
 * Different from `NonNullable<Value>` which removes both `null` and `undefined`.
 */
export type NonUndefined<Value> = Value extends undefined ? never : Value;
