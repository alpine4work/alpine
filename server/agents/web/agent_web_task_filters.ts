import {parseDate} from "@internationalized/date";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {normalizeApiTaskFilters} from "~/shared/api/content/normalize_api_task_filters.js";
import {printApiMentionReferenceKey} from "~/shared/api/specification/api_mention_reference_key.js";
import {
    ApiMentionReference,
    ApiTaskAccountFilterOperationAccount,
    ApiTaskDateFilterOperationDate,
    ApiTaskDateFilterOperationDuration,
    ApiTaskFilter,
    ApiTaskLayout,
    ApiTaskPriority,
    ApiTaskStatus,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";

/**
 * Prints a list of API task filters as URL search params for the agent web. The
 * returned string looks like `status=open&priority=high` and is intended to be
 * placed after a `?` in an agent web path (e.g.
 * `/task-collection/roadmap?status=open&priority=high`).
 *
 * The format optimizes for human readability (which we hypothesize is also agent
 * readability) so we carefully control escaping ourselves instead of using
 * `URLSearchParams.toString()` which percent-encodes characters like `/`, `[`, and
 * `]`. We print valid [WHATWG URL](https://url.spec.whatwg.org) queries: we only
 * percent-encode characters in the WHATWG URL query percent-encode set plus the
 * characters `URLSearchParams` parsing gives structural meaning (like `&` and
 * `+`). Notably `[` and `]` are not in the query percent-encode set even though
 * the stricter RFC 3986 reserves them, so operators go in square brackets after
 * the filter name following the Stripe/Rails convention (e.g. `created[gte]=...`
 * in the Stripe API), and `URLSearchParams` decodes percent-encoded `%5B`/`%5D`
 * keys to the same filters. Comparison operators like `<` and `>` are in the query
 * percent-encode set which is why we don't use syntax like `due<=2026-07-12`.
 *
 * Each filter value is one search param:
 *
 * - `status=open`, `status=open-active`, or `status=closed`
 *
 * - `priority=low`, `medium`, `high`, `urgent`, or `none` for no priority
 *
 * - `layout=project`
 *
 * - `title=some+text` for tasks with titles containing "some text"
 *
 * - `assignee=john-doe` where `john-doe` is the name from an account path the
 *   agent has seen (e.g. `/human/john-doe`), `assignee=me` for the current
 *   account, or `assignee=none` for unassigned tasks (same for `assigner`)
 *
 * - `creator=john-doe` or `creator=me`
 *
 * - `collection=roadmap` where `roadmap` is the name from a task collection path
 *   the agent has seen (e.g. `/task-collection/roadmap`), or `collection=none` for
 *   tasks in no collections
 *
 * - `due[before]=<date>` and `due[after]=<date>` where `<date>` is an ISO 8601
 *   date (`2026-07-12`), `today`, or a date relative to today (`today+2w` or
 *   `today-3d` with the units `d`, `w`, `mo`, and `y`). Also `due=overdue` and
 *   `due=none` for tasks with no due date.
 *
 * - `created`, `assigned`, `closed`, and `activated` accept `[before]` and
 *   `[after]` dates just like `due`
 *
 * Filters compose like so:
 *
 * - A `[not]` operator inverts a filter (`status[not]=closed`,
 *   `assignee[not]=me`).
 *
 * - Adjacent repeated `status`, `priority`, `layout`, `assignee`, `creator`,
 *   `assigner`, and `collection` params merge into one filter matching tasks with
 *   _any_ of the values (`priority=high&priority=medium` is high or medium
 *   priority) since these filters hold a list of values. Adjacent repeated `[not]`
 *   values merge into one filter matching tasks with _none_ of the values.
 *
 * - Params only merge when they're adjacent. `status=open&title=a&status=closed`
 *   is three filters and a `break` param (which is otherwise ignored) splits
 *   adjacent params apart: `status=open&break&status=closed` is two status
 *   filters. All filters must match so two status filters usually match fewer
 *   tasks than one merged status filter would.
 *
 * - `title` and date params never merge, each one is its own filter
 *   (`due[after]=2026-07-01&due[before]=2026-08-01` is a date range).
 *
 * - `collection[all]` matches tasks in _every_ listed collection
 *   (`collection[all]=engineering&collection[all]=design`) instead of at least
 *   one.
 *
 * - An empty value is a filter that hasn't been fully configured in the task
 *   filter editor UI yet: `due[before]=` is a date filter with no date chosen (it
 *   matches all tasks), `title=` is a title filter with no text (it matches all
 *   tasks), and `status=` is a status filter with no statuses chosen (it matches
 *   no tasks).
 *
 * Filters are normalized with `normalizeApiTaskFilters()` before printing and
 * `parseAgentWebTaskFilters()` returns exactly the normalized form of whatever was
 * printed.
 *
 * Account and task collection references are printed using the name from their
 * agent web pathnames (e.g. `john-doe` from `/human/john-doe`). Callers must
 * create stored links (with `createAgentWebPageStoredLinkPathname()`) for every
 * account and task collection referenced by a filter before printing, otherwise we
 * throw an `InternalError`. Typically the page printing the filters also prints
 * Markdown links for those references which creates the stored links.
 *
 * `parseAgentWebTaskFilters()` parses the search params this function prints.
 */
export async function printAgentWebTaskFilters(
    storage: AgentWebSessionStorage,
    filters: ReadonlyArray<ApiTaskFilter>,
): Promise<string> {
    filters = normalizeApiTaskFilters(filters);

    const printedFilters = await runAllPromises(
        filters.map(filter => printAgentWebTaskFilter(storage, filter)),
    );

    const searchParams: Array<string> = [];
    let previousListKey: string | null = null;

    for (const printedFilter of printedFilters) {
        // Adjacent filters that print list values under the same search param key would be
        // merged into one filter by `parseAgentWebTaskFilters()`. A `break` param (which
        // is otherwise ignored by the parser) splits them apart.
        if (printedFilter.listKey !== null && printedFilter.listKey === previousListKey) {
            searchParams.push("break");
        }

        previousListKey = printedFilter.listKey;
        for (const searchParam of printedFilter.searchParams) {
            searchParams.push(searchParam);
        }
    }

    return searchParams.join("&");
}

async function printAgentWebTaskFilter(
    storage: AgentWebSessionStorage,
    filter: ApiTaskFilter,
): Promise<{searchParams: Array<string>; listKey: string | null}> {
    switch (filter.type) {
        case "Status": {
            const {operation} = filter;

            const key = {
                OneOf: "status",
                NoneOf: "status[not]",
            }[operation.type];

            return {
                searchParams: printAgentWebTaskFilterListValues(
                    key,
                    operation.statuses.map(printAgentWebTaskFilterStatus),
                ),
                listKey: key,
            };
        }
        case "Collections": {
            const {operation} = filter;

            switch (operation.type) {
                case "IsEmpty": {
                    // `collection=none` splits adjacent bare `collection` runs so it never needs a
                    // `break` and doesn't claim the list key.
                    return {searchParams: ["collection=none"], listKey: null};
                }
                case "IncludesOneOf":
                case "IncludesAllOf":
                case "ExcludesAllOf": {
                    const key = {
                        IncludesOneOf: "collection",
                        IncludesAllOf: "collection[all]",
                        ExcludesAllOf: "collection[not]",
                    }[operation.type];

                    const values = await runAllPromises(
                        operation.collections.map(collection =>
                            printAgentWebTaskFilterCollection(storage, collection.id),
                        ),
                    );

                    return {
                        searchParams: printAgentWebTaskFilterListValues(key, values),
                        listKey: key,
                    };
                }
                default:
                    throw exhaustive(operation);
            }
        }
        case "Priority": {
            const {operation} = filter;

            const key = {
                OneOf: "priority",
                NoneOf: "priority[not]",
            }[operation.type];

            return {
                searchParams: printAgentWebTaskFilterListValues(
                    key,
                    operation.priorities.map(printAgentWebTaskFilterPriority),
                ),
                listKey: key,
            };
        }
        case "Layout": {
            const {operation} = filter;

            const key = {
                OneOf: "layout",
                NoneOf: "layout[not]",
            }[operation.type];

            return {
                searchParams: printAgentWebTaskFilterListValues(
                    key,
                    operation.layouts.map(printAgentWebTaskFilterLayout),
                ),
                listKey: key,
            };
        }
        case "Title": {
            const {operation} = filter;

            const key = {
                Includes: "title",
                Excludes: "title[not]",
            }[operation.type];

            // An empty title query (`title=`) is a title filter whose text hasn't been typed
            // yet in the task filter editor UI.
            return {
                searchParams: [`${key}=${escapeAgentWebTaskFilterText(operation.titleQuery)}`],
                listKey: null,
            };
        }
        case "Assignee":
        case "Creator":
        case "Assigner": {
            const filterKey = {
                Assignee: "assignee",
                Creator: "creator",
                Assigner: "assigner",
            }[filter.type];

            const {operation} = filter;

            const key = {
                OneOf: filterKey,
                NoneOf: `${filterKey}[not]`,
            }[operation.type];

            const values = await runAllPromises(
                operation.accounts.map(account => printAgentWebTaskFilterAccount(storage, account)),
            );

            return {
                searchParams: printAgentWebTaskFilterListValues(key, values),
                listKey: key,
            };
        }
        case "Due": {
            const {operation} = filter;

            switch (operation.type) {
                case "Overdue": {
                    return {searchParams: ["due=overdue"], listKey: null};
                }
                case "IsEmpty": {
                    return {searchParams: ["due=none"], listKey: null};
                }
                case "LessThan":
                case "GreaterThan": {
                    return {
                        searchParams: [printAgentWebTaskFilterDateOperation("due", operation)],
                        listKey: null,
                    };
                }
                default:
                    throw exhaustive(operation);
            }
        }
        case "CreatedDate": {
            return {
                searchParams: [printAgentWebTaskFilterDateOperation("created", filter.operation)],
                listKey: null,
            };
        }
        case "AssignedDate": {
            return {
                searchParams: [printAgentWebTaskFilterDateOperation("assigned", filter.operation)],
                listKey: null,
            };
        }
        case "ClosedDate": {
            return {
                searchParams: [printAgentWebTaskFilterDateOperation("closed", filter.operation)],
                listKey: null,
            };
        }
        case "ActivatedDate": {
            return {
                searchParams: [printAgentWebTaskFilterDateOperation("activated", filter.operation)],
                listKey: null,
            };
        }
        default:
            throw exhaustive(filter);
    }
}

/**
 * Prints one search param per list filter value. A list filter with no values
 * (which the task filter editor UI represents as a filter that hasn't been fully
 * configured yet) prints as a single empty value (e.g. `status=`).
 */
function printAgentWebTaskFilterListValues(
    key: string,
    values: ReadonlyArray<string>,
): Array<string> {
    if (values.length === 0) return [`${key}=`];
    return values.map(value => `${key}=${value}`);
}

function printAgentWebTaskFilterStatus(status: ApiTaskStatus): string {
    switch (status.type) {
        case "Open":
            return status.isActive ? "open-active" : "open";
        case "Closed":
            return "closed";
        default:
            throw exhaustive(status);
    }
}

async function printAgentWebTaskFilterCollection(
    storage: AgentWebSessionStorage,
    id: TaskCollectionId,
): Promise<string> {
    const pathname = await getAgentWebTaskFilterReferencePathname(storage, {
        type: "TaskCollection",
        id,
    });

    assert(pathname.startsWith("/task-collection/"));
    const name = pathname.slice("/task-collection/".length);

    // A task collection whose pathname name collides with a reserved filter value
    // would parse back as the reserved value so we print its full path instead.
    if (name === "none") return pathname;

    return name;
}

async function getAgentWebTaskFilterReferencePathname(
    storage: AgentWebSessionStorage,
    reference: ApiMentionReference & {readonly type: "Account" | "TaskCollection"},
): Promise<string> {
    const referenceKey = printApiMentionReferenceKey(reference);
    const pathname = await storage.latestPageStoredLinkPathnameByKey.get(referenceKey);

    // NOCOMMIT: We need to load collection titles and such. How can we make sure
    // referenced collection titles are passed in? Ooh, they need to be in `_Response`
    // for the filter right?
    if (pathname === undefined) {
        throw new InternalError(
            `Missing stored link pathname for task filter reference \u201c${referenceKey}\u201d. Create links for all accounts and task collections referenced by task filters before printing the filters.`,
        );
    }

    return pathname;
}

function printAgentWebTaskFilterPriority(priority: ApiTaskPriority | null): string {
    if (priority === null) return "none";

    switch (priority.type) {
        case "Low":
            return "low";
        case "Medium":
            return "medium";
        case "High":
            return "high";
        case "Urgent":
            return "urgent";
        default:
            throw exhaustive(priority);
    }
}

function printAgentWebTaskFilterLayout(layout: ApiTaskLayout): string {
    switch (layout.type) {
        case "Project":
            return "project";
        default:
            throw exhaustive(layout.type);
    }
}

/**
 * Escape free-form text (like a task title query) for use as a URL search param
 * value. We escape as little as possible for readability: only the characters that
 * `URLSearchParams` parsing gives structural meaning plus the characters in the
 * [WHATWG URL query percent-encode set][1] so that printed filters are valid
 * WHATWG URL queries.
 *
 * [1]: https://url.spec.whatwg.org/#query-percent-encode-set
 */
function escapeAgentWebTaskFilterText(text: string): string {
    let escapedText = "";

    for (const character of text) {
        switch (character) {
            // A literal `%` would be decoded as the start of a percent-encoded sequence.
            case "%":
                escapedText += "%25";
                break;
            // A literal `&` would end this search param and start another.
            case "&":
                escapedText += "%26";
                break;
            // A literal `+` would be decoded as a space by `URLSearchParams`.
            case "+":
                escapedText += "%2B";
                break;
            // The agent web `read` tool strips everything after a `#` as a URL hash before
            // parsing search params. `#` is also in the WHATWG URL query percent-encode set.
            case "#":
                escapedText += "%23";
                break;
            // `URLSearchParams` decodes `+` as a space which reads much better than `%20`.
            case " ":
                escapedText += "+";
                break;
            // `"`, `<`, and `>` are in the WHATWG URL query percent-encode set.
            // eslint-disable-next-line cyberworlds/string-quotes
            case '"':
                escapedText += "%22";
                break;
            case "<":
                escapedText += "%3C";
                break;
            case ">":
                escapedText += "%3E";
                break;

            default: {
                // C0 controls and all code points greater than U+007E (`~`) are in the WHATWG URL
                // query percent-encode set.
                if (character < " " || character > "~") {
                    // Lone surrogates can't be encoded as UTF-8. The WHATWG URL parser replaces them
                    // with the replacement character (U+FFFD), so we do the same. (The binary task
                    // filter serialization does this too via `TextEncoder`.)
                    const codePoint = character.codePointAt(0)!;
                    const isLoneSurrogate = codePoint >= 0xd800 && codePoint <= 0xdfff;

                    escapedText += encodeURIComponent(isLoneSurrogate ? "\ufffd" : character);
                } else {
                    escapedText += character;
                }
                break;
            }
        }
    }

    return escapedText;
}

async function printAgentWebTaskFilterAccount(
    storage: AgentWebSessionStorage,
    account: ApiTaskAccountFilterOperationAccount,
): Promise<string> {
    switch (account.type) {
        case "Account": {
            const pathname = await getAgentWebTaskFilterReferencePathname(storage, {
                type: "Account",
                id: account.account.id,
            });

            const nameMatch = pathname.match(/^\/(?:human|bot)\/(.+)$/);
            assert(nameMatch !== null);
            const name = nameMatch[1]!;

            // An account whose pathname name collides with a reserved filter value would parse
            // back as the reserved value so we print its full path instead.
            if (name === "me" || name === "none") {
                return pathname;
            }

            return name;
        }
        case "CurrentAccount":
            return "me";
        case "MissingAccount":
            return "none";
        default:
            throw exhaustive(account);
    }
}

function printAgentWebTaskFilterDateOperation(
    filterKey: string,
    operation: {type: "LessThan" | "GreaterThan"; date: ApiTaskDateFilterOperationDate},
): string {
    const operator = {
        LessThan: "before",
        GreaterThan: "after",
    }[operation.type];

    return `${filterKey}[${operator}]=${printAgentWebTaskFilterDate(operation.date)}`;
}

function printAgentWebTaskFilterDate(date: ApiTaskDateFilterOperationDate): string {
    switch (date.type) {
        case "Absolute": {
            // A `null` absolute date is a filter whose date hasn't been chosen yet in the task
            // filter editor UI. It prints as an empty value (e.g. `due[before]=`) so agents
            // editing other filters don't destroy a half-configured filter.
            if (date.date === null) {
                return "";
            }

            // Absolute dates from the API are validated as ISO 8601 dates by the API
            // specification but we double check since we're inserting the date into a string
            // with carefully controlled escaping.
            assert(/^\d{4}-\d{2}-\d{2}$/.test(date.date));

            return date.date;
        }
        case "RelativeToday": {
            return "today";
        }
        case "RelativeAfterToday": {
            return `today+${printAgentWebTaskFilterDateDuration(date.duration)}`;
        }
        case "RelativeBeforeToday": {
            return `today-${printAgentWebTaskFilterDateDuration(date.duration)}`;
        }
        default:
            throw exhaustive(date);
    }
}

function printAgentWebTaskFilterDateDuration(duration: ApiTaskDateFilterOperationDuration): string {
    switch (duration.type) {
        case "Days":
            return printAgentWebTaskFilterDateDurationCount(duration.days, "d");
        case "Weeks":
            return printAgentWebTaskFilterDateDurationCount(duration.weeks, "w");
        case "Months":
            return printAgentWebTaskFilterDateDurationCount(duration.months, "mo");
        case "Years":
            return printAgentWebTaskFilterDateDurationCount(duration.years, "y");
        default:
            throw exhaustive(duration);
    }
}

function printAgentWebTaskFilterDateDurationCount(count: number, unit: string): string {
    assert(Number.isInteger(count) && count >= 0);

    return `${count}${unit}`;
}

/**
 * Parses URL search params into API task filters. This is the inverse of
 * `printAgentWebTaskFilters()`, see that function for the format documentation.
 * The returned filters are always normalized with `normalizeApiTaskFilters()`.
 *
 * Parsing is position aware: adjacent params with the same key merge into one
 * filter while params separated by a different key (or a `break` param) become
 * separate filters. This is what makes the format able to represent every list of
 * API task filters.
 *
 * Accepts a pre-parsed `URLSearchParams` since the agent web `read` tool already
 * parses paths with `normalizeAgentWebPath()`. `URLSearchParams` decodes `+` as a
 * space so date values like `today+3d` reach us as `today 3d`. We treat the space
 * as a `+` so agents can write either `today+3d` or `today%2B3d`.
 *
 * Throws an `InvalidArgumentError` with an agent-friendly display message for any
 * search param we don't recognize. Callers with their own search params (e.g.
 * pagination cursors) should remove them before calling.
 */
export async function parseAgentWebTaskFilters(
    storage: AgentWebSessionStorage,
    searchParams: URLSearchParams,
): Promise<ReadonlyArray<ApiTaskFilter>> {
    const runs: Array<AgentWebTaskFilterRun> = [];
    let currentListRun: AgentWebTaskFilterRun | null = null;

    for (const [key, value] of searchParams.entries()) {
        // `break` params are ignored except that they split adjacent same-key params into
        // separate filters (`status=open&break&status=closed` is two status filters).
        //
        // NOCOMMIT: No special exception for `break`. Any unknown search param should
        // break the run.
        if (key === "break") {
            currentListRun = null;
            continue;
        }

        const keyMatch = key.match(/^([a-z]+)\[([a-z]+)\]$/);
        const filterKey = keyMatch ? keyMatch[1]! : key;
        const operator = keyMatch ? keyMatch[2]! : null;

        // List filters hold a list of values so adjacent params with the same key merge
        // into one filter. Every other param is its own filter.
        const isListKey =
            filterKey === "status" ||
            filterKey === "priority" ||
            filterKey === "layout" ||
            filterKey === "collection" ||
            filterKey === "assignee" ||
            filterKey === "creator" ||
            filterKey === "assigner";

        if (isListKey && currentListRun !== null && currentListRun.key === key) {
            currentListRun.values.push(value);
            continue;
        }

        const run: AgentWebTaskFilterRun = {key, filterKey, operator, values: [value]};
        runs.push(run);
        currentListRun = isListKey ? run : null;
    }

    const filterPromises = runs.map(run => parseAgentWebTaskFilterRun(storage, run));

    return normalizeApiTaskFilters((await runAllPromises(filterPromises)).flat());
}

/**
 * A maximal sequence of adjacent search params sharing the same key. List filter
 * runs may have many values, every other run has exactly one value.
 */
type AgentWebTaskFilterRun = {
    readonly key: string;
    readonly filterKey: string;
    readonly operator: string | null;
    readonly values: Array<string>;
};

async function parseAgentWebTaskFilterRun(
    storage: AgentWebSessionStorage,
    run: AgentWebTaskFilterRun,
): Promise<Array<ApiTaskFilter>> {
    const {key, filterKey, operator, values} = run;

    switch (filterKey) {
        case "status": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`status\` or \`status[not]\``,
                );
            }

            return [
                {
                    type: "Status",
                    operation: {
                        type: operator === "not" ? "NoneOf" : "OneOf",
                        statuses: nonEmptyAgentWebTaskFilterValues(values).map(
                            parseAgentWebTaskFilterStatus,
                        ),
                    },
                },
            ];
        }
        case "priority": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`priority\` or \`priority[not]\``,
                );
            }

            return [
                {
                    type: "Priority",
                    operation: {
                        type: operator === "not" ? "NoneOf" : "OneOf",
                        priorities: nonEmptyAgentWebTaskFilterValues(values).map(
                            parseAgentWebTaskFilterPriority,
                        ),
                    },
                },
            ];
        }
        case "layout": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`layout\` or \`layout[not]\``,
                );
            }

            const layouts = nonEmptyAgentWebTaskFilterValues(values);

            // Unlike other list filters, a layout filter with no layouts isn't a state the
            // task filter editor UI can represent so we don't accept it.
            if (layouts.length === 0) {
                throw new InvalidArgumentError("Empty task layout filter", {
                    displayMessage: errorDisplayMessage`Unexpected empty value in the \`${key}\` task filter. Try again with \`project\` (e.g. \`layout=project\`).`,
                });
            }

            return [
                {
                    type: "Layout",
                    operation: {
                        type: operator === "not" ? "NoneOf" : "OneOf",
                        layouts: layouts.map(parseAgentWebTaskFilterLayout),
                    },
                },
            ];
        }
        case "title": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`title\` or \`title[not]\``,
                );
            }

            // Title runs always have exactly one value. An empty value (`title=`) is a title
            // filter whose text hasn't been typed yet in the task filter editor UI.
            //
            // NOCOMMIT: Is it possible for an agent to write `title=foo&title=bar`? Do we
            // treat that as a run? We need to be able to parse a broader range of syntax than
            // we print since the agent may write arbitrary search params directly into the
            // URL.
            assert(values.length === 1);

            return [
                {
                    type: "Title",
                    operation: {
                        type: operator === "not" ? "Excludes" : "Includes",
                        titleQuery: values[0]!,
                    },
                },
            ];
        }
        case "collection": {
            if (operator !== null && operator !== "all" && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`collection\`, \`collection[all]\`, or \`collection[not]\``,
                );
            }

            return await parseAgentWebTaskFilterCollectionsRun(storage, operator, values);
        }
        case "assignee":
        case "assigner": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`${filterKey}\` or \`${filterKey}[not]\``,
                );
            }

            const accounts = await runAllPromises(
                nonEmptyAgentWebTaskFilterValues(values).map(value =>
                    parseAgentWebTaskFilterAccount(storage, filterKey, value),
                ),
            );

            return [
                {
                    type: filterKey === "assignee" ? "Assignee" : "Assigner",
                    operation: {
                        type: operator === "not" ? "NoneOf" : "OneOf",
                        accounts,
                    },
                },
            ];
        }
        case "creator": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`creator\` or \`creator[not]\``,
                );
            }

            const accounts = await runAllPromises(
                nonEmptyAgentWebTaskFilterValues(values).map(async value => {
                    const account = await parseAgentWebTaskFilterAccount(storage, filterKey, value);

                    // `parseAgentWebTaskFilterAccount()` throws for `creator=none` when `filterKey` is
                    // `"creator"` so a missing account is impossible here.
                    assert(account.type !== "MissingAccount");

                    return account;
                }),
            );

            return [
                {
                    type: "Creator",
                    operation: {
                        type: operator === "not" ? "NoneOf" : "OneOf",
                        accounts,
                    },
                },
            ];
        }
        case "due": {
            // NOCOMMIT: Is it possible for an agent to write `due=foo&due=bar`? Do we treat
            // that as a run? We need to be able to parse a broader range of syntax than we
            // print since the agent may write arbitrary search params directly into the URL.
            // Even if it makes no semantic sense!
            assert(values.length === 1);
            const value = values[0]!;

            if (operator === null) {
                if (value === "overdue") return [{type: "Due", operation: {type: "Overdue"}}];
                if (value === "none") return [{type: "Due", operation: {type: "IsEmpty"}}];

                throw new InvalidArgumentError("Unexpected due task filter value", {
                    displayMessage: errorDisplayMessage`Unexpected value \`${value}\` for the \`due\` task filter in the URL search params. Try again with \`due=overdue\`, \`due=none\` for tasks with no due date, or a date operator (e.g. \`due[before]=2026-07-12\` or \`due[after]=today\`).`,
                });
            }

            if (operator !== "before" && operator !== "after") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`due\`, \`due[before]\`, or \`due[after]\``,
                );
            }

            return [
                {
                    type: "Due",
                    operation: {
                        type: operator === "before" ? "LessThan" : "GreaterThan",
                        date: parseAgentWebTaskFilterDate(key, value),
                    },
                },
            ];
        }
        case "created":
        case "assigned":
        case "closed":
        case "activated": {
            if (operator !== "before" && operator !== "after") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`${filterKey}[before]\` or \`${filterKey}[after]\``,
                );
            }

            assert(values.length === 1);

            const filterType =
                filterKey === "created"
                    ? "CreatedDate"
                    : filterKey === "assigned"
                      ? "AssignedDate"
                      : filterKey === "closed"
                        ? "ClosedDate"
                        : "ActivatedDate";

            return [
                {
                    type: filterType,
                    operation: {
                        type: operator === "before" ? "LessThan" : "GreaterThan",
                        date: parseAgentWebTaskFilterDate(key, values[0]!),
                    },
                },
            ];
        }
        default: {
            throw new InvalidArgumentError("Unknown task filter", {
                displayMessage: errorDisplayMessage`Unknown task filter \`${key}=...\`. Try again with one of \`status\`, \`title\`, \`collection\`, \`priority\`, \`layout\`, \`assignee\`, \`creator\`, \`assigner\`, \`due\`, \`created\`, \`assigned\`, \`closed\`, or \`activated\` where operators go in square brackets after the filter name (e.g. \`status[not]=closed\` or \`due[before]=2026-07-12\`).`,
            });
        }
    }
}

