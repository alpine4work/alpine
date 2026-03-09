import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {SearchNaturalLanguageFilter} from "~/server/search/data/index/internal/parse_search_natural_language_query.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {SearchDynamicEntityIdObject} from "~/shared/search/search_entity_id.js";

type HandledNaturalLanguageFilter = {
    readonly entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>;
    readonly account: {
        readonly field: "Creator" | "MajorContributor" | "AnyContributor" | "Assignee";
        readonly accounts: ReadonlyArray<{readonly id: AccountId; readonly name: string}>;
    } | null;
    readonly time: {
        readonly field: "Created" | "LastUpdated";
        readonly range:
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: Date}
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: null}
            | {readonly inclusiveUpperBoundDate: null; readonly inclusiveLowerBoundDate: Date};
    } | null;
    readonly date: {
        readonly field: "Due";
        readonly range:
            | {
                  readonly inclusiveUpperBound: CalendarDate;
                  readonly inclusiveLowerBound: CalendarDate;
              }
            | {readonly inclusiveUpperBound: CalendarDate; readonly inclusiveLowerBound: null}
            | {readonly inclusiveUpperBound: null; readonly inclusiveLowerBound: CalendarDate};
    } | null;
    readonly priority: SearchNaturalLanguageFilter["priority"];
    readonly openness: SearchNaturalLanguageFilter["openness"];
    readonly activeness: SearchNaturalLanguageFilter["activeness"];
};
// If you add a new key to SearchNaturalLanguageFilter, make sure to handle it
// in `printSearchNaturalLanguageFilter` and add it to `HandledNaturalLanguageFilter`.
assertEqualTypes<HandledNaturalLanguageFilter, SearchNaturalLanguageFilter>();

/**
 * Converts a SearchNaturalLanguageFilter object into a human-readable string
 * representation. For example, a filter with entity types ["Document"], account
 * field "Creator", and a time range might become "documents created by John yesterday".
 */
export function printSearchNaturalLanguageFilter(
    filter: SearchNaturalLanguageFilter,
    timeZone: TimeZone,
    currentTime: Date,
): string {
    const parts: Array<string> = [];

    const entityTypesText = printEntityTypes(filter.entityTypes);
    parts.push(entityTypesText);

    if (filter.account) {
        const accountText = printAccount(
            filter.account,
            filter.entityTypes,
            filter.time,
            filter.date,
        );
        if (accountText) {
            parts.push(accountText);
        }
    }

    if (filter.time) {
        const timeText = printTime(
            filter.time,
            filter.entityTypes,
            timeZone,
            currentTime,
            filter.account?.field,
        );
        if (timeText) {
            parts.push(timeText);
        }
    }

    if (filter.date) {
        const dateText = printDate(filter.date, timeZone, currentTime, filter.date.field);
        if (dateText) {
            parts.push(dateText);
        }
    }

    const modifiers: Array<string> = [];
    if (filter.openness && filter.openness.length > 0) {
        modifiers.push(printOpenness(filter.openness));
    }

    if (filter.activeness && filter.activeness.length > 0) {
        modifiers.push(printActiveness(filter.activeness));
    }

    if (filter.priority && filter.priority.length > 0) {
        modifiers.push(`${printPriority(filter.priority)} priority`);
    }

    if (modifiers.length > 0) {
        parts.push(`that are ${joinPrettyConjunctionList(modifiers)}`);
    }

    return parts.join(" ");
}

function printEntityTypes(entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>): string {
    const entityTypeSet = new Set(entityTypes);

    if (
        entityTypeSet.has("ChatMessage") &&
        entityTypeSet.has("DocumentComment") &&
        entityTypeSet.has("PostComment") &&
        entityTypeSet.size === 3
    ) {
        return "messages";
    }

    if (
        entityTypeSet.has("Task") &&
        entityTypeSet.has("TaskCollection") &&
        entityTypeSet.size === 2
    ) {
        return "tasks";
    }

    if (entityTypes.length === 1) {
        const entityType = entityTypes[0]!;
        switch (entityType) {
            case "Account":
                return "people";
            case "Chat":
                return "chats";
            case "ChatMessage":
                return "chat messages";
            case "Channel":
                return "channels";
            case "Database":
                return "databases";
            case "Document":
                return "documents";
            case "DocumentComment":
                return "document comments";
            case "Post":
                return "posts";
            case "PostComment":
                return "post comments";
            case "Task":
                return "tasks";
            case "TaskComment":
                return "task comments";
            case "TaskCollection":
                return "task collections";
            default:
                throw exhaustive(entityType);
        }
    }

    return joinPrettyConjunctionList(entityTypes.map(type => printEntityTypes([type])));
}

