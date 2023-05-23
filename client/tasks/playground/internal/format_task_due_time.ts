import {differenceInDays} from "date-fns";
import {TimeZone} from "~/shared/helpers/date/time_zone";

export function formatTaskDueTime({
    timeZone,
    currentTime,
    dueTime,
}: {
    timeZone: TimeZone;
    currentTime: Date;
    dueTime: Date;
}) {
    const dayDifference = differenceInDays(currentTime, dueTime);

    if (dayDifference === 0) {
        return "Today";
    } else if (dayDifference === 1) {
        return "Yesterday";
    } else if (dayDifference === -1) {
        return "Tomorrow";
    } else {
        const isCurrentYear = currentTime.getFullYear() === dueTime.getFullYear();

        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: "short",
            day: "numeric",
        });

        return formatter.format(dueTime);
    }
}
