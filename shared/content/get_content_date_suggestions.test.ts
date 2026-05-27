import {getContentDateSuggestions} from "~/shared/content/get_content_date_suggestions.js";

// Today is Wednesday Feb 25, 2026.
const today = "2026-02-25";

describe("getContentDateSuggestions", () => {
    describe("relative keywords", () => {
        test("tod matches Today", () => {
            expect(getContentDateSuggestions("tod", today)).toMatchObject([
                {label: "Today", dateString: "2026-02-25"},
            ]);
        });

        test("today matches Today", () => {
            expect(getContentDateSuggestions("today", today)).toMatchObject([
                {label: "Today", dateString: "2026-02-25"},
            ]);
        });

        test("tom matches Tomorrow", () => {
            expect(getContentDateSuggestions("tom", today)).toMatchObject([
                {label: "Tomorrow", dateString: "2026-02-26"},
            ]);
        });

        test("yes matches Yesterday", () => {
            expect(getContentDateSuggestions("yes", today)).toMatchObject([
                {label: "Yesterday", dateString: "2026-02-24"},
            ]);
        });

        test("t matches Today, Tomorrow, Tuesday, and Thursday", () => {
            const results = getContentDateSuggestions("t", today);
            const labels = results.map(r => r.label);
            expect(labels).toContain("Today");
            expect(labels).toContain("Tomorrow");
            expect(labels).toContain("Tuesday");
            expect(labels).toContain("Thursday");
        });
    });

    describe("day names", () => {
        test("mon matches Monday", () => {
            const results = getContentDateSuggestions("mon", today);
            expect(results).toMatchObject([{label: "Monday"}]);
            // Next Monday from Wed Feb 25 is Mon Mar 2.
            expect(results[0]!.dateString).toBe("2026-03-02");
        });

        test("wednesday matches Wednesday", () => {
            const results = getContentDateSuggestions("wednesday", today);
            expect(results).toMatchObject([{label: "Wednesday"}]);
            // Next Wednesday from Wed Feb 25 is Mar 4 (next week).
            expect(results[0]!.dateString).toBe("2026-03-04");
        });

        test("fri matches Friday", () => {
            const results = getContentDateSuggestions("fri", today);
            expect(results).toMatchObject([{label: "Friday"}]);
            // Next Friday from Wed Feb 25 is Feb 27.
            expect(results[0]!.dateString).toBe("2026-02-27");
        });
    });

    describe("next/last day prefixes", () => {
        test("next m matches Next Monday", () => {
            const results = getContentDateSuggestions("next m", today);
            expect(results).toMatchObject([{label: "Next Monday"}]);
            // Next calendar week's Monday from Wed Feb 25 is Mar 2.
            expect(results[0]!.dateString).toBe("2026-03-02");
        });

        test("next matches all Next days", () => {
            const results = getContentDateSuggestions("next", today);
            expect(results).toHaveLength(7);
            expect(results.every(r => r.label.startsWith("Next "))).toBe(true);
        });

        test("next always means next calendar week, not just next occurrence", () => {
            // Today is Wed Feb 25. "Next Thursday" should be next week's Thursday (Mar 5), not
            // tomorrow (Feb 26).
            const results = getContentDateSuggestions("next thu", today);
            expect(results).toMatchObject([{label: "Next Thursday"}]);
            expect(results[0]!.dateString).toBe("2026-03-05");
        });

        test("last f matches Last Friday", () => {
            const results = getContentDateSuggestions("last f", today);
            expect(results).toMatchObject([{label: "Last Friday"}]);
            // Last calendar week's Friday from Wed Feb 25 is Feb 20.
            expect(results[0]!.dateString).toBe("2026-02-20");
        });

        test("last always means previous calendar week", () => {
            // Today is Wed Feb 25. "Last Tuesday" should be last week's Tuesday (Feb 17), not
            // yesterday (Feb 24).
            const results = getContentDateSuggestions("last tue", today);
            expect(results).toMatchObject([{label: "Last Tuesday"}]);
            expect(results[0]!.dateString).toBe("2026-02-17");
        });

        test("mon does not show Next Monday", () => {
            const results = getContentDateSuggestions("mon", today);
            const labels = results.map(r => r.label);
            expect(labels).toContain("Monday");
            expect(labels).not.toContain("Next Monday");
        });
    });

    describe("month-based date entry", () => {
        test("february suggests February 1 of current year", () => {
            expect(getContentDateSuggestions("february", today)).toMatchObject([
                {label: "February 1, 2026", dateString: "2026-02-01"},
            ]);
        });

        test("feb suggests February 1 of current year", () => {
            expect(getContentDateSuggestions("feb", today)).toMatchObject([
                {label: "February 1, 2026", dateString: "2026-02-01"},
            ]);
        });

        test("february 2 suggests February 2", () => {
            expect(getContentDateSuggestions("february 2", today)).toMatchObject([
                {label: "February 2, 2026", dateString: "2026-02-02"},
            ]);
        });

        test("feb 2 suggests February 2", () => {
            expect(getContentDateSuggestions("feb 2", today)).toMatchObject([
                {label: "February 2, 2026", dateString: "2026-02-02"},
            ]);
        });

        test("Feb 2 2028 suggests February 2, 2028", () => {
            expect(getContentDateSuggestions("Feb 2 2028", today)).toMatchObject([
                {label: "February 2, 2028", dateString: "2028-02-02"},
            ]);
        });

        test("mar 15 suggests March 15", () => {
            expect(getContentDateSuggestions("mar 15", today)).toMatchObject([
                {label: "March 15, 2026", dateString: "2026-03-15"},
            ]);
        });

        test("oct 2 suggests October 2", () => {
            expect(getContentDateSuggestions("oct 2", today)).toMatchObject([
                {label: "October 2, 2026", dateString: "2026-10-02"},
            ]);
        });

        test("december 25, 2025 suggests December 25, 2025", () => {
            expect(getContentDateSuggestions("december 25, 2025", today)).toMatchObject([
                {label: "December 25, 2025", dateString: "2025-12-25"},
            ]);
        });

        test("ma matches March and May", () => {
            const results = getContentDateSuggestions("ma", today);
            const labels = results.map(r => r.label);
            expect(labels).toContain("March 1, 2026");
            expect(labels).toContain("May 1, 2026");
        });

        test("ju matches June and July", () => {
            const results = getContentDateSuggestions("ju", today);
            const labels = results.map(r => r.label);
            expect(labels).toContain("June 1, 2026");
            expect(labels).toContain("July 1, 2026");
        });
    });

    describe("invalid dates are excluded", () => {
        test("feb 30 returns no month suggestion", () => {
            const results = getContentDateSuggestions("feb 30", today);
            expect(results).toHaveLength(0);
        });

        test("feb 29 2026 returns no result for non-leap year", () => {
            const results = getContentDateSuggestions("feb 29 2026", today);
            expect(results).toHaveLength(0);
        });

        test("feb 29 2024 returns result for leap year", () => {
            expect(getContentDateSuggestions("feb 29 2024", today)).toMatchObject([
                {label: "February 29, 2024", dateString: "2024-02-29"},
            ]);
        });
    });

    describe("no fuzzy matching", () => {
        test("med does not match Wednesday", () => {
            expect(getContentDateSuggestions("med", today)).toHaveLength(0);
        });

        test("tues matches Tuesday", () => {
            expect(getContentDateSuggestions("tues", today)).toMatchObject([{label: "Tuesday"}]);
        });

        test("tue matches Tuesday", () => {
            expect(getContentDateSuggestions("tue", today)).toMatchObject([{label: "Tuesday"}]);
        });

        test("wedn matches Wednesday", () => {
            expect(getContentDateSuggestions("wedn", today)).toMatchObject([{label: "Wednesday"}]);
        });

        test("xyz matches nothing", () => {
            expect(getContentDateSuggestions("xyz", today)).toHaveLength(0);
        });
    });

    describe("partial year is not matched", () => {
        test("feb 2 20 returns no result", () => {
            expect(getContentDateSuggestions("feb 2 20", today)).toHaveLength(0);
        });

        test("feb 2 202 returns no result", () => {
            expect(getContentDateSuggestions("feb 2 202", today)).toHaveLength(0);
        });
    });

    describe("empty and whitespace queries", () => {
        test("empty string returns no results", () => {
            expect(getContentDateSuggestions("", today)).toHaveLength(0);
        });

        test("whitespace-only returns no results", () => {
            expect(getContentDateSuggestions("   ", today)).toHaveLength(0);
        });
    });
});
