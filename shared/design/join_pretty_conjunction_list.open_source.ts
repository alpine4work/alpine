/**
 * Join an array of strings into an English conjunction list. For example
 * `joinPrettyConjunctionList(["apples", "grapes", "pears"])` will become
 * `"apples, grapes, and pears"`. This implementation will need to evolve when we
 * internationalize.
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
    return `${list.slice(0, list.length - 1).join(", ")}, ${conjunction} ${list[list.length - 1]!}`;
}
