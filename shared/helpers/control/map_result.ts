import {Result} from "~/shared/helpers/control/result.open_source.js";

/**
 * Maps a result value. If the `action` throws then the error is thrown by
 * `mapResult()` instead of being returned as `ok: false`.
 *
 * We also have `thenResult()` which catches thrown errors and returns them as an
 * `ok: false` result instead.
 */
export function mapResult<T, U, E>(result: Result<T, E>, map: (value: T) => U): Result<U, E> {
    if (!result.ok) return result;
    const value = map(result.value);
    return {ok: true, value};
}
