import {
    ScheduleDateTimeSchema,
    ScheduleDateTimeString,
    assertScheduleDateTime,
    assertScheduleDateTimeString,
    deserializeScheduleDateTime,
    deserializeScheduleDateTimeString,
    isScheduleDateTime,
    isScheduleDateTimeString,
    serializeScheduleDateTime,
    serializeScheduleDateTimeString,
} from "~/server/notifications/core/schedule_date_time.js";
import {SchemaDeserializationError} from "~/shared/schema/schema.open_source.js";

describe("isScheduleDateTime", () => {
    test("returns true for valid date", () => {
        const validDate = new Date("2023-12-25T15:00:00.000Z");
        expect(isScheduleDateTime(validDate)).toBe(true);
    });

    test("returns true for New Year\u2019s Day at midnight", () => {
        const validDate = new Date("2024-01-01T00:00:00.000Z");
        expect(isScheduleDateTime(validDate)).toBe(true);
    });

    test("returns false for date with non-zero minutes", () => {
        const dateWithMinutes = new Date("2023-12-25T15:01:00.000Z");
        expect(isScheduleDateTime(dateWithMinutes)).toBe(false);
    });

    test("returns false for date with non-zero seconds", () => {
        const dateWithSeconds = new Date("2023-12-25T15:00:45.000Z");
        expect(isScheduleDateTime(dateWithSeconds)).toBe(false);
    });

    test("returns false for date with non-zero milliseconds", () => {
        const dateWithMilliseconds = new Date("2023-12-25T15:00:00.123Z");
        expect(isScheduleDateTime(dateWithMilliseconds)).toBe(false);
    });

    test("returns false for date with non-zero minutes, seconds, and milliseconds", () => {
        const dateWithSecondsAndMilliseconds = new Date("2023-12-25T15:25:42.123Z");
        expect(isScheduleDateTime(dateWithSecondsAndMilliseconds)).toBe(false);
    });

    test("returns false for completely invalid date object", () => {
        const invalidDate = new Date("invalid");
        expect(isScheduleDateTime(invalidDate)).toBe(false);
    });

    test("returns true for EST date that converts to valid UTC format", () => {
        const dateWithOffset = new Date("2023-12-25T10:00:00-05:00");
        expect(isScheduleDateTime(dateWithOffset)).toBe(true);
    });
});

describe("assertScheduleDateTime", () => {
    test("returns date with equal value for valid ScheduleDateTime", () => {
        const validDate = new Date("2023-12-25T15:00:00.000Z");
        const result = assertScheduleDateTime(validDate);
        expect(result).toEqual(validDate);
    });

    test("throws error for date with minutes precision", () => {
        const invalidDate = new Date("2023-12-25T15:01:00.000Z");
        expect(() => assertScheduleDateTime(invalidDate)).toThrow();
    });

    test("throws error for date with seconds precision", () => {
        const invalidDate = new Date("2023-12-25T15:00:45.000Z");
        expect(() => assertScheduleDateTime(invalidDate)).toThrow();
    });

    test("throws error for date with milliseconds precision", () => {
        const invalidDate = new Date("2023-12-25T15:00:00.123Z");
        expect(() => assertScheduleDateTime(invalidDate)).toThrow();
    });

    test("throws error for completely invalid date object", () => {
        const invalidDate = new Date("invalid");
        expect(() => assertScheduleDateTime(invalidDate)).toThrow();
    });
});

describe("serializeScheduleDateTime", () => {
    test("preserves already correctly formatted date unchanged", () => {
        const validDate = new Date("2023-12-25T15:00:00.000Z");
        const result = serializeScheduleDateTime(validDate);
        expect(result.toISOString()).toBe("2023-12-25T15:00:00.000Z");
    });

    test("rounds up minutes to next quarter hour", () => {
        const dateWithMinutes = new Date("2023-12-25T15:01:00.123Z");
        const result = serializeScheduleDateTime(dateWithMinutes);
        expect(result.toISOString()).toBe("2023-12-25T15:15:00.000Z");
    });

    test("truncates milliseconds then preserves quarter hour", () => {
        const dateWithMilliseconds = new Date("2023-12-25T15:00:00.123Z");
        const result = serializeScheduleDateTime(dateWithMilliseconds);
        expect(result.toISOString()).toBe("2023-12-25T15:00:00.000Z");
    });

    test("rounds up 11:48pm to 12:00am next day", () => {
        const date = new Date("2023-12-25T23:48:00.000Z");
        const result = serializeScheduleDateTime(date);
        expect(result.toISOString()).toBe("2023-12-26T00:00:00.000Z");
    });

    test("converts EST timezone offset to UTC correctly", () => {
        const dateWithOffset = new Date("2023-12-25T10:00:00-05:00"); // EST
        const result = serializeScheduleDateTime(dateWithOffset);
        expect(result.toISOString()).toBe("2023-12-25T15:00:00.000Z");
    });

    test("returns valid ScheduleDateTime for daylight saving time date", () => {
        const springDate = new Date("2023-03-12T07:00:00.000Z");
        const result = serializeScheduleDateTime(springDate);
        expect(isScheduleDateTime(result)).toBe(true);
    });

    test("throws error for invalid date object", () => {
        const invalidDate = new Date("invalid");
        expect(() => serializeScheduleDateTime(invalidDate)).toThrow();
    });
});

