import {differenceInMonths} from "date-fns/differenceInMonths";
import {differenceInYears} from "date-fns/differenceInYears";

/**
 * Format the time elapsed between `currentTime` and `time` as a compact relative
 * label like "5m", "3h", "2d", "2w", "4mo", or "1y". Up to weeks it counts elapsed
 * time rather than calendar boundaries (23 hours ago is "23h", not "1d"); months
 * and years count complete calendar months like
 * `formatPrettyRelativeDateWithoutFullTimeTooltip()`, which keeps the two units
 * consistent with each other (dividing elapsed days by 30 makes 360-364 days "12
 * months old" but "0 years old"). Times under a minute ago — or at/after
 * `currentTime`, e.g. from clock skew — render "now".
 *
 * Does not provide a way for the user to see the exact time. Generally you should
 * also include a tooltip with the exact time for the user.
 */
export function formatCompactRelativeDateWithoutFullTimeTooltip(
    currentTime: Date,
    time: Date,
): string {
    const elapsedMinutes = Math.floor((currentTime.getTime() - time.getTime()) / (60 * 1000));
    if (elapsedMinutes < 1) return "now";
    if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

    const elapsedHours = Math.floor(elapsedMinutes / 60);
    if (elapsedHours < 24) return `${elapsedHours}h`;

    const elapsedDays = Math.floor(elapsedHours / 24);
    if (elapsedDays < 7) return `${elapsedDays}d`;

    const elapsedWeeks = Math.floor(elapsedDays / 7);
    if (elapsedWeeks < 5) return `${elapsedWeeks}w`;

    // Any span the weeks branch doesn't cover (35+ days) crosses at least one complete
    // calendar month, so this never renders "0mo".
    const elapsedMonths = differenceInMonths(currentTime, time);
    if (elapsedMonths < 12) return `${elapsedMonths}mo`;

    return `${differenceInYears(currentTime, time)}y`;
}
