import {parseAgentWebTimeZoneAttribute} from "~/server/agents/web/parse_agent_web_time_zone_attribute.js";
import {
    TimeZone,
    assertTimeZone,
    formatTimeZoneAbbreviation,
} from "~/shared/helpers/intl/time_zone.js";

const utcTimeZone = assertTimeZone("UTC");
const easternTimeZone = assertTimeZone("America/New_York");
const centralTimeZone = assertTimeZone("America/Chicago");
const pacificTimeZone = assertTimeZone("America/Los_Angeles");
const winterTime = new Date("2026-01-22T18:00:00.000Z");
const summerTime = new Date("2026-07-22T18:00:00.000Z");
const candidateTimeZones = ["UTC", ...Intl.supportedValuesOf("timeZone")].map(assertTimeZone);

describe("UTC names", () => {
    test.each(["UTC", "utc", " GMT ", "Z", " z "])("parses %s", timeZoneAttribute => {
        expect(parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, summerTime)).toBe(
            utcTimeZone,
        );
    });
});

describe("IANA time zones", () => {
    test("parses every time zone supported by Intl", () => {
        const failures = candidateTimeZones.filter(
            timeZone =>
                parseAgentWebTimeZoneAttribute(timeZone, easternTimeZone, summerTime) !== timeZone,
        );

        expect(failures).toEqual([]);
    });

    test.each(["Japan", "ROK", "US/Pacific", "GB", "EST5EDT", "Etc/GMT+5"])(
        "parses the IANA alias %s",
        timeZoneAttribute => {
            expect(
                parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, summerTime),
            ).toBe(timeZoneAttribute);
        },
    );

    test.each([
        {
            expected: "America/Los_Angeles",
            timeZoneAttribute: " America/Los_Angeles ",
        },
        {
            expected: "america/new_york",
            timeZoneAttribute: "america/new_york",
        },
        {
            expected: "America/New_York",
            timeZoneAttribute: " America / New York ",
        },
        {
            expected: "America/North_Dakota/New_Salem",
            timeZoneAttribute: " America / North Dakota / New Salem ",
        },
    ])("normalizes $timeZoneAttribute", ({expected, timeZoneAttribute}) => {
        expect(parseAgentWebTimeZoneAttribute(timeZoneAttribute, pacificTimeZone, summerTime)).toBe(
            expected,
        );
    });
});

describe("location names", () => {
    test.each([
        {expected: easternTimeZone, timeZoneAttribute: "New_York"},
        {expected: easternTimeZone, timeZoneAttribute: "new_york"},
        {expected: easternTimeZone, timeZoneAttribute: "New York"},
        {expected: easternTimeZone, timeZoneAttribute: " new york "},
        {expected: pacificTimeZone, timeZoneAttribute: "Los Angeles"},
        {
            expected: assertTimeZone("America/Port_of_Spain"),
            timeZoneAttribute: "Port of Spain",
        },
        {
            expected: assertTimeZone("America/North_Dakota/New_Salem"),
            timeZoneAttribute: "New Salem",
        },
    ])("parses $timeZoneAttribute", ({expected, timeZoneAttribute}) => {
        expect(parseAgentWebTimeZoneAttribute(timeZoneAttribute, pacificTimeZone, summerTime)).toBe(
            expected,
        );
    });

    test.each([
        {name: "underscores", replaceUnderscores: false},
        {name: "spaces", replaceUnderscores: true},
    ])("parses every Intl location using $name", ({replaceUnderscores}) => {
        const failures = Intl.supportedValuesOf("timeZone").filter(timeZone => {
            const location = timeZone.slice(timeZone.lastIndexOf("/") + 1);
            const timeZoneAttribute = replaceUnderscores ? location.replaceAll("_", " ") : location;
            return (
                parseAgentWebTimeZoneAttribute(timeZoneAttribute, pacificTimeZone, summerTime) !==
                timeZone
            );
        });

        expect(failures).toEqual([]);
    });
});

