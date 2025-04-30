import {CalendarDate} from "@internationalized/date";
import {
    IntlDateTimeFormatOptions,
    getIntlDateTimeFormat,
} from "~/shared/helpers/intl/get_intl_date_time_format.js";
import {Locale} from "~/shared/helpers/intl/locale.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";

/**
 * Format the provided `time` into a human readable string like
 * "Aug 6 at 1:06pm".
 */
export function formatPrettyAbsoluteDateWithoutFullTimeTooltip(
    locale: Locale,
    timeZone: TimeZone,
    currentDate: CalendarDate,
    time: Date,
    {
        withoutDay,
        withoutTime,
        withSeconds,
        withWeekday,
        withLongMonth,
        withLongWeekday,
    }: {
        withoutDay?: boolean;
        withoutTime?: boolean;
        withSeconds?: boolean;
        withWeekday?: boolean;
        withLongMonth?: boolean;
        withLongWeekday?: boolean;
    } = {},
): string {
    const baseOptions: IntlDateTimeFormatOptions = {
        locale,
        timeZone,
        day: !withoutDay ? "numeric" : undefined,
        weekday: withLongWeekday ? "long" : withWeekday ? "short" : undefined,
        hour: !withoutTime ? "numeric" : undefined,
        minute: !withoutTime ? "2-digit" : undefined,
        second: withSeconds ? "2-digit" : undefined,
    };

    if (withoutDay) {
        const formatterWithoutDay = getIntlDateTimeFormat(baseOptions);

        return formatterWithoutDay
            .format(time)
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
    }

    const formatterWithoutYear = getIntlDateTimeFormat({
        ...baseOptions,
        month: withLongMonth ? "long" : "short",
    });

    const formatterWithYear = getIntlDateTimeFormat({
        ...baseOptions,
        year: "numeric",
        // If we include a short weekday, always use short months as well.
        month: withLongMonth || !withWeekday ? "long" : "short",
    });

    const isCurrentYear = currentDate.year === time.getFullYear();

    const formatter = isCurrentYear ? formatterWithoutYear : formatterWithYear;

    return formatter
        .format(time)
        .replace(/, (\d+:\d+)/, " at $1")
        .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
}