function printAccount(
    account: NonNullable<SearchNaturalLanguageFilter["account"]>,
    entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>,
    time: SearchNaturalLanguageFilter["time"],
    date: SearchNaturalLanguageFilter["date"],
): string {
    const accountNames = account.accounts.map(acc => acc.name);
    const accountNameString = joinPrettyConjunctionList(accountNames, "or");

    // For messages (chat messages, document comments, post comments), use "from"
    // instead of "by" since they always have a single author
    const entityTypeSet = new Set(entityTypes);
    const isMessages =
        entityTypeSet.has("ChatMessage") ||
        entityTypeSet.has("DocumentComment") ||
        entityTypeSet.has("PostComment");
    const isPost = entityTypeSet.has("Post");

    if (isMessages) {
        return `from ${accountNameString}`;
    }

    if (time || date) {
        // If we have any time/date filter, the time part will already say "created" or "updated"
        // so just use "by" to avoid duplication like "created by X created yesterday"
        return `by ${accountNameString}`;
    }

    if (isPost) {
        // For posts, always use "created" instead of "updated" since posts are authored
        // by a single person.
        return `created by ${accountNameString}`;
    }

    switch (account.field) {
        case "Creator":
            return `created by ${accountNameString}`;
        case "MajorContributor":
            return `by ${accountNameString}`;
        case "AnyContributor":
            return `updated by ${accountNameString}`;
        case "Assignee":
            return `assigned to ${accountNameString}`;
        default:
            throw exhaustive(account.field);
    }
}

function printTime(
    time: NonNullable<SearchNaturalLanguageFilter["time"]>,
    entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>,
    timeZone: TimeZone,
    currentTime: Date,
    accountField?: "Creator" | "MajorContributor" | "AnyContributor" | "Assignee",
): string {
    const {field, range} = time;

    const entityTypeSet = new Set(entityTypes);
    const isChatMessage = entityTypeSet.has("ChatMessage") && entityTypeSet.size === 1;
    const isPost = entityTypeSet.has("Post");
    const isMessage =
        entityTypeSet.has("ChatMessage") ||
        entityTypeSet.has("DocumentComment") ||
        entityTypeSet.has("PostComment");

    // Determine which verb to use based on account field priority and entity type
    let fieldPrefix: string;
    if (accountField === "AnyContributor") {
        // For messages and posts, always use "created" (or "sent" for chat messages)
        // because these entities are fundamentally authored/created, not updated
        if (isMessage) {
            fieldPrefix = isChatMessage ? "sent" : "created";
        } else if (isPost) {
            fieldPrefix = "created";
        } else {
            // For other entities (documents, tasks, etc), AnyContributor means "updated"
            fieldPrefix = "updated";
        }
    } else if (accountField === "Creator") {
        // Creator means "created", so always use "created" even if time is LastUpdated
        fieldPrefix = isChatMessage ? "sent" : "created";
    } else if (accountField === "MajorContributor") {
        // MajorContributor - use the time field's verb
        fieldPrefix = field === "Created" ? (isChatMessage ? "sent" : "created") : "updated";
    } else {
        // No account field - use the time field's verb
        fieldPrefix = field === "Created" ? (isChatMessage ? "sent" : "created") : "updated";
    }

    const {inclusiveLowerBoundDate, inclusiveUpperBoundDate} = range;

    // Both bounds present - specific range
    if (inclusiveLowerBoundDate && inclusiveUpperBoundDate) {
        const startDateStr = formatDate(inclusiveLowerBoundDate, timeZone, currentTime);
        const endDateStr = formatDate(inclusiveUpperBoundDate, timeZone, currentTime);

        if (isSameDay(inclusiveLowerBoundDate, inclusiveUpperBoundDate)) {
            return `${fieldPrefix} ${startDateStr}`;
        }

        return `${fieldPrefix} between ${startDateStr} and ${endDateStr}`;
    }

    // Only lower bound - after a date
    if (inclusiveLowerBoundDate && !inclusiveUpperBoundDate) {
        return `${fieldPrefix} after ${formatDate(inclusiveLowerBoundDate, timeZone, currentTime)}`;
    }

    // Only upper bound - before a date
    if (!inclusiveLowerBoundDate && inclusiveUpperBoundDate) {
        return `${fieldPrefix} before ${formatDate(
            inclusiveUpperBoundDate,
            timeZone,
            currentTime,
        )}`;
    }

    return "";
}

