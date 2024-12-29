import {InternalError} from "~/shared/error/error.js";

/**
 * Empty read-only map constant.
 *
 * You can use this if you want a referentially equal empty array to pass
 * around places that depend on referential equality (like React).
 */
export const emptyMap: ReadonlyMap<never, never> & {
    // Make sure you can call `has()`.
    has(value: any): boolean;
} = new Map<never, never>();

// Precaution to make sure someone doesn't accidentally add something to a map
// we need to guarantee is an empty constant.
Object.assign(emptyMap, {
    set: () => {
        throw new InternalError("Can't update empty map");
    },
    delete: () => {
        throw new InternalError("Can't update empty map");
    },
    clear: () => {
        throw new InternalError("Can't update empty map");
    },
});
