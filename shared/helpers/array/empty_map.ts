import {freezeMap} from "~/shared/helpers/control/freeze_map.js";

/**
 * Empty read-only map constant.
 *
 * You can use this if you want a referentially equal empty array to pass
 * around places that depend on referential equality (like React).
 */
export const emptyMap: ReadonlyMap<unknown, never> & {
    // Make sure you can call `has()` with any key.
    has(value: any): boolean;
} = freezeMap(new Map<unknown, never>());
