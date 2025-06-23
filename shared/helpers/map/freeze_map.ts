import {InternalError} from "~/shared/error/error.js";

function cantUpdateFrozenMap(): never {
    throw new InternalError("Can’t update frozen map");
}

/**
 * Freeze a `Map`. Calling `Object.freeze()` on a map won't work since you'll
 * still be able to call `set()`, `delete()`, and `clear()` to modify the map.
 *
 * This function isn't perfect. You can still call
 * `Map.prototype.set.call(supposedlyFrozenMap, key, value)` to modify a map.
 * Freezing is best effort and meant to stop accidental modifications but we
 * can't perfectly prevent all modifications. As a codebase convention, if we
 * don't use `Map.prototype.set.call()` then this workaround shouldn't be an
 * issue in practice.
 */
export function freezeMap<Key, Value>(map: Map<Key, Value>): ReadonlyMap<Key, Value> {
    if (!Object.isFrozen(map)) {
        map.set = cantUpdateFrozenMap;
        map.delete = cantUpdateFrozenMap;
        map.clear = cantUpdateFrozenMap;
    }

    Object.freeze(map);

    return map;
}
