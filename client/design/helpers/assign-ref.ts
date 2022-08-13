import {Ref} from "react";

/**
 * Assign a value to a ref function or object. Useful when you want to merge two
 * refs together.
 *
 * Use this sparingly! If you find yourself reaching for this function, maybe
 * rethink the pattern you're trying to implement first.
 */
export function assignRef<T>(ref: Ref<T>, value: T | null) {
    if (ref === null) return;

    if (typeof ref === "function") {
        ref(value);
        return;
    }

    // TypeScript lets us ignore `readonly` so easily...
    const mutableRef: {current: T | null} = ref;
    mutableRef.current = value;
}
