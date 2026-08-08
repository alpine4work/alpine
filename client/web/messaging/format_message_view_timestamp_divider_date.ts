import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {differenceInDays} from "date-fns/differenceInDays";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.open_source.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.open_source.js";
import {Locale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export function formatMessageViewTimestampDividerDate(
    time: Date,
    {currentTime, locale, timeZone}: {currentTime: Date; locale: Locale; timeZone: TimeZone},
) {
    const currentDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));
    const date = toCalendarDate(parseAbsolute(time.toISOString(), timeZone));

    // Normalize times to the start of the day in the provided time zone. A time 23
    // hours ago should generally be marked as "Yesterday" not "Today" unless the time
    // was at 1am.
    const dayDifference = differenceInDays(currentDate.toDate(timeZone), date.toDate(timeZone));
    if (dayDifference < 7) {
        const formatter = getIntlDateTimeFormat({
            locale,
            timeZone,
            weekday: dayDifference >= 2 ? "long" : undefined,
            hour: "numeric",
            minute: "2-digit",
        });

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

    return formatPrettyAbsoluteDateWithoutFullTimeTooltip(locale, timeZone, currentDate, time);
}
