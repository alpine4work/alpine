import {
    formatContentDate,
    formatContentDateAbsolute,
    getContentDateStringForLastDayOfWeek,
    getContentDateStringForNextDayOfWeek,
    getContentDateStringFromOffset,
} from "~/shared/content/format_content_date.js";

// Today is Wednesday Feb 25, 2026. Current week: Mon Feb 23 - Sun Mar 1.
const wednesday = "2026-02-25";

describe("formatContentDate", () => {
    test("today", () => {
        expect(formatContentDate("2026-02-25", wednesday)).toBe("Today");
    });

    test("yesterday", () => {
        expect(formatContentDate("2026-02-24", wednesday)).toBe("Yesterday");
    });

    test("tomorrow", () => {
        expect(formatContentDate("2026-02-26", wednesday)).toBe("Tomorrow");
    });

    test("monday of current week", () => {
        expect(formatContentDate("2026-02-23", wednesday)).toBe("Monday");
    });

    test("friday of current week", () => {
        expect(formatContentDate("2026-02-27", wednesday)).toBe("Friday");
    });

    test("saturday of current week", () => {
        expect(formatContentDate("2026-02-28", wednesday)).toBe("Saturday");
    });

    test("sunday of current week", () => {
        expect(formatContentDate("2026-03-01", wednesday)).toBe("Sunday");
    });

    test("last wednesday (previous week)", () => {
        expect(formatContentDate("2026-02-18", wednesday)).toBe("Last Wednesday");
    });

    test("last monday (previous week)", () => {
        expect(formatContentDate("2026-02-16", wednesday)).toBe("Last Monday");
    });

    test("last sunday (previous week)", () => {
        expect(formatContentDate("2026-02-22", wednesday)).toBe("Last Sunday");
    });

    test("next wednesday (following week)", () => {
        expect(formatContentDate("2026-03-04", wednesday)).toBe("Next Wednesday");
    });

    test("next monday (following week)", () => {
        expect(formatContentDate("2026-03-02", wednesday)).toBe("Next Monday");
    });

    test("next sunday (following week)", () => {
        expect(formatContentDate("2026-03-08", wednesday)).toBe("Next Sunday");
    });

    test("date two weeks ago falls back to absolute", () => {
        expect(formatContentDate("2026-02-11", wednesday)).toBe("February 11, 2026");
    });

    test("date two weeks ahead falls back to absolute", () => {
        expect(formatContentDate("2026-03-11", wednesday)).toBe("March 11, 2026");
    });

    test("date in a different year", () => {
        expect(formatContentDate("2025-06-15", wednesday)).toBe("June 15, 2025");
    });

    // Today/Yesterday/Tomorrow take priority over day-of-week.
    test("today is Monday — shows Today not Monday", () => {
        const monday = "2026-02-23";
        expect(formatContentDate("2026-02-23", monday)).toBe("Today");
    });

    test("yesterday on Monday — shows Yesterday not Last Sunday", () => {
        const monday = "2026-02-23";
        // Sunday Feb 22 is in the previous calendar week but Yesterday wins.
        expect(formatContentDate("2026-02-22", monday)).toBe("Yesterday");
    });

    test("tomorrow on Sunday — shows Tomorrow not Next Monday", () => {
        const sunday = "2026-03-01";
        // Monday Mar 2 is in the next calendar week but Tomorrow wins.
        expect(formatContentDate("2026-03-02", sunday)).toBe("Tomorrow");
    });

    // Week boundary: if today is Monday Mar 2, Sunday refers to Mar 8 (this week) and
    // Last Sunday is Mar 1 (last week).
    test("week boundary — Sunday of this week vs last week", () => {
        const monday = "2026-03-02";
        expect(formatContentDate("2026-03-08", monday)).toBe("Sunday");
        expect(formatContentDate("2026-03-01", monday)).toBe("Yesterday");
    });
});

// These tests use fake timers fixed to Wednesday Feb 25, 2026 12:00 UTC because
// the helper functions use `new Date()`.
describe("date string helpers (fixed to Wed Feb 25, 2026)", () => {
    beforeAll(() => {
        import.meta.jest.useFakeTimers();
        import.meta.jest.setSystemTime(new Date(Date.UTC(2026, 1, 25, 12, 0, 0)));
    });

    afterAll(() => {
        import.meta.jest.useRealTimers();
    });

    describe("getContentDateStringFromOffset", () => {
        test("offset 0 returns today", () => {
            expect(getContentDateStringFromOffset(0)).toBe("2026-02-25");
        });

        test("offset 1 returns tomorrow", () => {
            expect(getContentDateStringFromOffset(1)).toBe("2026-02-26");
        });

        test("offset -1 returns yesterday", () => {
            expect(getContentDateStringFromOffset(-1)).toBe("2026-02-24");
        });

        test("offset crosses month boundary", () => {
            expect(getContentDateStringFromOffset(4)).toBe("2026-03-01");
        });
    });

    describe("getContentDateStringForNextDayOfWeek", () => {
        // Today is Wednesday (ISO 3).
        test("next Thursday is tomorrow", () => {
            expect(getContentDateStringForNextDayOfWeek(4)).toBe("2026-02-26");
        });

        test("next Wednesday is 7 days away", () => {
            expect(getContentDateStringForNextDayOfWeek(3)).toBe("2026-03-04");
        });

        test("next Monday is 4 days away", () => {
            expect(getContentDateStringForNextDayOfWeek(1)).toBe("2026-03-02");
        });

        test("next Sunday is 4 days away", () => {
            expect(getContentDateStringForNextDayOfWeek(7)).toBe("2026-03-01");
        });
    });

    describe("getContentDateStringForLastDayOfWeek", () => {
        // Today is Wednesday (ISO 3).
        test("last Tuesday is yesterday", () => {
            expect(getContentDateStringForLastDayOfWeek(2)).toBe("2026-02-24");
        });

        test("last Wednesday is 7 days ago", () => {
            expect(getContentDateStringForLastDayOfWeek(3)).toBe("2026-02-18");
        });

        test("last Sunday is 3 days ago", () => {
            expect(getContentDateStringForLastDayOfWeek(7)).toBe("2026-02-22");
        });

        test("last Friday is 5 days ago", () => {
            expect(getContentDateStringForLastDayOfWeek(5)).toBe("2026-02-20");
        });
    });
});

describe("formatContentDateAbsolute", () => {
    test("formats US English absolute date", () => {
        expect(formatContentDateAbsolute("2026-02-25")).toBe("February 25, 2026");
    });

    test("formats single-digit day", () => {
        expect(formatContentDateAbsolute("2026-03-01")).toBe("March 1, 2026");
    });

    test("formats December", () => {
        expect(formatContentDateAbsolute("2025-12-31")).toBe("December 31, 2025");
    });
});
