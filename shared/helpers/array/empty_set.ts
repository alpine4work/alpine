import {InternalError} from "~/shared/error/error.js";

/**
 * Empty read-only set constant.
 *
 * You can use this if you want a referentially equal empty array to pass
 * around places that depend on referential equality (like React).
 */
export const emptySet: ReadonlySet<never> & {
    // Make sure you can call `has()`.
    has(value: any): boolean;
} = new Set<never>();

// Precaution to make sure someone doesn't accidentally add something to a set
// we need to guarantee is an empty constant.
Object.assign(emptySet, {
    add: () => {
        throw new InternalError("Can't update empty set");
    },
    delete: () => {
        throw new InternalError("Can't update empty set");
    },
    clear: () => {
        throw new InternalError("Can't update empty set");
    },
});
