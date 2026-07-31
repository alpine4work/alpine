/**
 * Formats a date string ("YYYY-MM-DD") for display with smart relative labels. All
 * comparisons are in UTC.
 *
 * Relative labels: Today, Yesterday, Tomorrow, day names for current week,
 * Last/Next day names for adjacent weeks, or absolute format "February 25, 2026".
 */

import {
    formatContentDateString,
    parseContentDateString,
} from "~/shared/content/format_content_date_string.js";
import {InternalError} from "~/shared/error/error.js";
import {dateFullMonthNames} from "~/shared/helpers/date/date_month_names.js";

export function formatContentDate(date: string, today: string): string {
    const parsedDate = parseDateString(date);
    const parsedToday = parseDateString(today);

    const diffDays = daysBetween(parsedToday, parsedDate);

    // Today / Yesterday / Tomorrow take highest precedence.
    if (diffDays === 0) return "Today";
    if (diffDays === -1) return "Yesterday";
    if (diffDays === 1) return "Tomorrow";

    const currentWeekMonday = getWeekMonday(parsedToday);
    const dateWeekMonday = getWeekMonday(parsedDate);

    const weekDiff = weeksBetween(currentWeekMonday, dateWeekMonday);

    if (weekDiff === 0) {
        // Same calendar week (Mon-Sun) — just the day name.
        return dayName(parsedDate.dayOfWeek);
    }

    if (weekDiff === -1) {
        // Previous calendar week.
        return `Last ${dayName(parsedDate.dayOfWeek)}`;
    }

    if (weekDiff === 1) {
        // Next calendar week.
        return `Next ${dayName(parsedDate.dayOfWeek)}`;
    }

    // Fall back to absolute format.
    return formatContentDateAbsolute(date);
}

/** Always returns the absolute format: "February 25, 2026". */
export function formatContentDateAbsolute(date: string): string {
    const parsedDate = parseDateString(date);
    return `${monthName(parsedDate.month)} ${parsedDate.day}, ${parsedDate.year}`;
}

type ParsedDate = {
    readonly year: number;
    readonly month: number;
    readonly day: number;
    readonly dayOfWeek: number;
};

function parseDateString(date: string): ParsedDate {
    const {year, month, day} = parseContentDateString(date);
    const dayOfWeek = getDayOfWeek(year, month, day);
    return {year, month, day, dayOfWeek};
}

/**
 * Returns the ISO day of week (1=Monday, 7=Sunday).
 */
function getDayOfWeek(year: number, month: number, day: number): number {
    // JavaScript Date uses UTC to avoid timezone issues.
    const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    // Convert JS Sunday=0 to ISO Monday=1..Sunday=7.
    return jsDay === 0 ? 7 : jsDay;
}

/**
 * Returns the number of days from `from` to `to` (positive if `to` is after
 * `from`).
 */
function daysBetween(from: ParsedDate, to: ParsedDate): number {
    const fromMs = Date.UTC(from.year, from.month - 1, from.day);
    const toMs = Date.UTC(to.year, to.month - 1, to.day);
    return (toMs - fromMs) / 86_400_000;
}

/**
 * Returns the Monday of the ISO week (Mon-Sun) containing the given date.
 */
function getWeekMonday(parsedDate: ParsedDate): ParsedDate {
    // dayOfWeek is 1=Monday..7=Sunday, so Monday offset is dayOfWeek - 1.
    const offset = parsedDate.dayOfWeek - 1;
    const mondayMs =
        Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day) - offset * 86_400_000;
    const mondayDate = new Date(mondayMs);
    return parseDateString(
        formatContentDateString(
            mondayDate.getUTCFullYear(),
            mondayDate.getUTCMonth() + 1,
            mondayDate.getUTCDate(),
        ),
    );
}

/**
 * Returns the number of weeks from Monday `from` to Monday `to` (positive if `to`
 * is after `from`). Both must be Mondays.
 */
function weeksBetween(from: ParsedDate, to: ParsedDate): number {
    return daysBetween(from, to) / 7;
}

function dayName(isoDayOfWeek: number): string {
    switch (isoDayOfWeek) {
        case 1:
            return "Monday";
        case 2:
            return "Tuesday";
        case 3:
            return "Wednesday";
        case 4:
            return "Thursday";
        case 5:
            return "Friday";
        case 6:
            return "Saturday";
        case 7:
            return "Sunday";
        default:
            throw new InternalError(`Invalid day of week: ${isoDayOfWeek}`);
    }
}

/**
 * Returns a date string offset by `days` from today in the user's local timezone.
 * The stored timezone on the date node is purely metadata and does not influence
 * what date is displayed.
 */
export function getContentDateStringFromOffset(days: number): string {
    const now = new Date();
    const ms = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) + days * 86_400_000;
    const offsetDate = new Date(ms);
    return formatContentDateString(
        offsetDate.getUTCFullYear(),
        offsetDate.getUTCMonth() + 1,
        offsetDate.getUTCDate(),
    );
}

/**
 * Returns a date string for the next occurrence of the given ISO day of week
 * (1=Monday, 7=Sunday) from today in the user's local timezone. If `isoDayOfWeek`
 * is the same as today, returns next week's occurrence.
 */
export function getContentDateStringForNextDayOfWeek(isoDayOfWeek: number): string {
    const now = new Date();
    const todayJs = now.getDay(); // 0=Sunday, local timezone
    const todayIso = todayJs === 0 ? 7 : todayJs;
    let diff = isoDayOfWeek - todayIso;
    if (diff <= 0) diff += 7;
    return getContentDateStringFromOffset(diff);
}

/**
 * Returns a date string for the previous occurrence of the given ISO day of week
 * (1=Monday, 7=Sunday) from today in the user's local timezone. If `isoDayOfWeek`
 * is the same as today, returns last week's occurrence.
 */
export function getContentDateStringForLastDayOfWeek(isoDayOfWeek: number): string {
    const now = new Date();
    const todayJs = now.getDay(); // 0=Sunday, local timezone
    const todayIso = todayJs === 0 ? 7 : todayJs;
    let diff = todayIso - isoDayOfWeek;
    if (diff <= 0) diff += 7;
    return getContentDateStringFromOffset(-diff);
}

function monthName(month: number): string {
    return dateFullMonthNames[month - 1]!;
}
