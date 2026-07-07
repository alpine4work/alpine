import {parseDate} from "@internationalized/date";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/create_agent_web_page_link_pathname.js";
import {routeAgentWebPageLinkPathname} from "~/server/agents/web/route_agent_web_page_link_pathname.js";
import {normalizeApiTaskFilters} from "~/shared/api/content/normalize_api_task_filters.js";
import {intoApiAccountReference} from "~/shared/api/specification/into_api_account_reference.js";
import {
    ApiTaskAccountFilterOperationAccount,
    ApiTaskAccountFilterOperationAccountResponse,
    ApiTaskCollectionPreviewResponse,
    ApiTaskDateFilterOperationDate,
    ApiTaskDateFilterOperationDuration,
    ApiTaskFilter,
    ApiTaskFilterResponse,
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
 * - Every search param is its own filter and all filters must match, so `&` always
 *   means "and" (`status=open&title=launch` is open tasks with "launch" in the
 *   title, `due[after]=2026-07-01&due[before]=2026-08-01` is a date range).
 *   Repeating a key makes multiple filters: `status=open&status=closed` requires
 *   both so it matches no tasks, use `status=open,closed` for either.
 *
 * - Comma separated values in a `status`, `priority`, `layout`, `assignee`,
 *   `creator`, `assigner`, or `collection` param match tasks with _any_ of the
 *   values (`priority=high,medium` is high or medium priority) since these filters
 *   hold a list of values. Commas in `title` params stay literal text since title
 *   filters hold text instead of a list.
 *
 * - A `[not]` operator inverts a filter (`status[not]=closed`,
 *   `assignee[not]=me`). Comma separated `[not]` values match tasks with _none_ of
 *   the values.
 *
 * - `collection[all]` matches tasks in _every_ listed collection
 *   (`collection[all]=engineering,design`) instead of at least one.
 *
 * - An empty value is a filter that hasn't been fully configured in the task
 *   filter editor UI yet: `due[before]=` is a date filter with no date chosen (it
 *   matches all tasks), `title=` is a title filter with no text (it matches all
 *   tasks), and `status=` is a status filter with no statuses chosen (it matches
 *   no tasks). Empty comma segments don't add values (`status=open,` is just
 *   `open`).
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
    filters: ReadonlyArray<ApiTaskFilterResponse>,
): Promise<string> {
    filters = normalizeApiTaskFilters(filters);

    const searchParams = await runAllPromises(
        filters.map(filter => printAgentWebTaskFilter(storage, filter)),
    );

    return searchParams.join("&");
}

async function printAgentWebTaskFilter(
    storage: AgentWebSessionStorage,
    filter: ApiTaskFilterResponse,
): Promise<string> {
    switch (filter.type) {
        case "Status": {
            const {operation} = filter;

            const key = {
                OneOf: "status",
                NoneOf: "status[not]",
            }[operation.type];

            return printAgentWebTaskFilterListValues(
                key,
                operation.statuses.map(printAgentWebTaskFilterStatus),
            );
        }
        case "Collections": {
            const {operation} = filter;

            switch (operation.type) {
                case "IsEmpty": {
                    return "collection=none";
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
                            printAgentWebTaskFilterCollection(storage, collection),
                        ),
                    );

                    return printAgentWebTaskFilterListValues(key, values);
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

            return printAgentWebTaskFilterListValues(
                key,
                operation.priorities.map(printAgentWebTaskFilterPriority),
            );
        }
        case "Layout": {
            const {operation} = filter;

            const key = {
                OneOf: "layout",
                NoneOf: "layout[not]",
            }[operation.type];

            return printAgentWebTaskFilterListValues(
                key,
                operation.layouts.map(printAgentWebTaskFilterLayout),
            );
        }
        case "Title": {
            const {operation} = filter;

            const key = {
                Includes: "title",
                Excludes: "title[not]",
            }[operation.type];

            // An empty title query (`title=`) is a title filter whose text hasn't been typed
            // yet in the task filter editor UI.
            return `${key}=${escapeAgentWebTaskFilterText(operation.titleQuery)}`;
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

            return printAgentWebTaskFilterListValues(key, values);
        }
        case "Due": {
            const {operation} = filter;

            switch (operation.type) {
                case "Overdue": {
                    return "due=overdue";
                }
                case "IsEmpty": {
                    return "due=none";
                }
                case "LessThan":
                case "GreaterThan": {
                    return printAgentWebTaskFilterDateOperation("due", operation);
                }
                default:
                    throw exhaustive(operation);
            }
        }
        case "CreatedDate": {
            return printAgentWebTaskFilterDateOperation("created", filter.operation);
        }
        case "AssignedDate": {
            return printAgentWebTaskFilterDateOperation("assigned", filter.operation);
        }
        case "ClosedDate": {
            return printAgentWebTaskFilterDateOperation("closed", filter.operation);
        }
        case "ActivatedDate": {
            return printAgentWebTaskFilterDateOperation("activated", filter.operation);
        }
        default:
            throw exhaustive(filter);
    }
}

