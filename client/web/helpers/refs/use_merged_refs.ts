import {Ref, useMemo} from "react";
import {assignRef} from "~/client/web/helpers/refs/assign_ref.js";

/**
 * Merge two refs together.
 *
 * Maintains referential integrity as long as both refs stay the same.
 */
export function useMergedRefs<T>(
    ref1: Ref<T>,
    ref2: Ref<T>,
    ref3: Ref<T> = null,
    ref4: Ref<T> = null,
): Ref<T> {
    return useMemo(() => {
        if (ref1 === null && ref3 === null && ref4 === null) return ref2;
        if (ref2 === null && ref3 === null && ref4 === null) return ref1;
        if (ref1 === null && ref2 === null && ref4 === null) return ref3;
        if (ref1 === null && ref2 === null && ref3 === null) return ref4;

        if (ref1 === null && ref2 === null && ref3 === null && ref4 === null) return null;

        return (value: T | null) => {
            assignRef(ref1, value);
            assignRef(ref2, value);
            assignRef(ref3, value);
            assignRef(ref4, value);
        };
    }, [ref1, ref2, ref3, ref4]);
}
