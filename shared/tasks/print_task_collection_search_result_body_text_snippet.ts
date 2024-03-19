import {formatPrettyRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_relative_date_without_full_time_tooltip.js";

export function printTaskCollectionSearchResultBodyTextSnippet({
    currentTime,
    createdTime,
    lastTaskAddedTime,
    openTaskCount,
}: {
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
