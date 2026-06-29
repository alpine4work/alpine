/**
 * Detects date-formatted text in strings and provides format-preserving
 * replacement. This is the core detection logic for a ProseMirror decoration
 * plugin.
 */

import {CalendarDate} from "@internationalized/date";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    dateAbbreviatedMonthNames,
    dateFullMonthNames,
} from "~/shared/helpers/date/date_month_names.js";

/** Describes which date pattern was matched, preserving formatting details. */
export type CalendarDateParserFormat =
    | {
          /**
           * - "March 7, 2026", "2 August 2026", "March 2nd, 2026"
           * - "Mar 7, 2026", "2 Aug 2026"
           * - "March 7", "2nd August"
           */
          readonly type: "Prose";
          /** undefined when the matched text has no year (e.g. "March 7"). */
          readonly year:
              | {
                    /** "March 7, 2026" */
                    readonly twoDigit: false;
                    /** "March 7, 2026" vs "March 7 2026" */
                    readonly hasComma: boolean;
                }
              | {
                    /** "March 7, '26" */
                    readonly twoDigit: true;
                    /** "March 7, '26" vs "March 7 '26" */
                    readonly hasComma: boolean;
                    /** The apostrophe character used in the original text. */
                    readonly apostrophe: string;
                }
              | undefined;
          readonly month: {
              /** "Mar" vs "March" */
              readonly abbreviated: boolean;
          };
          readonly day: {
              /** "2 August" vs "August 2" */
              readonly orderedFirst: boolean;
              /** "07 March" vs "7 March" */
              readonly zeroPadded: boolean;
              /** "2nd" vs "2" */
              readonly hasOrdinalSuffix: boolean;
          };
      }
    | {
          /**
           * - "3/7/2026", "03/07/2026", "3/7/26", "3/7"
           */
          readonly type: "NumericSeparated";
          /** "/" in "3/7/2026" */
          readonly separator: "/" | "-";
          /** undefined when the matched text has no year (e.g. "3/7"). */
          readonly year:
              | {
                    /** "3/7/26" vs "3/7/2026" */
                    readonly twoDigit: boolean;
                }
              | undefined;
          readonly month: {
              /** "03" vs "3" */
              readonly zeroPadded: boolean;
          };
          readonly day: {
              /** "07" vs "7" */
              readonly zeroPadded: boolean;
          };
      }
    | {
          /** "2026-03-07" */
          readonly type: "ISO";
      };

/** A detected date match within a string. */
export type CalendarDateParserMatch = {
    /** Start offset (inclusive) in the source string. */
    readonly start: number;
    /** End offset (exclusive) in the source string. */
    readonly end: number;
    /** Normalized date. */
    readonly date: CalendarDate;
    /** The format descriptor describing the original pattern. */
    readonly format: CalendarDateParserFormat;
    /** The original text that was matched. */
    readonly originalText: string;
};

/** Formats a number as a zero-padded two-digit string. */
function pad2(num: number): string {
    return String(num).padStart(2, "0");
}

/** Returns the English ordinal suffix for a day number. */
function ordinalSuffixForDay(day: number): string {
    if (day >= 11 && day <= 13) return "th";
    switch (day % 10) {
        case 1:
            return "st";
        case 2:
            return "nd";
        case 3:
            return "rd";
        default:
            return "th";
    }
}

/** Converts a two-digit year (e.g. 26) to a full four-digit year. */
function expandShortYear(shortYear: number): number {
    // Assume years 00-99 map to 2000-2099.
    return 2000 + shortYear;
}

/**
 * Detects date-formatted text in a string and returns an array of matches. More
 * specific formats (with year) take priority over less specific (without year) to
 * avoid overlapping matches. Processing order: ISO, then formats with year, then
 * formats without year.
 *
 * @param text - The text to search for dates. @param defaultYear - The year to use
 * when the matched format doesn't include one.
 */
