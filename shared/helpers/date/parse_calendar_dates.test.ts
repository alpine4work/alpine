/* eslint-disable cyberworlds/string-quotes */
import {parseDate} from "@internationalized/date";
import {
    parseCalendarDates,
    printCalendarDateInOriginalFormat,
} from "~/shared/helpers/date/parse_calendar_dates.open_source.js";

describe("parseCalendarDates()", () => {
    describe("full month name with year", () => {
        test("detects date at correct offsets", () => {
            const result = parseCalendarDates("Meet on March 7, 2026 at noon");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 8,
                    end: 21,
                    date: "2026-03-07",
                    originalText: "March 7, 2026",
                    format: {type: "Prose", year: {twoDigit: false}, month: {abbreviated: false}},
                },
            ]);
        });

        test("detects date at start of string", () => {
            const result = parseCalendarDates("January 1, 2025 is New Year\u2019s Day");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 15,
                    date: "2025-01-01",
                    originalText: "January 1, 2025",
                    format: {type: "Prose"},
                },
            ]);
        });

        test("detects double-digit day", () => {
            const result = parseCalendarDates("December 31, 2025");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 17,
                    date: "2025-12-31",
                    format: {type: "Prose"},
                },
            ]);
        });
    });

    describe("full month name without year", () => {
        test("uses defaultYear when provided", () => {
            const result = parseCalendarDates("March 7", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 7,
                    date: "2026-03-07",
                    originalText: "March 7",
                    format: {
                        type: "Prose",
                        year: undefined,
                        month: {abbreviated: false},
                        day: {orderedFirst: false},
                    },
                },
            ]);
        });

        test("uses defaultYear in surrounding text", () => {
            const result = parseCalendarDates("Due on June 15 please", 2025);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 7,
                    end: 14,
                    date: "2025-06-15",
                    format: {type: "Prose", year: undefined},
                },
            ]);
        });
    });

    describe("abbreviated month with year", () => {
        test("detects abbreviated month with year", () => {
            const result = parseCalendarDates("Mar 7, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 11,
                    date: "2026-03-07",
                    originalText: "Mar 7, 2026",
                    format: {type: "Prose", month: {abbreviated: true}},
                },
            ]);
        });

        test("detects other abbreviated months", () => {
            const result = parseCalendarDates("Event on Sep 15, 2024");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 9,
                    end: 21,
                    date: "2024-09-15",
                    format: {type: "Prose", month: {abbreviated: true}},
                },
            ]);
        });
    });

    describe("abbreviated month without year", () => {
        test("uses defaultYear when provided", () => {
            const result = parseCalendarDates("Dec 25", 2025);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 6,
                    date: "2025-12-25",
                    originalText: "Dec 25",
                    format: {type: "Prose", year: undefined, month: {abbreviated: true}},
                },
            ]);
        });
    });

    describe("numeric US slash format", () => {
        test("detects standard numeric date", () => {
            // TODO(#global-date-formatting): US-ordering assumption
            const result = parseCalendarDates("3/7/2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 8,
                    date: "2026-03-07",
                    originalText: "3/7/2026",
                    format: {
                        type: "NumericSeparated",
                        separator: "/",
                        year: {twoDigit: false},
                        month: {zeroPadded: false},
                        day: {zeroPadded: false},
                    },
                },
            ]);
        });

        test("detects zero-padded numeric date", () => {
            // TODO(#global-date-formatting): US-ordering assumption
            const result = parseCalendarDates("03/07/2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 10,
                    date: "2026-03-07",
                    originalText: "03/07/2026",
                    format: {
                        type: "NumericSeparated",
                        separator: "/",
                        year: {twoDigit: false},
                        month: {zeroPadded: true},
                        day: {zeroPadded: true},
                    },
                },
            ]);
        });

        test("detects short year numeric date", () => {
            // TODO(#global-date-formatting): US-ordering assumption
            const result = parseCalendarDates("3/7/26");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 6,
                    date: "2026-03-07",
                    originalText: "3/7/26",
                    format: {
                        type: "NumericSeparated",
                        separator: "/",
                        year: {twoDigit: true},
                        month: {zeroPadded: false},
                        day: {zeroPadded: false},
                    },
                },
            ]);
        });

        test("detects numeric date without year", () => {
            // TODO(#global-date-formatting): US-ordering assumption
            const result = parseCalendarDates("3/7", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 3,
                    date: "2026-03-07",
                    format: {
                        type: "NumericSeparated",
                        separator: "/",
                        year: undefined,
                        month: {zeroPadded: false},
                        day: {zeroPadded: false},
                    },
                },
            ]);
        });
    });

    describe("dash-separated format", () => {
        test("detects dash-separated with short year", () => {
            const result = parseCalendarDates("4-23-20");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2020-04-23",
                    originalText: "4-23-20",
                    format: {
                        type: "NumericSeparated",
                        separator: "-",
                        year: {twoDigit: true},
                    },
                },
            ]);
        });

        test("detects dash-separated without year", () => {
            const result = parseCalendarDates("4-23", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-04-23",
                    originalText: "4-23",
                    format: {
                        type: "NumericSeparated",
                        separator: "-",
                        year: undefined,
                    },
                },
            ]);
        });

        test("ISO takes priority over dash-separated", () => {
            const result = parseCalendarDates("2026-03-07");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(1);
            expect(result[0]).toMatchObject({format: {type: "ISO"}});
        });
    });

    describe("ISO format", () => {
        test("detects ISO date", () => {
            const result = parseCalendarDates("2026-03-07");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 0,
                    end: 10,
                    date: "2026-03-07",
                    originalText: "2026-03-07",
                    format: {type: "ISO"},
                },
            ]);
        });

        test("detects ISO date in surrounding text", () => {
            const result = parseCalendarDates("Created on 2025-12-01 by admin");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    start: 11,
                    end: 21,
                    date: "2025-12-01",
                    format: {type: "ISO"},
                },
            ]);
        });
    });

    describe("multiple dates in one string", () => {
        test("detects multiple dates", () => {
            const result = parseCalendarDates("From March 1, 2026 to March 31, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(2);
            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {date: "2026-03-01", format: {type: "Prose"}},
                {date: "2026-03-31", format: {type: "Prose"}},
            ]);
        });

        test("detects mixed format dates", () => {
            const result = parseCalendarDates("2026-01-15 and Jan 15, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(2);
            expect(result[0]).toMatchObject({format: {type: "ISO"}});
            expect(result[1]).toMatchObject({format: {type: "Prose", month: {abbreviated: true}}});
        });
    });

    describe("invalid dates", () => {
        test("does not match February 30", () => {
            const result = parseCalendarDates("February 30, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });

        test("does not match month 13", () => {
            const result = parseCalendarDates("2026-13-01");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });

        test("does not match day 0", () => {
            const result = parseCalendarDates("January 0, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });

        test("does not match day 32", () => {
            const result = parseCalendarDates("March 32, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });
    });

    describe("word boundaries", () => {
        test("does not match month name inside a word", () => {
            const result = parseCalendarDates("Marching to the beat");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });

        test("does not match abbreviation inside a word", () => {
            const result = parseCalendarDates("Decorum is important");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(0);
        });

        test("matches month name at start of word boundary", () => {
            const result = parseCalendarDates("March 15, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(1);
        });
    });

    describe("more specific formats take priority", () => {
        test("Prose with year takes priority over Prose without year", () => {
            // "March 7, 2026" should match as Prose with year, not produce an additional
            // yearless Prose match for "March 7"
            const result = parseCalendarDates("March 7, 2026", 2025);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(1);
            expect(result[0]).toMatchObject({format: {type: "Prose", year: {twoDigit: false}}});
        });

        test("ISO takes priority over numeric-like patterns", () => {
            const result = parseCalendarDates("2026-03-07");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toHaveLength(1);
            expect(result[0]).toMatchObject({format: {type: "ISO"}});
        });
    });

    describe("day-first formats", () => {
        test("2 August 2026", () => {
            const result = parseCalendarDates("Meet on 2 August 2026 at noon");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-02",
                    format: {type: "Prose", day: {orderedFirst: true}},
                },
            ]);
        });

        test("2 Aug 2026", () => {
            const result = parseCalendarDates("Meet on 2 Aug 2026 at noon");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-02",
                    format: {type: "Prose", month: {abbreviated: true}, day: {orderedFirst: true}},
                },
            ]);
        });

        test("2 August (no year)", () => {
            const result = parseCalendarDates("Meet on 2 August at noon", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-02",
                    format: {type: "Prose", year: undefined, day: {orderedFirst: true}},
                },
            ]);
        });

        test("2 Aug (no year)", () => {
            const result = parseCalendarDates("Meet on 2 Aug at noon", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-02",
                    format: {
                        type: "Prose",
                        year: undefined,
                        month: {abbreviated: true},
                        day: {orderedFirst: true},
                    },
                },
            ]);
        });
    });

    describe("comma handling", () => {
        test("detects comma in month-first with year", () => {
            const result = parseCalendarDates("March 7, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {format: {type: "Prose", year: {hasComma: true}}},
            ]);
        });

        test("detects no comma in month-first with year", () => {
            const result = parseCalendarDates("March 7 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {format: {type: "Prose", year: {hasComma: false}}},
            ]);
        });

        test("detects comma in day-first with year", () => {
            const result = parseCalendarDates("2 August, 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {format: {type: "Prose", year: {hasComma: true}, day: {orderedFirst: true}}},
            ]);
        });

        test("detects no comma in day-first with year", () => {
            const result = parseCalendarDates("2 August 2026");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {format: {type: "Prose", year: {hasComma: false}, day: {orderedFirst: true}}},
            ]);
        });
    });

    describe("apostrophe years", () => {
        test("detects straight apostrophe year month-first", () => {
            const result = parseCalendarDates("March 7, '26");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    originalText: "March 7, '26",
                    format: {
                        type: "Prose",
                        year: {twoDigit: true, hasComma: true, apostrophe: "'"},
                    },
                },
            ]);
        });

        test("detects smart quote apostrophe year month-first", () => {
            const result = parseCalendarDates("March 7, \u201926");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    originalText: "March 7, \u201926",
                    format: {
                        type: "Prose",
                        year: {twoDigit: true, hasComma: true, apostrophe: "\u2019"},
                    },
                },
            ]);
        });

        test("detects apostrophe year without comma", () => {
            const result = parseCalendarDates("March 7 '26");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    format: {
                        type: "Prose",
                        year: {twoDigit: true, hasComma: false, apostrophe: "'"},
                    },
                },
            ]);
        });

        test("detects apostrophe year day-first", () => {
            const result = parseCalendarDates("7 March '26");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    format: {
                        type: "Prose",
                        year: {twoDigit: true, apostrophe: "'"},
                        day: {orderedFirst: true},
                    },
                },
            ]);
        });

        test("detects abbreviated month with apostrophe year", () => {
            const result = parseCalendarDates("Mar 7, '26");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    format: {
                        type: "Prose",
                        year: {twoDigit: true, apostrophe: "'"},
                        month: {abbreviated: true},
                    },
                },
            ]);
        });

        test("apostrophe year takes priority over yearless", () => {
            const result = parseCalendarDates("March 7 '26", 2025);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-07",
                    format: {type: "Prose", year: {twoDigit: true}},
                },
            ]);
        });

        test("apostrophe year takes priority over yearless with double-digit day", () => {
            const result = parseCalendarDates("March 30 '23", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2023-03-30",
                    originalText: "March 30 '23",
                    format: {type: "Prose", year: {twoDigit: true}},
                },
            ]);
        });
    });

    describe("ordinal suffixes", () => {
        test("March 2nd, 2026", () => {
            const result = parseCalendarDates("Meet on March 2nd, 2026 at noon");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-02",
                    format: {type: "Prose", day: {hasOrdinalSuffix: true}},
                },
            ]);
        });

        test("1st August 2026 (day-first)", () => {
            const result = parseCalendarDates("Meet on 1st August 2026 at noon");

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-01",
                    format: {
                        type: "Prose",
                        day: {orderedFirst: true, hasOrdinalSuffix: true},
                    },
                },
            ]);
        });

        test("Mar 3rd (no year)", () => {
            const result = parseCalendarDates("Meet on Mar 3rd at noon", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-03-03",
                    format: {
                        type: "Prose",
                        month: {abbreviated: true},
                        day: {hasOrdinalSuffix: true},
                    },
                },
            ]);
        });

        test("4th Aug (day-first, no year)", () => {
            const result = parseCalendarDates("Meet on 4th Aug at noon", 2026);

            expect(result.map(match => ({...match, date: match.date.toString()}))).toMatchObject([
                {
                    date: "2026-08-04",
                    format: {
                        type: "Prose",
                        month: {abbreviated: true},
                        day: {orderedFirst: true, hasOrdinalSuffix: true},
                    },
                },
            ]);
        });
    });
});

