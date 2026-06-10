import {InternalError} from "~/shared/error/error.js";

function cantUpdateFrozenSet(): never {
    throw new InternalError("Can\u2019t update frozen set");
}

/**
 * Freeze a `Set`. Calling `Object.freeze()` on a set won't work since you'll still
 * be able to call `add()`, `delete()`, and `clear()` to modify the set.
 *
 * This function isn't perfect. You can still call
 * `Set.prototype.set.add(supposedlyFrozenMap, value)` to modify a set. Freezing is
 * best effort and meant to stop accidental modifications but we can't perfectly
 * prevent all modifications. As a codebase convention, if we don't use
 * `Set.prototype.set.call()` then this workaround shouldn't be an issue in
 * practice.
 */
export function freezeSet<Value>(set: Set<Value>): ReadonlySet<Value> {
    if (!Object.isFrozen(set)) {
        set.add = cantUpdateFrozenSet;
        set.delete = cantUpdateFrozenSet;
        set.clear = cantUpdateFrozenSet;
    }

    Object.freeze(set);

    return set;
}
