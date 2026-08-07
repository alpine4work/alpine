import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {
    TimeZone,
    assertTimeZone,
    formatTimeZoneAbbreviation,
    isTimeZone,
} from "~/shared/helpers/intl/time_zone.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

/**
 * Parses an agent-web `timezone` attribute into an IANA time zone.
 *
 * Accepts the short names agent web prints, full IANA identifiers, location-only
 * names, and UTC offsets. Prefer the context zone whenever it matches. When only a
 * short name is provided, choose a representative IANA zone only when every match
 * has the same UTC offset at `time`.
 */
export function parseAgentWebTimeZoneAttribute(
    timeZoneAttribute: string,
    contextTimeZone: TimeZone,
    time = new Date(),
): TimeZone {
    const trimmedTimeZoneAttribute = timeZoneAttribute.trim();
    const normalizedTimeZoneAttribute = trimmedTimeZoneAttribute.toUpperCase();

    if (
        formatTimeZoneAbbreviation(contextTimeZone, time).toUpperCase() ===
        normalizedTimeZoneAttribute
    ) {
        return contextTimeZone;
    }

    if (
        normalizedTimeZoneAttribute === "UTC" ||
        normalizedTimeZoneAttribute === "GMT" ||
        normalizedTimeZoneAttribute === "Z"
    ) {
        return assertTimeZone("UTC");
    }

    const normalizedOffsetAttribute = trimmedTimeZoneAttribute
        .replaceAll("−", "-")
        .replaceAll(" ", "");
    const isOffsetAttribute = /^(?:UTC|GMT)?[+-]/i.test(normalizedOffsetAttribute);

    // A slash or a digit distinguishes IANA names and aliases from legacy short names
    // such as `CST` that `Intl` may also accept as time zone identifiers.
    if (
        !isOffsetAttribute &&
        (trimmedTimeZoneAttribute.includes("/") || /\d/.test(trimmedTimeZoneAttribute)) &&
        isTimeZone(trimmedTimeZoneAttribute)
    ) {
        return trimmedTimeZoneAttribute;
    }

    const candidateTimeZones = ["UTC", ...Intl.supportedValuesOf("timeZone")].map(assertTimeZone);
    const normalizedLocationAttribute = trimmedTimeZoneAttribute
        .replace(/\s*\/\s*/g, "/")
        .replaceAll(" ", "_")
        .toLowerCase();
    const contextLocation = assertExists(contextTimeZone.split("/").at(-1)).toLowerCase();

    if (
        !normalizedLocationAttribute.includes("/") &&
        contextLocation === normalizedLocationAttribute
    ) {
        return contextTimeZone;
    }

    const locationTimeZones = candidateTimeZones.filter(timeZone => {
        const normalizedTimeZone = timeZone.toLowerCase();
        return (
            normalizedTimeZone === normalizedLocationAttribute ||
            (!normalizedLocationAttribute.includes("/") &&
                normalizedTimeZone.endsWith(`/${normalizedLocationAttribute}`))
        );
    });

    if (locationTimeZones.length === 1) return locationTimeZones[0]!;

    if (locationTimeZones.length > 1) {
        throw new InvalidArgumentError("Ambiguous agent web time zone location", {
            displayMessage: errorDisplayMessage`The \`timezone\` location ${quote(timeZoneAttribute)} can refer to more than one IANA time zone. Try again with a full IANA time zone identifier (e.g. \`timezone="America/New_York"\`) or remove the \`timezone\` attribute to use your current time zone.`,
        });
    }

    const offsetMatch = /^(?:UTC|GMT)?([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(
        normalizedOffsetAttribute,
    );

    if (offsetMatch !== null) {
        const offsetHours = Number(assertExists(offsetMatch[2]));
        const offsetMinutes = Number(offsetMatch[3] ?? "0");

        if (offsetHours <= 14 && offsetMinutes < 60 && (offsetHours < 14 || offsetMinutes === 0)) {
            const totalOffsetMinutes =
                (offsetMatch[1] === "+" ? 1 : -1) * (offsetHours * 60 + offsetMinutes);

            if (getAgentWebTimeZoneOffsetMinutes(contextTimeZone, time) === totalOffsetMinutes) {
                return contextTimeZone;
            }

            const offsetTimeZone = candidateTimeZones.find(
                timeZone => getAgentWebTimeZoneOffsetMinutes(timeZone, time) === totalOffsetMinutes,
            );
            if (offsetTimeZone !== undefined) return offsetTimeZone;
        }
    }

    let parsedTimeZone: TimeZone | null = null;
    let parsedTimeZoneOffsetMinutes: number | null = null;
    let isAmbiguous = false;

    for (const timeZone of candidateTimeZones) {
        if (
            formatTimeZoneAbbreviation(timeZone, time).toUpperCase() !== normalizedTimeZoneAttribute
        ) {
            continue;
        }

        const timeZoneOffsetMinutes = getAgentWebTimeZoneOffsetMinutes(timeZone, time);

        if (parsedTimeZone === null) {
            parsedTimeZone = timeZone;
            parsedTimeZoneOffsetMinutes = timeZoneOffsetMinutes;
        } else if (timeZoneOffsetMinutes !== parsedTimeZoneOffsetMinutes) {
            isAmbiguous = true;
            break;
        }
    }

    if (parsedTimeZone !== null && !isAmbiguous) return parsedTimeZone;

    if (isAmbiguous) {
        throw new InvalidArgumentError("Ambiguous agent web time zone attribute", {
            displayMessage: errorDisplayMessage`The \`timezone\` abbreviation ${quote(timeZoneAttribute)} can refer to more than one UTC offset. Try again with an IANA time zone identifier (e.g. \`timezone="America/Chicago"\`) or remove the \`timezone\` attribute to use your current time zone.`,
        });
    }

    // Some valid IANA aliases don't have a slash (e.g. `Japan` and `ROK`). Check them
    // after abbreviations so ambiguous legacy identifiers such as `CST` don't bypass
    // abbreviation validation merely because `Intl` accepts them.
    if (!isOffsetAttribute && isTimeZone(trimmedTimeZoneAttribute)) {
        return trimmedTimeZoneAttribute;
    }

    throw new InvalidArgumentError("Unexpected agent web time zone attribute", {
        displayMessage: errorDisplayMessage`Unexpected \`timezone\` attribute ${quote(timeZoneAttribute)}. Try again with a UTC offset (e.g. \`timezone="UTC-04:00"\`), a location (e.g. \`timezone="New_York"\`), a full IANA time zone identifier (e.g. \`timezone="America/Los_Angeles"\`), a time zone abbreviation from Alpine, or remove the \`timezone\` attribute to use your current time zone.`,
    });
}

function getAgentWebTimeZoneOffsetMinutes(timeZone: TimeZone, time: Date): number {
    const offsetString = assertExists(
        new Intl.DateTimeFormat("en-US", {timeZone, timeZoneName: "longOffset"})
            .formatToParts(time)
            .find(part => part.type === "timeZoneName")?.value,
    );
    if (offsetString === "GMT") return 0;

    const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offsetString);
    assert(match !== null);

    const offsetMinutes = Number(assertExists(match[2])) * 60 + Number(assertExists(match[3]));
    return match[1] === "+" ? offsetMinutes : -offsetMinutes;
}