function createAgentWebTaskFilterOperatorError(
    key: string,
    expectedForms: ErrorDisplayMessage,
): InvalidArgumentError {
    return new InvalidArgumentError("Unknown task filter operator", {
        displayMessage: errorDisplayMessage`Unknown task filter \`${key}=...\`. Try again with ${expectedForms}.`,
    });
}

/**
 * Empty values in a list filter run don't add values to the filter. A run of only
 * empty values (e.g. `status=`) is a filter with no values which is a filter that
 * hasn't been fully configured in the task filter editor UI yet.
 */
function nonEmptyAgentWebTaskFilterValues(values: ReadonlyArray<string>): ReadonlyArray<string> {
    return values.filter(value => value.length > 0);
}

function parseAgentWebTaskFilterStatus(value: string): ApiTaskStatus {
    switch (value) {
        case "open":
            return {type: "Open", isActive: false};
        case "open-active":
            return {type: "Open", isActive: true};
        case "closed":
            return {type: "Closed"};
        default: {
            throw new InvalidArgumentError("Unexpected task status filter value", {
                displayMessage: errorDisplayMessage`Unexpected task status filter \`status=${value}\`. Try again with \`open\`, \`open-active\`, or \`closed\` (e.g. \`status=open\` or \`status[not]=closed\`).`,
            });
        }
    }
}

