import {freezeMap} from "~/shared/helpers/map/freeze_map.open_source.js";
import {freezeSet} from "~/shared/helpers/set/freeze_set.open_source.js";

let deepFrozen: WeakSet<object> | null = null;

/**
 * Deeply freeze the provided object. Traverses the object and freezes any child
 * objects. This helps prevent accidental mutation of the object.
 *
 * This function can't perfectly freeze JavaScript values. Some known issues:
 *
 * - Only freezes own properties, prototypes of the value may still be modified.
 *
 * - Uses `freezeMap()` and `freezeSet()` for `Map`s and `Set`s. These functions
 *   can't stop `Map.prototype.set.call(supposedlyFrozenMap, key, value)` or
 *   `Set.prototype.set.call(supposedlyFrozenSet, value)` from freezing the map or
 *   map.
 */
export function deepFreeze(value: unknown, filter?: (value: unknown) => boolean): void {
    if (typeof value !== "object" || value === null) return;

    if (deepFrozen?.has(value)) return;
    deepFrozen ??= new WeakSet();
    deepFrozen.add(value);

    // Allow stopping certain values from being frozen. For example, you may want to
    // prevent `Uint8Array` from being frozen since it'll throw an error.
    if (filter !== undefined && filter(value) === false) return;

    if (value instanceof Map) {
        freezeMap(value);

        for (const childValue of value.values()) {
            deepFreeze(childValue, filter);
        }
    } else if (value instanceof Set) {
        freezeSet(value);

        for (const childValue of value) {
            deepFreeze(childValue, filter);
        }
    } else if (Array.isArray(value)) {
        Object.freeze(value);

        for (const childValue of value) {
            deepFreeze(childValue, filter);
        }
    } else {
        Object.freeze(value);
    }

    // Deep freeze the own values of the object as well. Even if this is not a plain
    // object.
    for (const childValue of Object.values(value)) {
        deepFreeze(childValue, filter);
    }
}
