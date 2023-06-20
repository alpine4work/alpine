import {CalendarDate} from "@internationalized/date";
import {TimeZone} from "~/shared/helpers/date/time_zone";

export function formatTaskDate({
    timeZone,
    locale,
    currentDate,
    date,
    shouldFormatAroundToday,
}: {
    timeZone: TimeZone;
    locale: string;
    currentDate: CalendarDate;
    date: CalendarDate;
    shouldFormatAroundToday: boolean;
}): {
    isAfterDate: boolean;
    isFormattedAroundToday: boolean;
    dateString: string;
} {
    const currentDateComparedWithDate = currentDate.compare(date);

    const isAfterDate = currentDateComparedWithDate > 0;

    let dateString: string;
    let isFormattedAroundToday: boolean;

    if (shouldFormatAroundToday && currentDateComparedWithDate === 0) {
        dateString = "Today";
        isFormattedAroundToday = true;
    } else if (
        shouldFormatAroundToday &&
        currentDate.copy().subtract({days: 1}).compare(date) === 0
    ) {
        dateString = "Yesterday";
        isFormattedAroundToday = true;
    } else if (shouldFormatAroundToday && currentDate.copy().add({days: 1}).compare(date) === 0) {
        dateString = "Tomorrow";
        isFormattedAroundToday = true;
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
        isFormattedAroundToday = false;
    }

    return {
        isAfterDate,
        isFormattedAroundToday,
        dateString,
    };
}
