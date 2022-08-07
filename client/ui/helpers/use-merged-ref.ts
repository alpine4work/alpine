import {Ref, useMemo} from "react";
import {assignRef} from "~/client/ui/helpers/assign-ref";

/**
 * Merge two refs together.
 *
 * Maintains referential integrity as long as both refs stay the same.
 */
export function useMergedRef<T>(ref1: Ref<T>, ref2: Ref<T>): Ref<T> {
    return useMemo(() => {
        if (ref1 === null) return ref2;
        if (ref2 === null) return ref1;
        return (value: T | null) => {
            assignRef(ref1, value);
            assignRef(ref2, value);
        };
    }, [ref1, ref2]);
}
