import {ReactNode} from "react";
import {interleaveArray} from "~/shared/helpers/array/interleave_array";

/**
 * Join an array of strings into an English conjunction list. For example
 * `joinPrettyConjunctionList(["apples", "grapes", "pears"])` will become
 * `"apples, grapes, and pears"`. This implementation will need to evolve
 * when we internationalize.
 *
 * If you want each item to be a React component instead of a string, use
 * `<PrettyConjunctionList>`.
 */
export function joinPrettyConjunctionList(
    list: ReadonlyArray<string>,
    conjunction: "and" | "or" = "and",
): string {
    if (list.length === 0) return "";
    if (list.length === 1) return list[0]!;
    if (list.length === 2) return `${list[0]!} ${conjunction} ${list[1]!}`;
    return `${list.slice(0, list.length - 1).join(", ")}, and ${list[list.length - 1]!}`;
}

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
