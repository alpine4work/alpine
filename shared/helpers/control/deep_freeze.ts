import {freezeMap} from "~/shared/helpers/control/freeze_map.js";
import {freezeSet} from "~/shared/helpers/control/freeze_set.js";

let deepFrozen: WeakSet<object> | null = null;

/**
 * Deeply freeze the provided object. Traverses the object and freezes any
 * child objects. This helps prevent accidental mutation of the object.
 *
 * This function can't perfectly freeze JavaScript values. Some known issues:
 *
 * - Only freezes own properties, prototypes of the value may still be
 *   modified.
 *
 * - Uses `freezeMap()` and `freezeSet()` for `Map`s and `Set`s. These
 *   functions can't stop
 *   `Map.prototype.set.call(supposedlyFrozenMap, key, value)` or
 *   `Set.prototype.set.call(supposedlyFrozenSet, value)` from freezing the map
 *   or map.
 */
export function deepFreeze(value: unknown) {
    if (typeof value !== "object" || value === null) return;

    if (deepFrozen?.has(value)) return;
    deepFrozen ??= new WeakSet();
    deepFrozen.add(value);

    if (value instanceof Map) {
        freezeMap(value);

        for (const childValue of value.values()) {
            deepFreeze(childValue);
        }
    } else if (value instanceof Set) {
        freezeSet(value);

        for (const childValue of value) {
            deepFreeze(childValue);
        }
    } else if (Array.isArray(value)) {
        Object.freeze(value);

        for (const childValue of value) {
            deepFreeze(childValue);
        }
    } else {
        Object.freeze(value);
    }

    // Deep freeze the own values of the object as well. Even if this is not a
    // plain object.
    for (const childValue of Object.values(value)) {
        deepFreeze(childValue);
    }
}