function parseAgentWebTaskFilterPriority(value: string): ApiTaskPriority | null {
    switch (value) {
        case "none":
            return null;
        case "low":
            return {type: "Low"};
        case "medium":
            return {type: "Medium"};
        case "high":
            return {type: "High"};
        case "urgent":
            return {type: "Urgent"};
        default: {
            // We intentionally don't include `urgent` in the list of valid priorities here.
            // "Urgent" is a secret priority we'll mention in skills. Very few tasks should
            // have an "Urgent" priority as urgent tasks will constantly notify the owner that
            // the task is still open.
            throw new InvalidArgumentError("Unexpected task priority filter value", {
                displayMessage: errorDisplayMessage`Unexpected task priority filter \`priority=${value}\`. Try again with \`low\`, \`medium\`, \`high\`, or \`none\` (e.g. \`priority=high\` or \`priority[not]=none\`).`,
            });
        }
    }
}

function parseAgentWebTaskFilterLayout(value: string): ApiTaskLayout {
    switch (value) {
        case "project":
            return {type: "Project"};
        default: {
            throw new InvalidArgumentError("Unexpected task layout filter value", {
                displayMessage: errorDisplayMessage`Unexpected task layout filter \`layout=${value}\`. Try again with \`project\` (e.g. \`layout=project\`).`,
            });
        }
    }
}

