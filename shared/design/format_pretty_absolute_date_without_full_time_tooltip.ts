import {CalendarDate} from "@internationalized/date";
import {assert} from "~/shared/helpers/control/assert.js";
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
        month: withLongMonth && !withWeekday ? "long" : "short",
    });

    const isCurrentYear = currentDate.year === time.getFullYear();

    const formatter = isCurrentYear ? formatterWithoutYear : formatterWithYear;

    const dateStringParts = formatter.formatToParts(time);
    const dateString = dateStringParts
        .map(({type, value}) => {
            switch (type) {
                case "day":
                    return formatNumberWithOrdinal(Number(value));
                default:
                    return value;
            }
        })
        .join("")
        .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase())
        .replace(/, (\d+:\d+)/, " at $1");
    return dateString;
}

/**
 * Format a number into a string with its English ordinal suffix. For example, 1 becomes "1st",
 * 2 becomes "2nd", 3 becomes "3rd", and so on.
 */
function formatNumberWithOrdinal(number: number) {
    assert(number >= 0, "Cannot get ordinal for a negative number");
    if (number > 3 && number < 21) {
        // Handles 11th, 12th, 13th
        return `${number}th`;
    }
    switch (number % 10) {
        case 1:
            return `${number}st`;
        case 2:
            return `${number}nd`;
        case 3:
            return `${number}rd`;
        default:
            return `${number}th`;
    }
}