describe("UTC offsets", () => {
    test.each(["-4", "-04", "-0400", "-04:00", "UTC-4", "utc-04:00", "UTC−04:00"])(
        "prefers the context time zone for %s",
        timeZoneAttribute => {
            expect(
                parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, summerTime),
            ).toBe(easternTimeZone);
        },
    );

    test.each([
        {expectedOffsetMinutes: 330, timeZoneAttribute: "+5:30"},
        {expectedOffsetMinutes: 330, timeZoneAttribute: "+0530"},
        {expectedOffsetMinutes: 330, timeZoneAttribute: "+05:30"},
        {expectedOffsetMinutes: 330, timeZoneAttribute: "UTC+05:30"},
        {expectedOffsetMinutes: 330, timeZoneAttribute: "gmt+5:30"},
        {expectedOffsetMinutes: 330, timeZoneAttribute: " GMT + 05 : 30 "},
        {expectedOffsetMinutes: 300, timeZoneAttribute: "+5"},
        {expectedOffsetMinutes: 300, timeZoneAttribute: "UTC+05"},
        {expectedOffsetMinutes: 0, timeZoneAttribute: "UTC+0"},
        {expectedOffsetMinutes: 0, timeZoneAttribute: "GMT-00:00"},
        {expectedOffsetMinutes: 0, timeZoneAttribute: "+0000"},
        {expectedOffsetMinutes: 0, timeZoneAttribute: "-0"},
    ])("parses $timeZoneAttribute", ({expectedOffsetMinutes, timeZoneAttribute}) => {
        const parsedTimeZone = parseAgentWebTimeZoneAttribute(
            timeZoneAttribute,
            easternTimeZone,
            summerTime,
        );

        expect(getTimeZoneOffsetMinutes(parsedTimeZone, summerTime)).toBe(expectedOffsetMinutes);
    });

    test("parses every UTC offset represented by an Intl time zone", () => {
        const supportedOffsets = new Set(
            candidateTimeZones.map(timeZone => getTimeZoneOffsetMinutes(timeZone, summerTime)),
        );
        const failures = [...supportedOffsets].filter(offsetMinutes => {
            const sign = offsetMinutes < 0 ? "-" : "+";
            const absoluteOffsetMinutes = Math.abs(offsetMinutes);
            const hours = Math.floor(absoluteOffsetMinutes / 60)
                .toString()
                .padStart(2, "0");
            const minutes = (absoluteOffsetMinutes % 60).toString().padStart(2, "0");
            const timeZoneAttribute = `${sign}${hours}:${minutes}`;

            const parsedTimeZone = parseAgentWebTimeZoneAttribute(
                timeZoneAttribute,
                easternTimeZone,
                summerTime,
            );
            return getTimeZoneOffsetMinutes(parsedTimeZone, summerTime) !== offsetMinutes;
        });

        expect(failures).toEqual([]);
    });

    test.each(["+15", "-15", "+14:01", "-14:01", "+05:60", "UTC04:00", "+5:3", "++05:00", "UTC+"])(
        "rejects invalid offset %s",
        timeZoneAttribute => {
            expect(() =>
                parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, summerTime),
            ).toThrow("Unexpected agent web time zone attribute");
        },
    );
});