/**
 * Parses one run of adjacent bare `collection` params. Within a bare run the
 * `none` value is its own "tasks in no collections" filter and splits the
 * collection values around it into separate filters, e.g.
 * `collection=a&collection=none&collection=b` is three filters.
 */
async function parseAgentWebTaskFilterCollectionsRun(
    storage: AgentWebSessionStorage,
    operator: "all" | "not" | null,
    values: ReadonlyArray<string>,
): Promise<Array<ApiTaskFilter>> {
    const operationType =
        operator === null
            ? "IncludesOneOf"
            : operator === "all"
              ? "IncludesAllOf"
              : "ExcludesAllOf";

    const filterPromises: Array<Promise<ApiTaskFilter>> = [];
    let segment: Array<string> = [];
    let segmentExists = false;

    const flushSegment = () => {
        if (segment.length === 0 && !segmentExists) return;

        const collectionValues = segment;
        segment = [];
        segmentExists = false;

        filterPromises.push(
            (async (): Promise<ApiTaskFilter> => {
                const collections = await runAllPromises(
                    collectionValues.map(async value => ({
                        id: await parseAgentWebTaskFilterCollectionId(storage, value),
                    })),
                );

                return {type: "Collections", operation: {type: operationType, collections}};
            })(),
        );
    };

    for (const value of values) {
        if (value === "none" && operator === null) {
            flushSegment();
            filterPromises.push(
                Promise.resolve({type: "Collections", operation: {type: "IsEmpty"}}),
            );
        } else if (value.length === 0) {
            // An empty value doesn't add a collection but does mark that the run exists so a
            // run of only empty values (`collection=`) is a collection filter with no
            // collections which is a filter that hasn't been fully configured in the task
            // filter editor UI yet.
            segmentExists = true;
        } else {
            segment.push(value);
        }
    }

    flushSegment();

    return await runAllPromises(filterPromises);
}

