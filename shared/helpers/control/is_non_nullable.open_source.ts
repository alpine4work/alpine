/**
 * Is the provided value not null? Implemented as
 * `value !== undefined && value !== null`.
 *
 * Useful as a helper function because of it's type signature. You can pass it to
 * `array.filter(isNonNullable)`, for instance, and automatically get the correct
 * type without having to write annotations yourself.
 */
export function isNonNullable<T>(value: T | undefined | null): value is T {
    return value !== undefined && value !== null;
}
