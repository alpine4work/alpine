import {
    contentDateFullMonthNames,
    formatContentDateString,
    isValidContentDate,
    parseContentDateString,
} from "~/shared/content/content_date_helpers.js";

export type ContentDateSuggestion = {
    readonly label: string;
    readonly dateString: string;
};

/**
 * Returns date suggestions for the @ mention menu using exact case-insensitive
 * prefix matching. Supports:
 *
 * - Relative keywords: "today", "tomorrow", "yesterday"
 * - Day names: "monday", "tuesday", etc. (next occurrence)
 * - "next monday", "last friday", etc.
 * - Month-based entry: "february 2", "feb 2", "feb 2 2028"
 *
 * No fuzzy matching is used — the query must be an exact prefix of a recognized
 * keyword or month name.
 */
export function getContentDateSuggestions(
    query: string,
    today: string,
): ReadonlyArray<ContentDateSuggestion> {
    const q = query.trim().toLowerCase();
    if (q.length === 0) return [];

    const todayYear = parseContentDateString(today).year;
    const results: Array<ContentDateSuggestion> = [];

    // Relative keywords.
    if ("today".startsWith(q)) {
        results.push({label: "Today", dateString: today});
    }
    if ("tomorrow".startsWith(q)) {
        results.push({
            label: "Tomorrow",
            dateString: addDaysToDateString(today, 1),
        });
    }
    if ("yesterday".startsWith(q)) {
        results.push({
            label: "Yesterday",
            dateString: addDaysToDateString(today, -1),
        });
    }

    // Day names and "next/last" prefixed variants.
    for (const day of weekdays) {
        if (day.lower.startsWith(q)) {
            results.push({
                label: day.display,
                dateString: nextDayOfWeekFrom(today, day.iso),
            });
        }

        // Only show "Next X" when the bare day name doesn't already match (avoids
        // duplicates for queries like "m"). "Next X" always means next calendar week's
        // occurrence, not just the next occurrence of that day.
        const nextPrefix = `next ${day.lower}`;
        if (nextPrefix.startsWith(q) && !day.lower.startsWith(q)) {
            results.push({
                label: `Next ${day.display}`,
                dateString: nextWeekDayFrom(today, day.iso),
            });
        }

        const lastPrefix = `last ${day.lower}`;
        if (lastPrefix.startsWith(q) && !day.lower.startsWith(q)) {
            results.push({
                label: `Last ${day.display}`,
                dateString: lastWeekDayFrom(today, day.iso),
            });
        }
    }

    // Month-based date entry: "february 2", "feb 2 2028".
    const tokens = q
        .replace(/,/g, " ")
        .split(/\s+/)
        .filter(t => t.length > 0);

    if (tokens.length >= 1 && tokens.length <= 3) {
        const monthToken = tokens[0]!;

        for (const month of months) {
            if (!month.full.startsWith(monthToken)) continue;

            let day = 1;
            if (tokens.length >= 2) {
                const dayStr = tokens[1]!;
                if (!/^\d+$/.test(dayStr)) continue;
                day = parseInt(dayStr, 10);
                if (day < 1 || day > 31) continue;
            }

            let year = todayYear;
            if (tokens.length === 3) {
                const yearStr = tokens[2]!;
                // Require exactly 4 digits so partial years like "20" don't produce odd results.
                if (!/^\d{4}$/.test(yearStr)) continue;
                year = parseInt(yearStr, 10);
            }

            if (!isValidContentDate(year, month.number, day)) continue;

            results.push({
                label: `${month.display} ${day}, ${year}`,
                dateString: formatContentDateString(year, month.number, day),
            });
        }
    }

    return results;
}

// ——— Internal helpers ———

const weekdays = [
    {lower: "monday", display: "Monday", iso: 1},
    {lower: "tuesday", display: "Tuesday", iso: 2},
    {lower: "wednesday", display: "Wednesday", iso: 3},
    {lower: "thursday", display: "Thursday", iso: 4},
    {lower: "friday", display: "Friday", iso: 5},
    {lower: "saturday", display: "Saturday", iso: 6},
    {lower: "sunday", display: "Sunday", iso: 7},
] as const;

const months = contentDateFullMonthNames.map((name, i) => ({
    full: name.toLowerCase(),
    display: name,
    number: i + 1,
}));

function addDaysToDateString(date: string, offset: number): string {
    const {year, month, day} = parseContentDateString(date);
    const ms = Date.UTC(year, month - 1, day) + offset * 86_400_000;
    const d = new Date(ms);
    return formatContentDateString(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function nextDayOfWeekFrom(today: string, isoDayOfWeek: number): string {
    const todayIso = isoDayOfDate(today);
    let diff = isoDayOfWeek - todayIso;
    if (diff <= 0) diff += 7;
    return addDaysToDateString(today, diff);
}

/** Returns the given day of the _next_ calendar week (Mon-Sun). */
function nextWeekDayFrom(today: string, isoDayOfWeek: number): string {
    const todayIso = isoDayOfDate(today);
    const diff = 7 - todayIso + isoDayOfWeek;
    return addDaysToDateString(today, diff);
}

/** Returns the given day of the _previous_ calendar week (Mon-Sun). */
function lastWeekDayFrom(today: string, isoDayOfWeek: number): string {
    const todayIso = isoDayOfDate(today);
    const diff = isoDayOfWeek - todayIso - 7;
    return addDaysToDateString(today, diff);
}

/** Returns the ISO day of week (1=Monday ... 7=Sunday). */
function isoDayOfDate(date: string): number {
    const {year, month, day} = parseContentDateString(date);
    const jsDay = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return jsDay === 0 ? 7 : jsDay;
}
