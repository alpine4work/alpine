/**
 * Is the provided value not null? Implemented as
 * `value !== undefined && value !== null && value !== false`.
 *
 * Useful as a helper function because of it's type signature. You can pass it to
 * `array.filter(isNonNullableOrFalse)`, for instance, and automatically get the
 * correct type without having to write annotations yourself.
 */
export function isNonNullableOrFalse<T>(value: T | undefined | null | false): value is T {
    return value !== undefined && value !== null && value !== false;
}
