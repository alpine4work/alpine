import {Result} from "~/shared/helpers/control/result.open_source.js";

/**
 * Maps a result value. If the `action` throws then the error is returned as a new
 * result.
 *
 * We call this `thenResult()` instead of `mapResult()` since it resembles a
 * promise in that if an error is thrown the result is flattened. `mapResult()`s
 * signature would look more like:
 * `<T, E, U>(result: Result<T, E>, mapValue: (value: T) => U, mapError: (error: E) => U) => U`.
 * You can see how Haskell and [Rust][1] name operators on their result types.
 *
 * [1]: https://doc.rust-lang.org/std/result/
 */
export function thenResult<T, U>(result: Result<T>, action: (value: T) => U): Result<U> {
    if (!result.ok) return result;

    try {
        const value = action(result.value);
        return {ok: true, value};
    } catch (error) {
        return {ok: false, error};
    }
}