async function parseAgentWebTaskFilterCollectionId(
    storage: AgentWebSessionStorage,
    value: string,
): Promise<TaskCollectionId> {
    // Accept both short task collection names (e.g. `roadmap`) and full task
    // collection paths (e.g. `/task-collection/roadmap`).
    const pathname = value.startsWith("/") ? value : `/task-collection/${value}`;
    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "TaskCollection") {
        throw new InvalidArgumentError("Unknown task collection in task filter", {
            displayMessage: errorDisplayMessage`Nothing found for \`${value}\` in the \`collection\` task filter. You may only filter by task collections you\u2019ve already seen a link for, using the name from the collection\u2019s path (e.g. \`collection=roadmap\` for \`/task-collection/roadmap\`) or \`none\` for tasks in no collections (e.g. \`collection=none\`). Try calling the \`search\` tool to find task collections.`,
        });
    }

    return pageLinkResult.pageLink.id;
}

async function parseAgentWebTaskFilterAccount(
    storage: AgentWebSessionStorage,
    filterKey: "assignee" | "creator" | "assigner",
    value: string,
): Promise<ApiTaskAccountFilterOperationAccount> {
    if (value === "me") {
        return {type: "CurrentAccount"};
    }

    if (value === "none") {
        if (filterKey === "creator") {
            throw new InvalidArgumentError("Unexpected creator task filter value", {
                displayMessage: errorDisplayMessage`The task filter \`creator=none\` isn\u2019t supported since every task has a creator. Try again with the name of an account (e.g. \`creator=john-doe\`) or \`me\` for yourself (e.g. \`creator=me\`).`,
            });
        }

        return {type: "MissingAccount"};
    }

    // Accept both short account names (e.g. `john-doe`) and full account paths (e.g.
    // `/human/john-doe`). Short names resolve unambiguously because account pathnames
    // are unique no matter how we label them, see
    // `normalizeAgentWebPageStoredLinkPathname()`.
    const pathname = value.startsWith("/") ? value : `/account/${value}`;
    const pageLinkResult = await routeAgentWebPageLinkPathname(storage, pathname);

    if (!pageLinkResult || pageLinkResult.pageLink.type !== "Account") {
        if (filterKey === "creator") {
            throw new InvalidArgumentError("Unknown account in task filter", {
                displayMessage: errorDisplayMessage`Nothing found for \`${value}\` in the \`creator\` task filter. You may only filter by those you\u2019ve already seen a link for, using the name from their path (e.g. \`creator=john-doe\` for \`/human/john-doe\`) or \`me\` for yourself (e.g. \`creator=me\`). Try calling the \`search\` tool to find people.`,
            });
        }

        throw new InvalidArgumentError("Unknown account in task filter", {
            displayMessage: errorDisplayMessage`Nothing found for \`${value}\` in the \`${filterKey}\` task filter. You may only filter by those you\u2019ve already seen a link for, using the name from their path (e.g. \`${filterKey}=john-doe\` for \`/human/john-doe\`), \`me\` for yourself (e.g. \`${filterKey}=me\`), or \`none\` for tasks with no ${filterKey} (e.g. \`${filterKey}=none\`). Try calling the \`search\` tool to find people.`,
        });
    }

    return {type: "Account", account: {id: pageLinkResult.pageLink.id}};
}

