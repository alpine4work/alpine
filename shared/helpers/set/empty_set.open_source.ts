import {freezeSet} from "~/shared/helpers/set/freeze_set.open_source.js";

/**
 * Empty read-only set constant.
 *
 * You can use this if you want a referentially equal empty array to pass around
 * places that depend on referential equality (like React).
 */
export const emptySet: ReadonlySet<never> & {
    // Make sure you can call `has()` with any value.
    has(value: any): boolean;
} = freezeSet(new Set<never>());
