/**
 * Shared date utility functions for content date features. Provides validation,
 * formatting, parsing, and month name data used across detection, suggestion, and
 * display code.
 */

import {assert} from "~/shared/helpers/control/assert.js";

/** Full English month names indexed 0-11. */
export const contentDateFullMonthNames = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/** Abbreviated English month names indexed 0-11. */
export const contentDateAbbreviatedMonthNames = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
];

/**
 * Returns true if the given year/month/day combination is a valid calendar date.
 * Handles years < 100 correctly by using `setUTCFullYear`.
 */
export function isValidContentDate(year: number, month: number, day: number): boolean {
    if (day < 1 || year < 1) return false;
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCFullYear(year);
    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}

/**
 * Formats year/month/day as a zero-padded "YYYY-MM-DD" date string.
 */
export function formatContentDateString(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses a "YYYY-MM-DD" date string into its numeric components.
 */
export function parseContentDateString(date: string): {year: number; month: number; day: number} {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date), `Expected YYYY-MM-DD date string, got: ${date}`);
    const year = parseInt(date.slice(0, 4), 10);
    const month = parseInt(date.slice(5, 7), 10);
    const day = parseInt(date.slice(8, 10), 10);
    return {year, month, day};
}
