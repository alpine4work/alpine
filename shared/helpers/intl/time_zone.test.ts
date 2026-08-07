import {
    assertTimeZone,
    defaultTimeZone,
    formatTimeZoneAbbreviation,
    getCurrentTimeZone,
    isTimeZone,
} from "~/shared/helpers/intl/time_zone.open_source.js";

describe("formatTimeZoneAbbreviation", () => {
    describe("standard time zones", () => {
        const testCases = [
            {
                timeZone: "America/New_York",
                date: new Date("2024-01-15T12:00:00Z"), // Winter
                expected: "EST",
            },
            {
                timeZone: "America/New_York",
                date: new Date("2024-07-15T12:00:00Z"), // Summer
                expected: "EDT",
            },
            {
                timeZone: "America/Los_Angeles",
                date: new Date("2024-01-15T12:00:00Z"), // Winter
                expected: "PST",
            },
            {
                timeZone: "America/Los_Angeles",
                date: new Date("2024-07-15T12:00:00Z"), // Summer
                expected: "PDT",
            },
            {
                timeZone: "America/Chicago",
                date: new Date("2024-01-15T12:00:00Z"), // Winter
                expected: "CST",
            },
            {
                timeZone: "America/Chicago",
                date: new Date("2024-07-15T12:00:00Z"), // Summer
                expected: "CDT",
            },
        ];

        testCases.forEach(({timeZone, date, expected}) => {
            test(`formats ${timeZone} on ${date.toISOString()} as ${expected}`, () => {
                const result = formatTimeZoneAbbreviation(assertTimeZone(timeZone), date);
                expect(result).toBe(expected);
            });
        });
    });

    describe("time zones without daylight saving", () => {
        const testCases = [
            {
                timeZone: "America/Phoenix",
                date: new Date("2024-01-15T12:00:00Z"),
                expected: "MST",
            },
            {
                timeZone: "America/Phoenix",
                date: new Date("2024-07-15T12:00:00Z"),
                expected: "MST",
            },
            {
                timeZone: "UTC",
                date: new Date("2024-01-15T12:00:00Z"),
                expected: "UTC",
            },
        ];

        testCases.forEach(({timeZone, date, expected}) => {
            test(`formats ${timeZone} on ${date.toISOString()} as ${expected}`, () => {
                const result = formatTimeZoneAbbreviation(assertTimeZone(timeZone), date);
                expect(result).toBe(expected);
            });
        });
    });

    describe("international time zones", () => {
        const testCases = [
            {
                timeZone: "Europe/London",
                date: new Date("2024-01-15T12:00:00Z"), // Winter
                expected: "GMT",
            },
            {
                timeZone: "Europe/London",
                date: new Date("2024-07-15T12:00:00Z"), // Summer
                expected: "BST",
            },
            {
                timeZone: "Asia/Tokyo",
                date: new Date("2024-01-15T12:00:00Z"),
                expected: "JST",
            },
            {
                timeZone: "Australia/Sydney",
                date: new Date("2024-01-15T12:00:00Z"), // Summer (southern hemisphere)
                expected: "AEDT",
            },
            {
                timeZone: "Australia/Sydney",
                date: new Date("2024-07-15T12:00:00Z"), // Winter (southern hemisphere)
                expected: "AEST",
            },
        ];

        testCases.forEach(({timeZone, date, expected}) => {
            test(`formats ${timeZone} on ${date.toISOString()} as ${expected}`, () => {
                const result = formatTimeZoneAbbreviation(assertTimeZone(timeZone), date);
                expect(result).toBe(expected);
            });
        });
    });

    describe("daylight saving time transitions", () => {
        const testCases = [
            {
                description: "before DST starts",
                timeZone: "America/New_York",
                date: new Date("2024-03-10T06:00:00Z"), // Before 2 AM EST (7 AM UTC)
                expected: "EST",
            },
            {
                description: "after DST starts",
                timeZone: "America/New_York",
                date: new Date("2024-03-10T08:00:00Z"), // After 3 AM EDT (7 AM UTC)
                expected: "EDT",
            },
            {
                description: "before DST ends",
                timeZone: "America/New_York",
                date: new Date("2024-11-03T05:00:00Z"), // Before 2 AM EDT (6 AM UTC)
                expected: "EDT",
            },
            {
                description: "after DST ends",
                timeZone: "America/New_York",
                date: new Date("2024-11-03T07:00:00Z"), // After 2 AM EST (7 AM UTC)
                expected: "EST",
            },
        ];

        testCases.forEach(({description, timeZone, date, expected}) => {
            test(`formats ${timeZone} ${description} as ${expected}`, () => {
                const result = formatTimeZoneAbbreviation(assertTimeZone(timeZone), date);
                expect(result).toBe(expected);
            });
        });
    });
});

describe("isTimeZone", () => {
    describe("valid time zones", () => {
        const validTimeZones = [
            "America/New_York",
            "America/Los_Angeles",
            "UTC",
            "Europe/London",
            "Asia/Tokyo",
            "Australia/Sydney",
        ];

        validTimeZones.forEach(timeZone => {
            test(`returns true for ${timeZone}`, () => {
                expect(isTimeZone(timeZone)).toBe(true);
            });
        });
    });

    describe("invalid time zones", () => {
        const invalidTimeZones = ["Invalid/TimeZone", "America/InvalidCity", "", "not-a-timezone"];

        invalidTimeZones.forEach(timeZone => {
            test(`returns false for ${timeZone}`, () => {
                expect(isTimeZone(timeZone)).toBe(false);
            });
        });
    });

    test("caches valid time zones for performance", () => {
        const timeZone = "America/New_York";

        // First call
        expect(isTimeZone(timeZone)).toBe(true);

        // Second call should use cache
        expect(isTimeZone(timeZone)).toBe(true);
    });
});

describe("assertTimeZone", () => {
    test("returns the time zone when valid", () => {
        const timeZone = "America/New_York";
        expect(assertTimeZone(timeZone)).toBe(timeZone);
    });

    test("throws when invalid", () => {
        expect(() => assertTimeZone("Invalid/TimeZone")).toThrow();
    });
});

describe("getCurrentTimeZone", () => {
    test("returns a valid time zone", () => {
        const currentTimeZone = getCurrentTimeZone();
        expect(isTimeZone(currentTimeZone)).toBe(true);
    });
});

describe("defaultTimeZone", () => {
    test("is America/New_York", () => {
        expect(defaultTimeZone).toBe("America/New_York");
    });

    test("is a valid time zone", () => {
        expect(isTimeZone(defaultTimeZone)).toBe(true);
    });
});
