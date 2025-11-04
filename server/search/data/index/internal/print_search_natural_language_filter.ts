import {parseAbsolute, toCalendarDate} from "@internationalized/date";
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
        readonly field: "Creator" | "MajorContributor" | "AnyContributor";
        readonly accounts: ReadonlyArray<{readonly id: AccountId; readonly name: string}>;
    } | null;
    readonly time: {
        readonly field: "Created" | "LastUpdated";
        readonly range:
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: Date}
            | {readonly inclusiveUpperBoundDate: Date; readonly inclusiveLowerBoundDate: null}
            | {readonly inclusiveUpperBoundDate: null; readonly inclusiveLowerBoundDate: Date};
    } | null;
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
        const accountText = printAccount(filter.account, filter.entityTypes, filter.time);
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

    if (time) {
        // If we have any time filter, the time part will already say "created" or "updated"
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
    }
}

function printTime(
    time: NonNullable<SearchNaturalLanguageFilter["time"]>,
    entityTypes: ReadonlyArray<SearchDynamicEntityIdObject["type"]>,
    timeZone: TimeZone,
    currentTime: Date,
    accountField?: "Creator" | "MajorContributor" | "AnyContributor",
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
    } else {
        // No account field or MajorContributor - use the time field's verb
        fieldPrefix = field === "Created" ? (isChatMessage ? "sent" : "created") : "updated";
    }

    const {inclusiveLowerBoundDate, inclusiveUpperBoundDate} = range;

    // Both bounds present - specific range
    if (inclusiveLowerBoundDate && inclusiveUpperBoundDate) {
        const startDate = formatDate(inclusiveLowerBoundDate, timeZone, currentTime);
        const endDate = formatDate(inclusiveUpperBoundDate, timeZone, currentTime);

        if (isSameDay(inclusiveLowerBoundDate, inclusiveUpperBoundDate)) {
            return `${fieldPrefix} ${startDate}`;
        }

        return `${fieldPrefix} between ${startDate} and ${endDate}`;
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