describe("printCalendarDateInOriginalFormat()", () => {
    test("formats Prose month-first with year and comma", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: true},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("March 15, 2026");
    });

    test("formats Prose month-first with year without comma", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: false},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("March 15 2026");
    });

    test("formats Prose month-first without year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-06-05"), {
            type: "Prose",
            year: undefined,
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("June 5");
    });

    test("formats Prose day-first with year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-08-02"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: false},
            month: {abbreviated: false},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("2 August 2026");
    });

    test("formats Prose day-first with year and comma", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-08-02"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: true},
            month: {abbreviated: false},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("2 August, 2026");
    });

    test("formats Prose day-first without year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-08-02"), {
            type: "Prose",
            year: undefined,
            month: {abbreviated: false},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("2 August");
    });

    test("formats Prose with ordinal suffix", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-02"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: true},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: true},
        });

        expect(result).toBe("March 2nd, 2026");
    });

    test("computes correct ordinal suffix for new day", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-04"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: true},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: true},
        });

        expect(result).toBe("March 4th, 2026");
    });

    test("handles 11th/12th/13th special cases", () => {
        const format = {
            type: "Prose" as const,
            year: undefined,
            month: {abbreviated: false},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: true},
        };

        expect(printCalendarDateInOriginalFormat(parseDate("2026-03-11"), format)).toBe(
            "11th March",
        );
        expect(printCalendarDateInOriginalFormat(parseDate("2026-03-12"), format)).toBe(
            "12th March",
        );
        expect(printCalendarDateInOriginalFormat(parseDate("2026-03-13"), format)).toBe(
            "13th March",
        );
    });

    test("formats Prose day-first with ordinal", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-08-02"), {
            type: "Prose",
            year: undefined,
            month: {abbreviated: false},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: true},
        });

        expect(result).toBe("2nd August");
    });

    test("formats Prose abbreviated month with year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: true},
            month: {abbreviated: true},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("Mar 15, 2026");
    });

    test("formats Prose abbreviated month without year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-12-25"), {
            type: "Prose",
            year: undefined,
            month: {abbreviated: true},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("Dec 25");
    });

    test("formats Prose abbreviated day-first with year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-08-02"), {
            type: "Prose",
            year: {twoDigit: false, hasComma: false},
            month: {abbreviated: true},
            day: {orderedFirst: true, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("2 Aug 2026");
    });

    test("formats Prose with straight apostrophe year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "Prose",
            year: {twoDigit: true, hasComma: true, apostrophe: "'"},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("March 15, '26");
    });

    test("formats Prose with smart quote apostrophe year", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "Prose",
            year: {twoDigit: true, hasComma: true, apostrophe: "\u2019"},
            month: {abbreviated: false},
            day: {orderedFirst: false, zeroPadded: false, hasOrdinalSuffix: false},
        });

        expect(result).toBe("March 15, \u201926");
    });

    test("formats NumericSeparated without zero-padding, with full year", () => {
        // TODO(#global-date-formatting): US-ordering assumption
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "NumericSeparated",
            separator: "/",
            year: {twoDigit: false},
            month: {zeroPadded: false},
            day: {zeroPadded: false},
        });

        expect(result).toBe("3/15/2026");
    });

    test("formats NumericSeparated with zero-padding", () => {
        // TODO(#global-date-formatting): US-ordering assumption
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-05"), {
            type: "NumericSeparated",
            separator: "/",
            year: {twoDigit: false},
            month: {zeroPadded: true},
            day: {zeroPadded: true},
        });

        expect(result).toBe("03/05/2026");
    });

    test("formats NumericSeparated with short year", () => {
        // TODO(#global-date-formatting): US-ordering assumption
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "NumericSeparated",
            separator: "/",
            year: {twoDigit: true},
            month: {zeroPadded: false},
            day: {zeroPadded: false},
        });

        expect(result).toBe("3/15/26");
    });

    test("formats NumericSeparated without year", () => {
        // TODO(#global-date-formatting): US-ordering assumption
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-15"), {
            type: "NumericSeparated",
            separator: "/",
            year: undefined,
            month: {zeroPadded: false},
            day: {zeroPadded: false},
        });

        expect(result).toBe("3/15");
    });

    test("formats ISO", () => {
        const result = printCalendarDateInOriginalFormat(parseDate("2026-03-07"), {type: "ISO"});

        expect(result).toBe("2026-03-07");
    });

    describe("round-trips", () => {
        test("round-trips Prose with year", () => {
            const originalText = "March 7, 2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose abbreviated with year", () => {
            const originalText = "Mar 7, 2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips NumericSeparated zero-padded", () => {
            const originalText = "03/07/2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose with apostrophe year", () => {
            const originalText = "March 7, '26";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose with smart quote apostrophe year", () => {
            const originalText = "March 7, \u201926";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose day-first without comma", () => {
            const originalText = "2 August 2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose day-first with comma", () => {
            const originalText = "2 August, 2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose month-first without comma", () => {
            const originalText = "March 7 2026";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips dash-separated with short year", () => {
            const originalText = "4-23-20";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips Prose month-first apostrophe without comma", () => {
            const originalText = "March 20 '23";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });

        test("round-trips ISO", () => {
            const originalText = "2026-03-07";
            const [match] = parseCalendarDates(originalText);
            const reformatted = printCalendarDateInOriginalFormat(match!.date, match!.format);

            expect(reformatted).toBe(originalText);
        });
    });
});