function parseAgentWebTaskFilterDate(
    key: string,
    dateString: string,
): ApiTaskDateFilterOperationDate {
    // An empty date (e.g. `due[before]=`) is a filter whose date hasn't been chosen
    // yet in the task filter editor UI. It matches all tasks.
    if (dateString.length === 0) {
        return {type: "Absolute", date: null};
    }

    if (dateString === "today") {
        return {type: "RelativeToday"};
    }

    // A `+` in a URL search param value is decoded as a space by `URLSearchParams` so
    // relative dates printed like `today+3d` reach us as `today 3d`. We accept a space
    // wherever a `+` is expected.
    const relativeMatch = dateString.match(/^today([+\- ])(\d+)(d|w|mo|y)$/);

    if (relativeMatch) {
        const [, sign, countString, unit] = relativeMatch;
        const duration = createAgentWebTaskFilterDateDuration(unit!, parseInt(countString!, 10));

        return sign === "-"
            ? {type: "RelativeBeforeToday", duration}
            : {type: "RelativeAfterToday", duration};
    }

    if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
        try {
            parseDate(dateString);
        } catch {
            throw new InvalidArgumentError("Unexpected task filter date", {
                // NOCOMMIT: Do we have a test for this error message? Is it even possible to throw
                // here? I think `parseDate()` will coerce most things. We may want to check as
                // well `parseDate(dateString).toString() === dateString` to catch cases that
                // `parseDate()` accepts and coerces.
                displayMessage: errorDisplayMessage`The date \`${dateString}\` in the \`${key}\` task filter isn\u2019t a real calendar date. Try again with a valid ISO 8601 date (e.g. \`${key}=2026-07-12\`).`,
            });
        }

        return {type: "Absolute", date: dateString};
    }

    throw new InvalidArgumentError("Unexpected task filter date", {
        displayMessage: errorDisplayMessage`Unexpected date \`${dateString}\` in the \`${key}\` task filter. Try again with an ISO 8601 date (e.g. \`${key}=2026-07-12\`), \`today\` (e.g. \`${key}=today\`), or a date relative to today with the units \`d\`, \`w\`, \`mo\`, or \`y\` (e.g. \`${key}=today+2w\` or \`${key}=today-3d\`).`,
    });
}

function createAgentWebTaskFilterDateDuration(
    unit: string,
    count: number,
): ApiTaskDateFilterOperationDuration {
    switch (unit) {
        case "d":
            return {type: "Days", days: count};
        case "w":
            return {type: "Weeks", weeks: count};
        case "mo":
            return {type: "Months", months: count};
        case "y":
            return {type: "Years", years: count};
        default:
            throw new InternalError("Unexpected task filter date duration unit");
    }
}