export function parseCalendarDates(
    text: string,
    defaultYear?: number,
): Array<CalendarDateParserMatch> {
    const matches: Array<CalendarDateParserMatch> = [];

    // Track which character offsets are already claimed so more specific patterns
    // prevent less specific ones from overlapping.
    const claimed = new Set<number>();

    function claimRange(start: number, end: number): boolean {
        for (let i = start; i < end; i++) {
            if (claimed.has(i)) return false;
        }
        for (let i = start; i < end; i++) {
            claimed.add(i);
        }
        return true;
    }

    // --- ISO: 2026-03-07 ---
    const isoRe = /(?<![0-9])((\d{4})-(\d{2})-(\d{2}))(?![0-9])/g;
    for (const match of text.matchAll(isoRe)) {
        const [fullMatch, , yearStr, monthStr, dayStr] = match;
        if (!yearStr || !monthStr || !dayStr) continue;

        const start = match.index;
        const end = start + fullMatch.length;
        const year = parseInt(yearStr, 10);
        const month = parseInt(monthStr, 10);
        const day = parseInt(dayStr, 10);

        const date = new CalendarDate(year, month, day);

        // Make sure the original values were valid and weren't clamped by the
        // `CalendarDate` constructor
        if (date.year !== year || date.month !== month || date.day !== day) continue;

        if (!claimRange(start, end)) continue;

        matches.push({
            start,
            end,
            date,
            format: {type: "ISO"},
            originalText: fullMatch,
        });
    }

    const fullMonthNamesPattern = dateFullMonthNames.join("|");
    const abbreviatedMonthNamesPattern = dateAbbreviatedMonthNames.join("|");
    const ordSuffix = "(?:st|nd|rd|th)";

    // Apostrophe characters: straight quote, left and right single quotation marks.
    // eslint-disable-next-line cyberworlds/string-quotes
    const apostrophes = "['\\u2018\\u2019]";

    // --- Month-first with full year: March 7, 2026 / March 7th 2026 ---
    for (const [monthList, abbreviated] of [
        [fullMonthNamesPattern, false],
        [abbreviatedMonthNamesPattern, true],
    ] as const) {
        const re = new RegExp(
            `(?<![A-Za-z])(${monthList}) (\\d{1,2})(${ordSuffix})?(,?) (\\d{4})(?![0-9A-Za-z])`,
            "g",
        );
        for (const match of text.matchAll(re)) {
            const [fullMatch, monthName, dayStr, suffix, comma, yearStr] = match;
            if (!monthName || !dayStr || !yearStr) continue;

            const start = match.index;
            const end = start + fullMatch.length;

            const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

            const month = monthNames.indexOf(monthName) + 1;
            const day = parseInt(dayStr, 10);
            const year = parseInt(yearStr, 10);

            const date = new CalendarDate(year, month, day);

            // Make sure the original values were valid and weren't clamped by the
            // `CalendarDate` constructor
            if (date.year !== year || date.month !== month || date.day !== day) continue;

            if (!claimRange(start, end)) continue;

            matches.push({
                start,
                end,
                date,
                format: {
                    type: "Prose",
                    year: {twoDigit: false, hasComma: comma === ","},
                    month: {abbreviated},
                    day: {
                        orderedFirst: false,
                        zeroPadded: dayStr.startsWith("0"),
                        hasOrdinalSuffix: suffix != null,
                    },
                },
                originalText: fullMatch,
            });
        }
    }

    // --- Month-first with apostrophe year: March 7, '26 / Mar 7th '26 ---
    for (const [monthList, abbreviated] of [
        [fullMonthNamesPattern, false],
        [abbreviatedMonthNamesPattern, true],
    ] as const) {
        const re = new RegExp(
            `(?<![A-Za-z])(${monthList}) (\\d{1,2})(${ordSuffix})?(,?) (${apostrophes})(\\d{2})(?![0-9A-Za-z])`,
            "g",
        );
        for (const match of text.matchAll(re)) {
            const [fullMatch, monthName, dayStr, suffix, comma, apostrophe, yearStr] = match;
            if (!monthName || !dayStr || !apostrophe || !yearStr) continue;

            const start = match.index;
            const end = start + fullMatch.length;

            const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

            const month = monthNames.indexOf(monthName) + 1;
            const day = parseInt(dayStr, 10);
            const year = expandShortYear(parseInt(yearStr, 10));

            const date = new CalendarDate(year, month, day);

            // Make sure the original values were valid and weren't clamped by the
            // `CalendarDate` constructor
            if (date.year !== year || date.month !== month || date.day !== day) continue;

            if (!claimRange(start, end)) continue;

            matches.push({
                start,
                end,
                date,
                format: {
                    type: "Prose",
                    year: {twoDigit: true, hasComma: comma === ",", apostrophe},
                    month: {abbreviated},
                    day: {
                        orderedFirst: false,
                        zeroPadded: dayStr.startsWith("0"),
                        hasOrdinalSuffix: suffix != null,
                    },
                },
                originalText: fullMatch,
            });
        }
    }

    // --- Day-first with full year: 2 August, 2026 / 2nd Aug 2026 ---
    for (const [monthList, abbreviated] of [
        [fullMonthNamesPattern, false],
        [abbreviatedMonthNamesPattern, true],
    ] as const) {
        const re = new RegExp(
            `(?<![0-9A-Za-z])(\\d{1,2})(${ordSuffix})? (${monthList})(,?) (\\d{4})(?![0-9A-Za-z])`,
            "g",
        );
        for (const match of text.matchAll(re)) {
            const [fullMatch, dayStr, suffix, monthName, comma, yearStr] = match;
            if (!dayStr || !monthName || !yearStr) continue;

            const start = match.index;
            const end = start + fullMatch.length;

            const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

            const month = monthNames.indexOf(monthName) + 1;
            const day = parseInt(dayStr, 10);
            const year = parseInt(yearStr, 10);

            const date = new CalendarDate(year, month, day);

            // Make sure the original values were valid and weren't clamped by the
            // `CalendarDate` constructor
            if (date.year !== year || date.month !== month || date.day !== day) continue;

            if (!claimRange(start, end)) continue;

            matches.push({
                start,
                end,
                date,
                format: {
                    type: "Prose",
                    year: {twoDigit: false, hasComma: comma === ","},
                    month: {abbreviated},
                    day: {
                        orderedFirst: true,
                        zeroPadded: dayStr.startsWith("0"),
                        hasOrdinalSuffix: suffix != null,
                    },
                },
                originalText: fullMatch,
            });
        }
    }

    // --- Day-first with apostrophe year: 2 August '26 / 2nd Aug, '26 ---
    for (const [monthList, abbreviated] of [
        [fullMonthNamesPattern, false],
        [abbreviatedMonthNamesPattern, true],
    ] as const) {
        const re = new RegExp(
            `(?<![0-9A-Za-z])(\\d{1,2})(${ordSuffix})? (${monthList})(,?) (${apostrophes})(\\d{2})(?![0-9A-Za-z])`,
            "g",
        );
        for (const match of text.matchAll(re)) {
            const [fullMatch, dayStr, suffix, monthName, comma, apostrophe, yearStr] = match;
            if (!dayStr || !monthName || !apostrophe || !yearStr) continue;

            const start = match.index;
            const end = start + fullMatch.length;

            const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

            const month = monthNames.indexOf(monthName) + 1;
            const day = parseInt(dayStr, 10);
            const year = expandShortYear(parseInt(yearStr, 10));

            const date = new CalendarDate(year, month, day);

            // Make sure the original values were valid and weren't clamped by the
            // `CalendarDate` constructor
            if (date.year !== year || date.month !== month || date.day !== day) continue;

            if (!claimRange(start, end)) continue;

            matches.push({
                start,
                end,
                date,
                format: {
                    type: "Prose",
                    year: {twoDigit: true, hasComma: comma === ",", apostrophe},
                    month: {abbreviated},
                    day: {
                        orderedFirst: true,
                        zeroPadded: dayStr.startsWith("0"),
                        hasOrdinalSuffix: suffix != null,
                    },
                },
                originalText: fullMatch,
            });
        }
    }

    // --- Numeric separated with year: 3/7/2026, 03/07/2026, 3/7/26, 4-23-20 ---
    // TODO(#global-date-formatting): US-ordering assumption
    for (const separator of ["/", "-"] as const) {
        const sep = separator === "/" ? "\\/" : "-";
        const numericYearRe = new RegExp(
            `(?<![0-9${separator}])(0?[1-9]|1[0-2])${sep}(0?[1-9]|[12][0-9]|3[01])${sep}(\\d{4}|\\d{2})(?![0-9${separator}])`,
            "g",
        );
        for (const match of text.matchAll(numericYearRe)) {
            const [fullMatch, monthStr, dayStr, yearStr] = match;
            if (!monthStr || !dayStr || !yearStr) continue;

            const start = match.index;
            const end = start + fullMatch.length;

            const month = parseInt(monthStr, 10);
            const day = parseInt(dayStr, 10);
            const shortYear = yearStr.length === 2;
            const year = shortYear ? expandShortYear(parseInt(yearStr, 10)) : parseInt(yearStr, 10);

            const date = new CalendarDate(year, month, day);

            // Make sure the original values were valid and weren't clamped by the
            // `CalendarDate` constructor
            if (date.year !== year || date.month !== month || date.day !== day) continue;

            if (!claimRange(start, end)) continue;

            matches.push({
                start,
                end,
                date,
                format: {
                    type: "NumericSeparated",
                    separator,
                    year: {twoDigit: shortYear},
                    month: {zeroPadded: monthStr.startsWith("0")},
                    day: {zeroPadded: dayStr.startsWith("0")},
                },
                originalText: fullMatch,
            });
        }
    }

    // --- Month-first without year: March 7 / March 7th ---
    if (defaultYear !== undefined) {
        for (const [monthList, abbreviated] of [
            [fullMonthNamesPattern, false],
            [abbreviatedMonthNamesPattern, true],
        ] as const) {
            const re = new RegExp(
                `(?<![A-Za-z])(${monthList}) (\\d{1,2})(${ordSuffix})?(?![0-9A-Za-z,])`,
                "g",
            );
            for (const match of text.matchAll(re)) {
                const [fullMatch, monthName, dayStr, suffix] = match;
                if (!monthName || !dayStr) continue;

                const start = match.index;
                const end = start + fullMatch.length;

                const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

                const month = monthNames.indexOf(monthName) + 1;
                const day = parseInt(dayStr, 10);

                const date: CalendarDate = new CalendarDate(defaultYear, month, day);

                // Make sure the original values were valid and weren't clamped by the
                // `CalendarDate` constructor
                if (date.year !== defaultYear || date.month !== month || date.day !== day) continue;

                if (!claimRange(start, end)) continue;

                matches.push({
                    start,
                    end,
                    date,
                    format: {
                        type: "Prose",
                        year: undefined,
                        month: {abbreviated},
                        day: {
                            orderedFirst: false,
                            zeroPadded: dayStr.startsWith("0"),
                            hasOrdinalSuffix: suffix != null,
                        },
                    },
                    originalText: fullMatch,
                });
            }
        }
    }

    // --- Day-first without year: 2 August / 2nd Aug ---
    if (defaultYear !== undefined) {
        for (const [monthList, abbreviated] of [
            [fullMonthNamesPattern, false],
            [abbreviatedMonthNamesPattern, true],
        ] as const) {
            const re = new RegExp(
                `(?<![0-9A-Za-z])(\\d{1,2})(${ordSuffix})? (${monthList})(?![0-9A-Za-z,])`,
                "g",
            );
            for (const match of text.matchAll(re)) {
                const [fullMatch, dayStr, suffix, monthName] = match;
                if (!dayStr || !monthName) continue;

                const start = match.index;
                const end = start + fullMatch.length;

                const monthNames = abbreviated ? dateAbbreviatedMonthNames : dateFullMonthNames;

                const month = monthNames.indexOf(monthName) + 1;
                const day = parseInt(dayStr, 10);

                const date: CalendarDate = new CalendarDate(defaultYear, month, day);

                // Make sure the original values were valid and weren't clamped by the
                // `CalendarDate` constructor
                if (date.year !== defaultYear || date.month !== month || date.day !== day) continue;

                if (!claimRange(start, end)) continue;

                matches.push({
                    start,
                    end,
                    date,
                    format: {
                        type: "Prose",
                        year: undefined,
                        month: {abbreviated},
                        day: {
                            orderedFirst: true,
                            zeroPadded: dayStr.startsWith("0"),
                            hasOrdinalSuffix: suffix != null,
                        },
                    },
                    originalText: fullMatch,
                });
            }
        }
    }

    // --- Numeric separated without year: 3/7, 4-23 ---
    if (defaultYear !== undefined) {
        // TODO(#global-date-formatting): US-ordering assumption
        for (const separator of ["/", "-"] as const) {
            const sep = separator === "/" ? "\\/" : "-";
            const numericNoYearRe = new RegExp(
                `(?<![0-9${separator}])(0?[1-9]|1[0-2])${sep}(0?[1-9]|[12][0-9]|3[01])(?![0-9${separator}])`,
                "g",
            );
            for (const match of text.matchAll(numericNoYearRe)) {
                const [fullMatch, monthStr, dayStr] = match;
                if (!monthStr || !dayStr) continue;

                const start = match.index;
                const end = start + fullMatch.length;

                const month = parseInt(monthStr, 10);
                const day = parseInt(dayStr, 10);

                const date: CalendarDate = new CalendarDate(defaultYear, month, day);

                // Make sure the original values were valid and weren't clamped by the
                // `CalendarDate` constructor
                if (date.year !== defaultYear || date.month !== month || date.day !== day) continue;

                if (!claimRange(start, end)) continue;

                matches.push({
                    start,
                    end,
                    date,
                    format: {
                        type: "NumericSeparated",
                        separator,
                        year: undefined,
                        month: {zeroPadded: monthStr.startsWith("0")},
                        day: {zeroPadded: dayStr.startsWith("0")},
                    },
                    originalText: fullMatch,
                });
            }
        }
    }

    // Return matches sorted by their position in the source string.
    matches.sort((a, b) => a.start - b.start);
    return matches;
}

