import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {differenceInDays} from "date-fns";
import {TimeZone} from "~/shared/helpers/date/time_zone.js";

let formatter1: Intl.DateTimeFormat | undefined;
let formatter2: Intl.DateTimeFormat | undefined;
let formatter3: Intl.DateTimeFormat | undefined;
let formatter4: Intl.DateTimeFormat | undefined;

export function formatMessageViewTimestampDividerDate(
    time: Date,
    {currentTime, locale, timeZone}: {currentTime: Date; locale: string; timeZone: TimeZone},
) {
    const currentDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));
    const date = toCalendarDate(parseAbsolute(time.toISOString(), timeZone));

    // Normalize times to the start of the day in the provided time zone. A time 23
    // hours ago should generally be marked as "Yesterday" not "Today" unless the
    // time was at 1am.
    const dayDifference = differenceInDays(currentDate.toDate(timeZone), date.toDate(timeZone));
    if (dayDifference < 7) {
        const formatter =
            dayDifference >= 2
                ? (formatter1 ??= new Intl.DateTimeFormat(locale, {
                      timeZone,
                      calendar: "iso8601",
                      weekday: "long",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                  }))
                : (formatter2 ??= new Intl.DateTimeFormat(locale, {
                      timeZone,
                      calendar: "iso8601",
                      hour: "numeric",
                      minute: "2-digit",
                      hour12: true,
                  }));

        const timeString = formatter
            .format(time)
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());

        if (dayDifference <= 0) {
            return `Today ${timeString}`;
        } else if (dayDifference === 1) {
            return `Yesterday ${timeString}`;
        } else {
            return timeString;
        }
    }

    const isCurrentYear = currentDate.year === date.year;

    const formatter = !isCurrentYear
        ? (formatter3 ??= new Intl.DateTimeFormat(locale, {
              timeZone,
              calendar: "iso8601",
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
          }))
        : (formatter4 ??= new Intl.DateTimeFormat(locale, {
              timeZone,
              calendar: "iso8601",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              hour12: true,
          }));

    return formatter
        .format(time)
        .replace(/, (\d+:\d+)/, " at $1")
        .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
}
