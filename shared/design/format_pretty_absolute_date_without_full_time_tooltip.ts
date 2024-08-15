import {TimeZone} from "~/shared/helpers/date/time_zone.js";

/**
 * Format the provided `time` into a human readable string like
 * "Aug 6 at 1:06pm".
 */
export function formatPrettyAbsoluteDateWithoutFullTimeTooltip(
    locale: string,
    timeZone: TimeZone,
    currentTime: Date,
    time: Date,
    options?: {
        shouldExcludeTime?: boolean;
        shouldIncludeSeconds?: boolean;
        shouldIncludeWeekday?: boolean;
    },
): string {
    return createPrettyAbsoluteDateFormatterWithoutFullTimeTooltip(
        locale,
        timeZone,
        currentTime,
        options,
    )(time);
}

export function createPrettyAbsoluteDateFormatterWithoutFullTimeTooltip(
    locale: string,
    timeZone: TimeZone,
    currentTime: Date,
    {
        shouldExcludeTime,
        shouldIncludeSeconds,
        shouldIncludeWeekday,
    }: {
        shouldExcludeTime?: boolean;
        shouldIncludeSeconds?: boolean;
        shouldIncludeWeekday?: boolean;
    } = {},
) {
    const baseOptions: Intl.DateTimeFormatOptions = {
        timeZone,
        calendar: "iso8601",
        day: "numeric",
        weekday: shouldIncludeWeekday ? "short" : undefined,
        hour: !shouldExcludeTime ? "numeric" : undefined,
        minute: !shouldExcludeTime ? "2-digit" : undefined,
        second: shouldIncludeSeconds ? "2-digit" : undefined,
        hour12: true,
    };

    const formatterWithoutYear = new Intl.DateTimeFormat(locale, {
        ...baseOptions,
        month: "short",
    });

    const formatterWithYear = new Intl.DateTimeFormat(locale, {
        ...baseOptions,
        year: "numeric",
        // If we include a short weekday, always use short months as well.
        month: !shouldIncludeWeekday ? "long" : "short",
    });

    return (time: Date): string => {
        const isCurrentYear = currentTime.getFullYear() === time.getFullYear();

        const formatter = isCurrentYear ? formatterWithoutYear : formatterWithYear;

        return formatter
            .format(time)
            .replace(/, (\d+:\d+)/, " at $1")
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
    };
}