/**
 * Formats a YYYY-MM-DD date string in the given original format descriptor,
 * preserving formatting details like zero-padding and short years.
 *
 * @param date - A date string in YYYY-MM-DD format. @param format - The format
 * descriptor returned by `detectContentEditorDates`.
 */
export function printCalendarDateInOriginalFormat(
    date: CalendarDate,
    format: CalendarDateParserFormat,
): string {
    switch (format.type) {
        case "Prose": {
            const {year, month, day} = date;

            const monthNames = format.month.abbreviated
                ? dateAbbreviatedMonthNames
                : dateFullMonthNames;

            const monthName = assertExists(monthNames[month - 1]);

            const dayPart = format.day.hasOrdinalSuffix
                ? `${day}${ordinalSuffixForDay(day)}`
                : format.day.zeroPadded
                  ? pad2(day)
                  : `${day}`;

            let yearPart: string | undefined;
            if (format.year) {
                const digits = format.year.twoDigit ? String(year).slice(-2) : String(year);
                yearPart = format.year.twoDigit ? `${format.year.apostrophe}${digits}` : digits;
            }

            if (format.day.orderedFirst) {
                if (!yearPart) return `${dayPart} ${monthName}`;
                const comma = format.year?.hasComma ? "," : "";
                return `${dayPart} ${monthName}${comma} ${yearPart}`;
            }

            if (!yearPart) return `${monthName} ${dayPart}`;

            const comma = format.year?.hasComma ? "," : "";

            return `${monthName} ${dayPart}${comma} ${yearPart}`;
        }
        case "NumericSeparated": {
            const {year, month, day} = date;

            // TODO(#global-date-formatting): US-ordering assumption
            const monthStr = format.month.zeroPadded ? pad2(month) : String(month);
            const dayStr = format.day.zeroPadded ? pad2(day) : String(day);

            if (!format.year) {
                return `${monthStr}${format.separator}${dayStr}`;
            }

            const yearStr = format.year.twoDigit ? String(year).slice(-2) : String(year);

            return `${monthStr}${format.separator}${dayStr}${format.separator}${yearStr}`;
        }
        case "ISO": {
            return date.toString();
        }
        default:
            throw exhaustive(format);
    }
}
