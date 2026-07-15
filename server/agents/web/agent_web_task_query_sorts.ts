import {
    ApiTaskQuerySort,
    ApiTaskQuerySortDirection,
    ApiTaskQuerySortMissing,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";

/**
 * Prints a list of API task sorts as a URL search param for the agent web. The
 * returned string looks like `sort=-priority,due` and is intended to be placed
 * after a `?` in an agent web path (e.g.
 * `/task-collection/roadmap?status=open&sort=-priority,due`). No sorts print as an
 * empty string with no `sort` search param at all.
 *
 * The format follows the popular
 * [JSON:API](https://jsonapi.org/format/#fetching-sorting) convention: one `sort`
 * search param with comma separated sort keys where earlier keys take priority and
 * later keys break ties, and a `-` in front of a key sorts descending.
 *
 * - `sort=created` sorts by creation time, oldest tasks first
 *
 * - `sort=-created` sorts by creation time, newest tasks first (`-` for
 *   descending)
 *
 * - `sort=-priority,due` sorts by priority descending and breaks ties by due date
 *   ascending
 *
 * The sort keys are `status`, `priority`, `layout`, `assignee`, `creator`,
 * `assigner`, `due`, `created`, `assigned`, `closed`, and `activated`. They match
 * the task filter keys in `printAgentWebTaskQueryFilters()`.
 *
 * Tasks are always sorted by `layout`, `assignee`, and `assigner` in the same
 * order — these sorts don't have a direction to reverse. Instead a `-` moves tasks
 * missing the field to the front: `sort=assignee` puts unassigned tasks last while
 * `sort=-assignee` puts them first.
 *
 * The `creator` sort has no options at all (every task has a creator and the sort
 * order can't be reversed) so only `sort=creator` is valid.
 *
 * Repeated sort keys print as-is (`sort=created,-created`). A repeated key doesn't
 * change the order (tasks that tie on a sort also tie on every other sort of the
 * same key) but the task sort editor UI can hold multiple sorts of the same type,
 * so we preserve them exactly. `parseAgentWebTaskQuerySorts()` returns exactly
 * whatever list of sorts was printed.
 */
export function printAgentWebTaskQuerySorts(sorts: ReadonlyArray<ApiTaskQuerySort>): string {
    if (sorts.length === 0) return "";

    return `sort=${sorts.map(printAgentWebTaskQuerySort).join(",")}`;
}

function printAgentWebTaskQuerySort(sort: ApiTaskQuerySort): string {
    switch (sort.type) {
        case "Status":
            return printAgentWebTaskQuerySortDirection("status", sort.direction);
        case "Priority":
            return printAgentWebTaskQuerySortDirection("priority", sort.direction);
        case "Layout":
            return printAgentWebTaskQuerySortMissing("layout", sort.missing);
        case "Assignee":
            return printAgentWebTaskQuerySortMissing("assignee", sort.missing);
        case "Creator":
            return "creator";
        case "Assigner":
            return printAgentWebTaskQuerySortMissing("assigner", sort.missing);
        case "Due":
            return printAgentWebTaskQuerySortDirection("due", sort.direction);
        case "CreatedTime":
            return printAgentWebTaskQuerySortDirection("created", sort.direction);
        case "AssignedTime":
            return printAgentWebTaskQuerySortDirection("assigned", sort.direction);
        case "ClosedTime":
            return printAgentWebTaskQuerySortDirection("closed", sort.direction);
        case "ActivatedTime":
            return printAgentWebTaskQuerySortDirection("activated", sort.direction);
        default:
            throw exhaustive(sort);
    }
}

function printAgentWebTaskQuerySortDirection(
    key: string,
    direction: ApiTaskQuerySortDirection,
): string {
    return direction === "Descending" ? `-${key}` : key;
}

// Sorts with a `missing` option always order tasks that have the field the same
// way, so the closest reversal the data structure can represent is moving tasks
// missing the field from last to first. That's what a `-` means for these sorts.
function printAgentWebTaskQuerySortMissing(key: string, missing: ApiTaskQuerySortMissing): string {
    return missing === "First" ? `-${key}` : key;
}

/**
 * Parses URL search params into API task sorts. This is the inverse of
 * `printAgentWebTaskQuerySorts()`, see that function for the format documentation.
 * Parsing what that function printed returns exactly the printed list of sorts.
 *
 * Search params other than `sort` (like task filters or a caller's pagination
 * params) are ignored. Repeated `sort` params concatenate in order
 * (`sort=priority&sort=due` is the same as `sort=priority,due`) and empty comma
 * segments don't add sorts (`sort=priority,` is just `priority`).
 *
 * Accepts a pre-parsed `URLSearchParams` since the agent web `read` tool already
 * parses paths with `normalizeAgentWebPath()`. `URLSearchParams` decodes `+` as a
 * space so an explicitly ascending sort like `sort=+created` reaches us as
 * ` created`. We treat the space as a `+` so agents can write `sort=+created` as
 * the opposite of `sort=-created`.
 */
export function parseAgentWebTaskQuerySorts(
    searchParams: URLSearchParams,
): ReadonlyArray<ApiTaskQuerySort> {
    const sorts: Array<ApiTaskQuerySort> = [];

    for (const [key, value] of searchParams.entries()) {
        // The `sort` param doesn't have bracket operators like task filter params (e.g.
        // `due[before]=`) since a `-` in front of a sort key already picks the direction.
        if (/^sort\[[a-z]+\]$/.test(key)) {
            throw new InvalidArgumentError("Unknown task sort operator", {
                displayMessage: errorDisplayMessage`Unknown task sort ${quote(`${key}=...`)}. Try again with a plain \`sort\` search param (e.g. \`sort=created\`) where a \`-\` in front of a sort key sorts descending (e.g. \`sort=-created\`).`,
            });
        }

        // Search params we don't recognize as task sorts are ignored.
        if (key !== "sort") continue;

        for (const segment of value.split(",")) {
            if (segment.length === 0) continue;
            sorts.push(parseAgentWebTaskQuerySort(segment));
        }
    }

    return sorts;
}

function parseAgentWebTaskQuerySort(value: string): ApiTaskQuerySort {
    // A `+` in a URL search param value is decoded as a space by `URLSearchParams` so
    // an ascending sort printed like `sort=+created` reaches us as ` created`. We
    // accept a space wherever a `+` is expected.
    const signMatch = value.match(/^([+\- ])(.+)$/);
    const isDescending = signMatch !== null && signMatch[1] === "-";
    const key = signMatch ? signMatch[2]! : value;

    const direction: ApiTaskQuerySortDirection = isDescending ? "Descending" : "Ascending";
    const missing: ApiTaskQuerySortMissing = isDescending ? "First" : "Last";

    switch (key) {
        case "status":
            return {type: "Status", direction};
        case "priority":
            return {type: "Priority", direction};
        case "layout":
            return {type: "Layout", missing};
        case "assignee":
            return {type: "Assignee", missing};
        case "creator": {
            if (isDescending) {
                throw new InvalidArgumentError("Unexpected descending creator task sort", {
                    displayMessage: errorDisplayMessage`The \`creator\` task sort can\u2019t be reversed with \`-\` since sorting by creator doesn\u2019t have a direction. Try again with \`sort=creator\`.`,
                });
            }

            return {type: "Creator"};
        }
        case "assigner":
            return {type: "Assigner", missing};
        case "due":
            return {type: "Due", direction};
        case "created":
            return {type: "CreatedTime", direction};
        case "assigned":
            return {type: "AssignedTime", direction};
        case "closed":
            return {type: "ClosedTime", direction};
        case "activated":
            return {type: "ActivatedTime", direction};
        default: {
            // Print the space `URLSearchParams` decodes back as the `+` the agent wrote so the
            // error quotes the sort as the agent sees it.
            const displayValue = quote(value.startsWith(" ") ? `+${value.slice(1)}` : value);

            throw new InvalidArgumentError("Unexpected task sort value", {
                displayMessage: errorDisplayMessage`Unexpected task sort ${displayValue} in the \`sort\` URL search param. Try again with one of the sort keys \`status\`, \`priority\`, \`layout\`, \`assignee\`, \`creator\`, \`assigner\`, \`due\`, \`created\`, \`assigned\`, \`closed\`, or \`activated\`, where a \`-\` in front of a key sorts descending (e.g. \`sort=-created\`).`,
            });
        }
    }
}