describe("abbreviations", () => {
    test.each([
        {time: summerTime, timeZoneAttribute: "EDT"},
        {time: summerTime, timeZoneAttribute: "edt"},
        {time: summerTime, timeZoneAttribute: " EdT "},
        {time: winterTime, timeZoneAttribute: "EST"},
    ])("parses the context abbreviation $timeZoneAttribute", ({time, timeZoneAttribute}) => {
        expect(parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, time)).toBe(
            easternTimeZone,
        );
    });

    test("prefers the context when its abbreviation is otherwise ambiguous", () => {
        expect(parseAgentWebTimeZoneAttribute("CST", centralTimeZone, winterTime)).toBe(
            centralTimeZone,
        );
    });

    test("prefers a context time zone that prints GMT", () => {
        const londonTimeZone = assertTimeZone("Europe/London");

        expect(parseAgentWebTimeZoneAttribute("GMT", londonTimeZone, winterTime)).toBe(
            londonTimeZone,
        );
    });

    test("parses an abbreviation with one UTC offset", () => {
        const timeZone = parseAgentWebTimeZoneAttribute("PDT", easternTimeZone, summerTime);

        expect(formatTimeZoneAbbreviation(timeZone, summerTime)).toBe("PDT");
    });

    test.each([
        {name: "winter", time: winterTime},
        {name: "summer", time: summerTime},
    ])("round trips every printed abbreviation in $name", ({time}) => {
        const failures = candidateTimeZones.filter(timeZone => {
            const timeZoneAttribute = formatTimeZoneAbbreviation(timeZone, time);
            return parseAgentWebTimeZoneAttribute(timeZoneAttribute, timeZone, time) !== timeZone;
        });

        expect(failures).toEqual([]);
    });

    test.each([
        {name: "winter", time: winterTime},
        {name: "summer", time: summerTime},
    ])("handles every emitted abbreviation consistently in $name", ({time}) => {
        const offsetsByAbbreviation = new Map<string, Set<number>>();

        for (const timeZone of candidateTimeZones) {
            const abbreviation = formatTimeZoneAbbreviation(timeZone, time).toUpperCase();
            const offsets = offsetsByAbbreviation.get(abbreviation) ?? new Set<number>();
            offsets.add(getTimeZoneOffsetMinutes(timeZone, time));
            offsetsByAbbreviation.set(abbreviation, offsets);
        }

        const contextAbbreviation = formatTimeZoneAbbreviation(easternTimeZone, time).toUpperCase();
        const contextOffsetMinutes = getTimeZoneOffsetMinutes(easternTimeZone, time);
        const failures: Array<string> = [];

        for (const [abbreviation, offsets] of offsetsByAbbreviation) {
            const expectedOffsetMinutes =
                abbreviation === contextAbbreviation
                    ? contextOffsetMinutes
                    : offsets.size === 1
                      ? [...offsets][0]!
                      : null;

            try {
                const parsedTimeZone = parseAgentWebTimeZoneAttribute(
                    abbreviation,
                    easternTimeZone,
                    time,
                );
                if (
                    expectedOffsetMinutes === null ||
                    getTimeZoneOffsetMinutes(parsedTimeZone, time) !== expectedOffsetMinutes
                ) {
                    failures.push(abbreviation);
                }
            } catch {
                if (expectedOffsetMinutes !== null) failures.push(abbreviation);
            }
        }

        expect(failures).toEqual([]);
    });

    test("rejects an abbreviation with multiple UTC offsets", () => {
        expect(() => parseAgentWebTimeZoneAttribute("CST", easternTimeZone, summerTime)).toThrow(
            "Ambiguous agent web time zone attribute",
        );
    });
});

describe("invalid attributes", () => {
    test.each(["", "   ", "Peanut Butter Jelly Time", "Not/A_Real_Zone", "Mars/Olympus_Mons"])(
        "rejects %s",
        timeZoneAttribute => {
            expect(() =>
                parseAgentWebTimeZoneAttribute(timeZoneAttribute, easternTimeZone, summerTime),
            ).toThrow("Unexpected agent web time zone attribute");
        },
    );
});

function getTimeZoneOffsetMinutes(timeZone: TimeZone, time: Date): number {
    const offsetString = new Intl.DateTimeFormat("en-US", {
        timeZone,
        timeZoneName: "longOffset",
    })
        .formatToParts(time)
        .find(part => part.type === "timeZoneName")?.value;
    if (offsetString === "GMT") return 0;

    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetString ?? "");
    // eslint-disable-next-line cyberworlds/no-global-error
    if (match === null) throw new Error(`Unexpected time zone offset: ${offsetString}`);

    const offsetMinutes = Number(match[2]) * 60 + Number(match[3]);
    return match[1] === "+" ? offsetMinutes : -offsetMinutes;
}
