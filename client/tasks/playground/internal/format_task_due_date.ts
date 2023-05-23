import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {TimeZone} from "~/shared/helpers/date/time_zone";

export function formatTaskDueDate({
    timeZone,
    locale,
    currentTime,
    dueDate,
}: {
    timeZone: TimeZone;
    locale: string;
    currentTime: Date;
    dueDate: CalendarDate;
}): {
    isAfterDueDate: boolean;
    dueDateString: string;
} {
    const currentDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));
    const currentDateComparedWithDueDate = currentDate.compare(dueDate);

    const isAfterDueDate = currentDateComparedWithDueDate > 0;

    let dueDateString: string;
    if (currentDateComparedWithDueDate === 0) {
        dueDateString = "Today";
    } else if (currentDate.copy().subtract({days: 1}).compare(dueDate) === 0) {
        dueDateString = "Yesterday";
    } else if (currentDate.copy().add({days: 1}).compare(dueDate) === 0) {
        dueDateString = "Tomorrow";
    } else {
        const isCurrentYear = currentDate.year === dueDate.year;

        const formatter = new Intl.DateTimeFormat(locale, {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: "short",
            day: "numeric",
        });

        dueDateString = formatter.format(dueDate.toDate(timeZone));
    }

    return {
        isAfterDueDate,
        dueDateString,
    };
}