describe("deserializeScheduleDateTime", () => {
    test("preserves ISO string format after deserialization", () => {
        const scheduleDateTime = serializeScheduleDateTime(new Date("2023-12-25T15:00:00.000Z"));
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.toISOString()).toBe("2023-12-25T15:00:00.000Z");
    });

    test("preserves year from original date", () => {
        const originalDate = new Date("2024-06-15T09:00:00.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getFullYear()).toBe(2024);
    });

    test("preserves month from original date (0-based)", () => {
        const originalDate = new Date("2024-06-15T09:00:00.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getMonth()).toBe(5); // 0-based months
    });

    test("preserves day of month from original date", () => {
        const originalDate = new Date("2024-06-15T09:00:00.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getDate()).toBe(15);
    });

    test("preserves hours from original date", () => {
        const originalDate = new Date("2024-06-15T09:00:00.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getUTCHours()).toBe(9);
    });

    test("ensures minutes are on quarter hour after deserialization", () => {
        const originalDate = new Date("2024-06-15T09:14:30.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getUTCMinutes()).toBe(15);
    });

    test("ensures seconds are zero after deserialization", () => {
        const originalDate = new Date("2024-06-15T09:00:45.000Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getUTCSeconds()).toBe(0);
    });

    test("ensures milliseconds are zero after deserialization", () => {
        const originalDate = new Date("2024-06-15T09:00:00.500Z");
        const scheduleDateTime = serializeScheduleDateTime(originalDate);
        const result = deserializeScheduleDateTime(scheduleDateTime);
        expect(result.getUTCMilliseconds()).toBe(0);
    });
});

describe("isScheduleDateTimeString", () => {
    test("returns true for valid string", () => {
        expect(isScheduleDateTimeString("2023-08-21T15:00:00.000Z")).toBe(true);
    });

    test("returns false for string with non-zero minutes precision", () => {
        expect(isScheduleDateTimeString("2023-12-25T15:01:00.000Z")).toBe(false);
    });

    test("returns false for string with non-zero seconds precision", () => {
        expect(isScheduleDateTimeString("2023-12-25T15:00:45.000Z")).toBe(false);
    });

    test("returns false for string with non-zero milliseconds precision", () => {
        expect(isScheduleDateTimeString("2023-12-25T15:00:00.500Z")).toBe(false);
    });

    test("returns false for string with space instead of T", () => {
        expect(isScheduleDateTimeString("2023-12-25 15:00:00.000Z")).toBe(false);
    });

    test("returns false for string with slash date separators", () => {
        expect(isScheduleDateTimeString("2023/12/25T15:00:00.000Z")).toBe(false);
    });

    test("returns false for string missing Z timezone indicator", () => {
        expect(isScheduleDateTimeString("2023-12-25T15:00:00.000")).toBe(false);
    });

    test("returns false for completely invalid date string", () => {
        expect(isScheduleDateTimeString("invalid-date")).toBe(false);
    });

    test("returns false for empty string", () => {
        expect(isScheduleDateTimeString("")).toBe(false);
    });

    test("returns false for string with invalid hour 25", () => {
        expect(isScheduleDateTimeString("2023-12-25T25:00:00.000Z")).toBe(false);
    });

    test("returns false for string with invalid month 13", () => {
        expect(isScheduleDateTimeString("2023-13-25T15:00:00.000Z")).toBe(false);
    });

    test("returns false for string with invalid leap day 29th of February", () => {
        expect(isScheduleDateTimeString("2023-02-29T15:00:00.000Z")).toBe(false);
    });

    test("returns false for number input", () => {
        expect(isScheduleDateTimeString(123 as any)).toBe(false);
    });

    test("returns false for null input", () => {
        expect(isScheduleDateTimeString(null as any)).toBe(false);
    });

    test("returns false for undefined input", () => {
        expect(isScheduleDateTimeString(undefined as any)).toBe(false);
    });

    test("returns false for Date object input", () => {
        expect(isScheduleDateTimeString(new Date() as any)).toBe(false);
    });

    test("returns true for Unix epoch start date", () => {
        expect(isScheduleDateTimeString("1970-01-01T00:00:00.000Z")).toBe(true);
    });

    test("returns true for far future date 2099", () => {
        expect(isScheduleDateTimeString("2099-12-31T23:00:00.000Z")).toBe(true);
    });
});

describe("assertScheduleDateTimeString", () => {
    test("returns equal string for valid date string", () => {
        const validString = "2023-08-21T15:00:00.000Z";
        const result = assertScheduleDateTimeString(validString);
        expect(result).toEqual(validString);
    });

    test("throws error for string with minutes precision", () => {
        expect(() => assertScheduleDateTimeString("2023-12-25T15:01:00.000Z")).toThrow();
    });

    test("throws error for string with seconds precision", () => {
        expect(() => assertScheduleDateTimeString("2023-12-25T15:00:45.000Z")).toThrow();
    });

    test("throws error for completely invalid date string", () => {
        expect(() => assertScheduleDateTimeString("invalid-date")).toThrow();
    });

    test("throws error for empty string", () => {
        expect(() => assertScheduleDateTimeString("")).toThrow();
    });
});

describe("serializeScheduleDateTimeString", () => {
    test("converts ScheduleDateTime to expected format", () => {
        const scheduleDateTime = serializeScheduleDateTime(new Date("2023-08-21T15:30:45.123Z"));
        const result = serializeScheduleDateTimeString(scheduleDateTime);
        expect(result).toEqual("2023-08-21T15:30:00.000Z");
    });

    test("returns valid ScheduleDateTimeString after conversion", () => {
        const scheduleDateTime = serializeScheduleDateTime(new Date("2023-12-25T15:30:45.123Z"));
        const result = serializeScheduleDateTimeString(scheduleDateTime);
        expect(isScheduleDateTimeString(result)).toBe(true);
    });

    test("does not round up minutes if they are already on a quarter hour", () => {
        const scheduleDateTime = serializeScheduleDateTime(new Date("2024-06-15T23:15:00.000Z"));
        const result = serializeScheduleDateTimeString(scheduleDateTime);
        expect(result).toBe("2024-06-15T23:15:00.000Z");
    });

    test("rounds up minutes to next quarter hour", () => {
        const scheduleDateTime = serializeScheduleDateTime(new Date("2024-06-15T23:31:30.500Z"));
        const result = serializeScheduleDateTimeString(scheduleDateTime);
        expect(result).toBe("2024-06-15T23:45:00.000Z");
    });

    test("truncates seconds", () => {
        const ScheduleDateTime = serializeScheduleDateTime(new Date("2024-06-15T23:15:30.000Z"));
        const result = serializeScheduleDateTimeString(ScheduleDateTime);
        expect(result).toBe("2024-06-15T23:15:00.000Z");
    });

    test("truncates milliseconds", () => {
        const ScheduleDateTime = serializeScheduleDateTime(new Date("2024-06-15T23:15:00.500Z"));
        const result = serializeScheduleDateTimeString(ScheduleDateTime);
        expect(result).toBe("2024-06-15T23:15:00.000Z");
    });
});

describe("deserializeScheduleDateTimeString", () => {
    test("returns valid ScheduleDateTime from valid string", () => {
        const dateString = "2023-08-21T15:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(isScheduleDateTime(result)).toBe(true);
    });

    test("converts valid string to full ISO format", () => {
        const dateString = "2023-08-21T15:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.toISOString()).toBe("2023-08-21T15:00:00.000Z");
    });

    test("returns valid ScheduleDateTime from New Year\u2019s Day string", () => {
        const dateString = "2024-01-01T00:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(isScheduleDateTime(result)).toBe(true);
    });

    test("preserves years from original date", () => {
        const dateString = "2024-03-15T14:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getFullYear()).toBe(2024);
    });

    test("preserves month from original date", () => {
        const dateString = "2024-03-15T14:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getMonth()).toBe(2); // 0-based months
    });

    test("preserves day of month from original date", () => {
        const dateString = "2024-03-15T14:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getDate()).toBe(15);
    });

    test("preserves hours from original date", () => {
        const dateString = "2024-03-15T14:00:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getUTCHours()).toBe(14);
    });

    test("minutes are on quarter hour after deserialization", () => {
        const dateString = "2024-03-15T14:25:00.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getUTCMinutes()).toBe(30);
    });

    test("seconds are zero after deserialization", () => {
        const dateString = "2024-03-15T14:00:45.000Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getUTCSeconds()).toBe(0);
    });

    test("milliseconds are zero after deserialization", () => {
        const dateString = "2024-03-15T14:00:00.500Z" as ScheduleDateTimeString;
        const result = deserializeScheduleDateTimeString(dateString);
        expect(result.getUTCMilliseconds()).toBe(0);
    });
});

describe("ScheduleDateTimeSchema", () => {
    test("deserializes ISO string to valid ScheduleDateTime", () => {
        const isoString = "2023-12-25T15:30:45.123Z";
        const result = ScheduleDateTimeSchema.deserialize(isoString);
        expect(isScheduleDateTime(result)).toBe(true);
    });

    test("rounds minutes to quarter hour and zeroes seconds and milliseconds", () => {
        const isoString = "2023-12-25T15:30:45.123Z";
        const result = ScheduleDateTimeSchema.deserialize(isoString);
        expect(result.toISOString()).toBe("2023-12-25T15:30:00.000Z");
    });

    test("throws SchemaDeserializationError for invalid ISO string", () => {
        const invalidString = "invalid-date";
        expect(() => ScheduleDateTimeSchema.deserialize(invalidString)).toThrow(
            SchemaDeserializationError,
        );
    });
});
