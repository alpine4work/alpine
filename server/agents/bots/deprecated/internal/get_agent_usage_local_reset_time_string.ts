import {
    ZonedDateTime,
    fromDate,
    isSameDay,
    parseAbsolute,
    toCalendarDate,
} from "@internationalized/date";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.open_source.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

export function getAgentUsageLocalResetTimeString(
    resetTime: Date,
    currentTime: Date,
    timeZone: TimeZone,
): string {
    const zonedResetTime = fromDate(resetTime, timeZone);
    // NOTE(ifitzsimmons) using Date.now() allows us to stub out the current time in
    // tests.
    const currentZonedTime = fromDate(new Date(currentTime), timeZone);

    if (isSameDay(toCalendarDate(zonedResetTime), toCalendarDate(currentZonedTime))) {
        return `today at ${getTimeStringWithoutDay(zonedResetTime, timeZone)}`;
    }

    const tomorrowZonedTime = currentZonedTime.add({days: 1});
    if (isSameDay(toCalendarDate(zonedResetTime), toCalendarDate(tomorrowZonedTime))) {
        return `tomorrow at ${getTimeStringWithoutDay(zonedResetTime, timeZone)}`;
    }

    return `on ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        toCalendarDate(parseAbsolute(resetTime.toISOString(), timeZone)),
        resetTime,
    )}`;
}

function getTimeStringWithoutDay(zonedTime: ZonedDateTime, timeZone: TimeZone) {
    return formatPrettyAbsoluteDateWithoutFullTimeTooltip(
        defaultLocale,
        timeZone,
        toCalendarDate(zonedTime),
        zonedTime.toDate(),
        {
            withoutDay: true,
        },
    );
}