/**
 * Prints a list filter's values as one comma separated search param. A list filter
 * with no values (which the task filter editor UI represents as a filter that
 * hasn't been fully configured yet) prints as an empty value (e.g. `status=`).
 */
function printAgentWebTaskFilterListValues(key: string, values: ReadonlyArray<string>): string {
    return `${key}=${values.join(",")}`;
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
    collection: ApiTaskCollectionPreviewResponse,
): Promise<string> {
    const pathname = await createAgentWebPageLinkPathname(storage, {
        type: "TaskCollection",
        id: collection.id,
        title: collection.name,
    });

    assert(pathname.startsWith("/task-collection/"));
    const name = pathname.slice("/task-collection/".length);

    // A task collection whose pathname name collides with a reserved filter value
    // would parse back as the reserved value so we print its full path instead.
    if (name === "none") return pathname;

    return name;
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
    account: ApiTaskAccountFilterOperationAccountResponse,
): Promise<string> {
    switch (account.type) {
        case "Account": {
            const pathname = await createAgentWebPageLinkPathname(
                storage,
                intoApiAccountReference(account.account),
            );

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
 * Every search param parses to its own filter so `&` always means "and". Search
 * params we don't recognize as task filters (like a caller's pagination params)
 * are ignored.
 *
 * Accepts a pre-parsed `URLSearchParams` since the agent web `read` tool already
 * parses paths with `normalizeAgentWebPath()`. `URLSearchParams` decodes `+` as a
 * space so date values like `today+3d` reach us as `today 3d`. We treat the space
 * as a `+` so agents can write either `today+3d` or `today%2B3d`.
 */
export async function parseAgentWebTaskFilters(
    storage: AgentWebSessionStorage,
    searchParams: URLSearchParams,
): Promise<ReadonlyArray<ApiTaskFilter>> {
    const filterPromises: Array<Promise<ApiTaskFilter>> = [];

    for (const [key, value] of searchParams.entries()) {
        const keyMatch = key.match(/^([a-z]+)\[([a-z]+)\]$/);
        const filterKey = keyMatch ? keyMatch[1]! : key;
        const operator = keyMatch ? keyMatch[2]! : null;

        const isFilterKey =
            filterKey === "status" ||
            filterKey === "priority" ||
            filterKey === "layout" ||
            filterKey === "collection" ||
            filterKey === "assignee" ||
            filterKey === "creator" ||
            filterKey === "assigner" ||
            filterKey === "title" ||
            filterKey === "due" ||
            filterKey === "created" ||
            filterKey === "assigned" ||
            filterKey === "closed" ||
            filterKey === "activated";

        // Search params we don't recognize as task filters are ignored.
        if (!isFilterKey) continue;

        filterPromises.push(
            parseAgentWebTaskFilterSearchParam(storage, {key, filterKey, operator, value}),
        );
    }

    return normalizeApiTaskFilters(await runAllPromises(filterPromises));
}

async function parseAgentWebTaskFilterSearchParam(
    storage: AgentWebSessionStorage,
    {
        key,
        filterKey,
        operator,
        value,
    }: {
        key: string;
        filterKey: string;
        operator: string | null;
        value: string;
    },
): Promise<ApiTaskFilter> {
    switch (filterKey) {
        case "status": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`status\` or \`status[not]\``,
                );
            }

            return {
                type: "Status",
                operation: {
                    type: operator === "not" ? "NoneOf" : "OneOf",
                    statuses: splitAgentWebTaskFilterListValue(value).map(
                        parseAgentWebTaskFilterStatus,
                    ),
                },
            };
        }
        case "priority": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`priority\` or \`priority[not]\``,
                );
            }

            return {
                type: "Priority",
                operation: {
                    type: operator === "not" ? "NoneOf" : "OneOf",
                    priorities: splitAgentWebTaskFilterListValue(value).map(
                        parseAgentWebTaskFilterPriority,
                    ),
                },
            };
        }
        case "layout": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`layout\` or \`layout[not]\``,
                );
            }

            const layouts = splitAgentWebTaskFilterListValue(value);

            // Unlike other list filters, a layout filter with no layouts isn't a state the
            // task filter editor UI can represent so we don't accept it.
            if (layouts.length === 0) {
                throw new InvalidArgumentError("Empty task layout filter", {
                    displayMessage: errorDisplayMessage`Unexpected empty value in the \`${key}\` task filter. Try again with \`project\` (e.g. \`layout=project\`).`,
                });
            }

            return {
                type: "Layout",
                operation: {
                    type: operator === "not" ? "NoneOf" : "OneOf",
                    layouts: layouts.map(parseAgentWebTaskFilterLayout),
                },
            };
        }
        case "title": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`title\` or \`title[not]\``,
                );
            }

            // Title filters hold text instead of a list of values so commas stay literal. An
            // empty value (`title=`) is a title filter whose text hasn't been typed yet in the
            // task filter editor UI.
            return {
                type: "Title",
                operation: {
                    type: operator === "not" ? "Excludes" : "Includes",
                    titleQuery: value,
                },
            };
        }
        case "collection": {
            if (operator !== null && operator !== "all" && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`collection\`, \`collection[all]\`, or \`collection[not]\``,
                );
            }

            return await parseAgentWebTaskFilterCollections(
                storage,
                operator,
                splitAgentWebTaskFilterListValue(value),
            );
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
                splitAgentWebTaskFilterListValue(value).map(accountValue =>
                    parseAgentWebTaskFilterAccount(storage, filterKey, accountValue),
                ),
            );

            return {
                type: filterKey === "assignee" ? "Assignee" : "Assigner",
                operation: {
                    type: operator === "not" ? "NoneOf" : "OneOf",
                    accounts,
                },
            };
        }
        case "creator": {
            if (operator !== null && operator !== "not") {
                throw createAgentWebTaskFilterOperatorError(
                    key,
                    errorDisplayMessage`\`creator\` or \`creator[not]\``,
                );
            }

            const accounts = await runAllPromises(
                splitAgentWebTaskFilterListValue(value).map(async accountValue => {
                    const account = await parseAgentWebTaskFilterAccount(
                        storage,
                        filterKey,
                        accountValue,
                    );

                    // `parseAgentWebTaskFilterAccount()` throws for `creator=none` when `filterKey` is
                    // `"creator"` so a missing account is impossible here.
                    assert(account.type !== "MissingAccount");

                    return account;
                }),
            );

            return {
                type: "Creator",
                operation: {
                    type: operator === "not" ? "NoneOf" : "OneOf",
                    accounts,
                },
            };
        }
        case "due": {
            if (operator === null) {
                if (value === "overdue") return {type: "Due", operation: {type: "Overdue"}};
                if (value === "none") return {type: "Due", operation: {type: "IsEmpty"}};

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

            return {
                type: "Due",
                operation: {
                    type: operator === "before" ? "LessThan" : "GreaterThan",
                    date: parseAgentWebTaskFilterDate(key, value),
                },
            };
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

            const filterType =
                filterKey === "created"
                    ? "CreatedDate"
                    : filterKey === "assigned"
                      ? "AssignedDate"
                      : filterKey === "closed"
                        ? "ClosedDate"
                        : "ActivatedDate";

            return {
                type: filterType,
                operation: {
                    type: operator === "before" ? "LessThan" : "GreaterThan",
                    date: parseAgentWebTaskFilterDate(key, value),
                },
            };
        }
        default: {
            // `parseAgentWebTaskFilters()` only parses search params with recognized filter
            // keys, every other search param is ignored.
            throw new InternalError(`Unexpected task filter key \u201c${filterKey}\u201d`);
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
 * Splits a comma separated list filter value into the filter's values. Empty
 * segments don't add values (`status=open,` is just `open`) and a fully empty
 * value (`status=`) is a filter with no values which is a filter that hasn't been
 * fully configured in the task filter editor UI yet.
 */
function splitAgentWebTaskFilterListValue(value: string): Array<string> {
    return value.split(",").filter(segment => segment.length > 0);
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

async function parseAgentWebTaskFilterCollections(
    storage: AgentWebSessionStorage,
    operator: "all" | "not" | null,
    values: ReadonlyArray<string>,
): Promise<ApiTaskFilter> {
    // In a bare `collection` param the `none` value is a "tasks in no collections"
    // filter of its own. It can't be combined with collections in the same filter
    // since a filter matches tasks with any of its values and a task with no
    // collections can never also be in a collection.
    if (operator === null && values.includes("none")) {
        if (values.length > 1) {
            throw new InvalidArgumentError("Conflicting task collection filter values", {
                displayMessage: errorDisplayMessage`\`none\` can\u2019t be combined with other collections in the \`collection\` task filter since a task with no collections can\u2019t also be in a collection. Try again with either \`collection=none\` or a list of collection names (e.g. \`collection=roadmap,design\`).`,
            });
        }

        return {type: "Collections", operation: {type: "IsEmpty"}};
    }

    const operationType =
        operator === null
            ? "IncludesOneOf"
            : operator === "all"
              ? "IncludesAllOf"
              : "ExcludesAllOf";

    const collections = await runAllPromises(
        values.map(async value => ({
            id: await parseAgentWebTaskFilterCollectionId(storage, value),
        })),
    );

    return {type: "Collections", operation: {type: operationType, collections}};
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
        // `parseDate()` throws for out of range date fields (e.g. month 13 or day 31 in
        // February) but it also accepts and coerces some impossible dates (e.g. year 0000
        // is parsed as year 0001), so we also check that the parsed date prints back
        // unchanged.
        let isValidDate: boolean;
        try {
            isValidDate = parseDate(dateString).toString() === dateString;
        } catch {
            isValidDate = false;
        }

        if (!isValidDate) {
            throw new InvalidArgumentError("Unexpected task filter date", {
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
