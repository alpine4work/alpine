import {freezeMap} from "~/shared/helpers/control/freeze_map.js";

// NOCOMMIT: Move to `share/helpers/map`. And move other empties. Maybe move
// `freeze_map.js` too?

/**
 * Empty read-only map constant.
 *
 * You can use this if you want a referentially equal empty array to pass
 * around places that depend on referential equality (like React).
 */
export const emptyMap: ReadonlyMap<never, never> & {
    // Make sure you can call `get()` with any key.
    get(value: any): never | undefined;
    // Make sure you can call `has()` with any key.
    has(value: any): boolean;
} = freezeMap(new Map<never, never>());
