import {formatPrettyRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_relative_date_without_full_time_tooltip.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export function printTaskCollectionSearchResultBodyTextSnippet({
    timeZone,
    currentTime,
    createdTime,
    lastTaskAddedTime,
    openTaskCount,
}: {
    timeZone: TimeZone;
    currentTime: Date;
    createdTime: Date;
    lastTaskAddedTime: Date | null;
    openTaskCount: number;
}): string {
    return (
        getTaskCollectionTaskCountSummary(openTaskCount) +
        "," +
        (!lastTaskAddedTime ? " created " : " updated ") +
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            timeZone,
            currentTime,
            !lastTaskAddedTime ? new Date(createdTime) : new Date(lastTaskAddedTime),
            "Weeks",
        )
    );
}

function getTaskCollectionTaskCountSummary(openTaskCount: number) {
    if (openTaskCount === 0) {
        return "No tasks";
    } else if (openTaskCount < 100) {
        return "Several tasks";
    } else if (openTaskCount < 1000) {
        return "Hundreds of tasks";
    } else {
        return "Thousands of tasks";
    }
}
