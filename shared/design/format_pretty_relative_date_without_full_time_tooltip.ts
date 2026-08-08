import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {differenceInDays} from "date-fns/differenceInDays";
import {differenceInMonths} from "date-fns/differenceInMonths";
import {differenceInWeeks} from "date-fns/differenceInWeeks";
import {differenceInYears} from "date-fns/differenceInYears";
import {startOfWeek} from "date-fns/startOfWeek";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

const nameByNumber = new Map([
    [1, "one"],
    [2, "two"],
    [3, "three"],
    [4, "four"],
    [5, "five"],
    [6, "six"],
    [7, "seven"],
    [8, "eight"],
    [9, "nine"],
    [10, "ten"],
]);

/**
 * Format the provided `time` as a human readable string relative to `currentTime`.
 * For example "two days ago" or "yesterday" or "a month ago".
 *
 * Does not provide a way for the user to see the exact time. Generally you should
 * also include a tooltip with the exact time for the user.
 */
export function formatPrettyRelativeDateWithoutFullTimeTooltip(
    timeZone: TimeZone,
    currentTime: Date,
    time: Date,
    smallestGranularity: "Weeks" | "Days",
): string {
    const currentDate = toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone));
    const date = toCalendarDate(parseAbsolute(time.toISOString(), timeZone));

    // Normalize times to the start of the day in the provided time zone. A time 23
    // hours ago should generally be marked as "Yesterday" not "Today" unless the time
    // was at 1am.
    currentTime = currentDate.toDate(timeZone);
    time = date.toDate(timeZone);

    const years = differenceInYears(currentTime, time);

    if (years === 1) {
        return "a year ago";
    } else if (years > 1) {
        return `${nameByNumber.get(years) ?? years} years ago`;
    }

    const months = differenceInMonths(currentTime, time);

    if (months === 1) {
        return "a month ago";
    } else if (months > 1) {
        return `${nameByNumber.get(months) ?? months} months ago`;
    }

    const weeks = differenceInWeeks(currentTime, time);

    if (weeks === 1) {
        return "a week ago";
    } else if (weeks > 1) {
        return `${nameByNumber.get(weeks) ?? weeks} weeks ago`;
    }

    // If the smallest granularity is in weeks we only want to say "this week" if
    // `time` is in the same calendar week as `currentTime`. Not if it's in the last 7
    // days.
    if (smallestGranularity === "Weeks") {
        return startOfWeek(currentTime).getTime() === startOfWeek(time).getTime()
            ? "this week"
            : "a week ago";
    }

    const days = differenceInDays(currentTime, time);
    if (days === 1) {
        return "yesterday";
    } else if (days > 1) {
        return `${nameByNumber.get(days) ?? days} days ago`;
    } else {
        // Check with TypeScript that by this point `smallestGranularity` should be `Days`.
        cast<"Days">(smallestGranularity);

        return "today";
    }
}