function printDate(
    date: NonNullable<SearchNaturalLanguageFilter["date"]>,
    timeZone: TimeZone,
    currentTime: Date,
    field: "Due",
): string {
    const {range} = date;

    const {inclusiveLowerBound, inclusiveUpperBound} = range;

    let fieldPrefix: string;
    switch (field) {
        case "Due":
            fieldPrefix = "due";
            break;
        default:
            throw exhaustive(field);
    }

    // Both bounds present - specific range
    if (inclusiveLowerBound && inclusiveUpperBound) {
        const startDateStr = formatCalendarDate(inclusiveLowerBound, timeZone, currentTime);
        const endDateStr = formatCalendarDate(inclusiveUpperBound, timeZone, currentTime);

        if (inclusiveLowerBound.compare(inclusiveUpperBound) === 0) {
            return `${fieldPrefix} ${startDateStr}`;
        }

        return `${fieldPrefix} between ${startDateStr} and ${endDateStr}`;
    }

    // Only lower bound - after a date
    if (inclusiveLowerBound && !inclusiveUpperBound) {
        return `${fieldPrefix} after ${formatCalendarDate(inclusiveLowerBound, timeZone, currentTime)}`;
    }

    // Only upper bound - before a date (overdue)
    if (!inclusiveLowerBound && inclusiveUpperBound) {
        return `${fieldPrefix} before ${formatCalendarDate(inclusiveUpperBound, timeZone, currentTime)}`;
    }

    return "";
}

function formatCalendarDate(
    calendarDate: CalendarDate,
    timeZone: TimeZone,
    currentTime: Date,
): string {
    const currentCalendarDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));
    const yesterdayCalendarDate = currentCalendarDate.subtract({days: 1});

    if (calendarDate.compare(currentCalendarDate) === 0) {
        return "today";
    }

    if (calendarDate.compare(yesterdayCalendarDate) === 0) {
        return "yesterday";
    }

    // Convert CalendarDate to Date for formatting
    const date = new Date(calendarDate.year, calendarDate.month - 1, calendarDate.day);

    return formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        currentCalendarDate,
        date,
        {
            withoutTime: true,
        },
    );
}

function formatDate(date: Date, timeZone: TimeZone, currentTime: Date): string {
    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);

    if (isSameDay(date, currentTime)) {
        return "today";
    }

    if (isSameDay(date, yesterday)) {
        return "yesterday";
    }

    const currentDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));

    return formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        currentDate,
        date,
        {
            withoutTime: true,
        },
    );
}

function isSameDay(date1: Date, date2: Date): boolean {
    return (
        date1.getFullYear() === date2.getFullYear() &&
        date1.getMonth() === date2.getMonth() &&
        date1.getDate() === date2.getDate()
    );
}

function printPriority(priority: NonNullable<SearchNaturalLanguageFilter["priority"]>): string {
    return joinPrettyConjunctionList(
        priority.map(p => p.toLowerCase()),
        "or",
    );
}

function printOpenness(openness: NonNullable<SearchNaturalLanguageFilter["openness"]>): string {
    return joinPrettyConjunctionList(openness.map(o => o.toLowerCase()));
}

function printActiveness(
    activeness: NonNullable<SearchNaturalLanguageFilter["activeness"]>,
): string {
    return joinPrettyConjunctionList(activeness.map(a => a.toLowerCase()));
}
