import {assert} from "~/shared/helpers/control/assert.open_source.js";

/**
 * A `ReadonlyArray<T>` that is not empty.
 */
export type NonEmptyReadonlyArray<T> = readonly [T, ...ReadonlyArray<T>];

export function isNonEmptyReadonlyArray<T>(
    array: ReadonlyArray<T>,
): array is NonEmptyReadonlyArray<T> {
    return array.length > 0;
}

export function assertNonEmptyReadonlyArray<T>(array: ReadonlyArray<T>): NonEmptyReadonlyArray<T> {
    assert(array.length > 0);
    return array as NonEmptyReadonlyArray<T>;
}
