import {CalendarDate} from "@internationalized/date";
import {TimeZone} from "~/shared/helpers/date/time_zone";

export function formatTaskDate({
    timeZone,
    locale,
    currentDate,
    date,
    shouldFormatToday,
}: {
    timeZone: TimeZone;
    locale: string;
    currentDate: CalendarDate;
    date: CalendarDate;
    shouldFormatToday: boolean;
}): {
    isAfterDate: boolean;
    dateString: string;
} {
    const currentDateComparedWithDate = currentDate.compare(date);

    const isAfterDate = currentDateComparedWithDate > 0;

    let dateString: string;
    if (shouldFormatToday && currentDateComparedWithDate === 0) {
        dateString = "Today";
    } else if (shouldFormatToday && currentDate.copy().subtract({days: 1}).compare(date) === 0) {
        dateString = "Yesterday";
    } else if (shouldFormatToday && currentDate.copy().add({days: 1}).compare(date) === 0) {
        dateString = "Tomorrow";
    } else {
        const isCurrentYear = currentDate.year === date.year;

        const formatter = new Intl.DateTimeFormat(locale, {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: "short",
            day: "numeric",
        });

        dateString = formatter.format(date.toDate(timeZone));
    }

    return {
        isAfterDate,
        dateString,
    };
}
