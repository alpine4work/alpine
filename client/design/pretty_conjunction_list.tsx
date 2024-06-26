import {ReactNode} from "react";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";

/**
 * Join a list of components into an English conjunction list. Does the same
 * thing as `joinPrettyConjunctionList()` but lets you have individual React
 * components for each list item.
 */
export function PrettyConjunctionList({
    list,
    conjunction = "and",
}: {
    list: ReadonlyArray<ReactNode>;
    conjunction?: "and" | "or";
}) {
    if (list.length === 0) return null;
    if (list.length === 1) return <>{list[0]!}</>;

    if (list.length === 2) {
        return (
            <>
                {list[0]!} {conjunction} {list[1]!}
            </>
        );
    }

    return (
        <>
            {interleaveArray(list.slice(0, list.length - 1), ", ")}, {conjunction}{" "}
            {list[list.length - 1]}
        </>
    );
}
