/**
 * Shared date utility functions for content date features. Provides validation,
 * formatting, parsing, and month name data used across detection, suggestion, and
 * display code.
 */

import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Formats year/month/day as a zero-padded "YYYY-MM-DD" date string.
 */
// TODO(calebmer): Can we switch to using `CalendarDate` from
// `@internationalized/date`?
export function formatContentDateString(year: number, month: number, day: number): string {
    return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * Parses a "YYYY-MM-DD" date string into its numeric components.
 */
// TODO(calebmer): Can we switch to using `CalendarDate` from
// `@internationalized/date`?
export function parseContentDateString(date: string) {
    assert(/^\d{4}-\d{2}-\d{2}$/.test(date));
    const year = parseInt(date.slice(0, 4), 10);
    const month = parseInt(date.slice(5, 7), 10);
    const day = parseInt(date.slice(8, 10), 10);
    return {year, month, day};
}
