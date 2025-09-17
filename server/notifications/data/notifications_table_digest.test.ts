import {fromDate, parseDateTime, toZoned} from "@internationalized/date";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {
    computeDigestNotificationsNextScheduledDateTime,
    isInboxEligibleForDigestNotification,
} from "~/server/notifications/data/notifications_actions.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {DigestNotificationsSchedule} from "~/shared/notifications/notifications_schedule_schema.js";

const context = createTestContext();

// NOTE(rmtobin): Watch out for the if statement ordering in `isInboxEligibleForDigestNotification`,
// since a bug with an earlier if statement could cause all later ones to fail, or cause misleading test results.
// Ideally we'd mock out the `isAccountMemberOfSpace` function to reduce this risk, but Jest's ESM
// module support doesn't allow partial mocks (and there's a lot of functions in the spaces module).
describe("isInboxEligibleForDigestNotification", () => {
    let spaceId: SpaceId;
    let accountId: AccountId;

    beforeEach(async () => {
        const space = await TestSpace.create(context);
        const account = await space.addAccount();
        spaceId = space.id;
        accountId = account.id;
    });

    const currentTime = new Date("2024-01-10T00:00:00Z");
    test("should return false when digestNotificationsOptedOutTime is set", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: new Date("2024-01-01T00:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: null,
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(false);
    });
    test("should return false when digestNotificationsSchedule is empty", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: new Set(),
            digestNotificationsLastSentTime: null,
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(false);
    });
    test("should return false when digestNotificationsSchedule is undefined", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: undefined,
            digestNotificationsLastSentTime: null,
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(false);
    });
    test("should return false when digestNotificationsLastSentTime is later than lastEntryUpdatedTime", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-20T00:00:00Z"),
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(false);
    });

    test("should return true when digestNotificationsLastSentTime is null", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: null,
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(true);
    });
    test("should return true when digestNotificationsLastSentTime is earlier than lastEntryUpdatedTime", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-05T00:00:00Z"),
            lastEntryUpdatedTime: currentTime,
            spaceId,
            accountId,
        });

        expect(result).toBe(true);
    });
    test("should return true when account is a member of the context’s space", async () => {
        const newSpace = await TestSpace.create(context);
        const newAccount = await newSpace.addAccount();

        const result = await isInboxEligibleForDigestNotification(
            context.systemAction(newSpace.id),
            {
                entryCount: 1,
                digestNotificationsOptedOutTime: null,
                digestNotificationsSchedule: new Set(["08:00", "17:00"]),
                digestNotificationsLastSentTime: null,
                lastEntryUpdatedTime: currentTime,
                spaceId: newSpace.id,
                accountId: newAccount.id,
            },
        );

        expect(result).toBe(true);
    });
    test("should return false when account is not a member of the context’s space", async () => {
        const newSpace = await TestSpace.create(context);
        const newAccount = await newSpace.addAccount();
        await newSpace.removeAccount(newAccount);

        const result = await isInboxEligibleForDigestNotification(
            context.systemAction(newSpace.id),
            {
                entryCount: 1,
                digestNotificationsOptedOutTime: null,
                digestNotificationsSchedule: new Set(["08:00", "17:00"]),
                digestNotificationsLastSentTime: null,
                lastEntryUpdatedTime: currentTime,
                spaceId: newSpace.id,
                accountId: newAccount.id,
            },
        );

        expect(result).toBe(false);
    });
});

describe("computeDigestNotificationsNextScheduledDateTime", () => {
    beforeEach(() => {
        import.meta.jest.resetAllMocks();
    });

    describe("Time zones", () => {
        describe.each([
            {
                description: "UTC",
                tzString: "UTC",
                calendarDate: "2024-01-15",
            },
            /**
             * Non-DST dates
             */
            {
                description: "Hawaiian Standard Time",
                tzString: "Pacific/Honolulu",
                calendarDate: "2024-01-15",
            },
            {
                description: "Alaska Standard Time",
                tzString: "America/Anchorage",
                calendarDate: "2024-01-15",
            },
            {
                description: "Pacific Standard Time",
                tzString: "America/Los_Angeles",
                calendarDate: "2024-01-15",
            },
            {
                description: "Mountain Standard Time",
                tzString: "America/Denver",
                calendarDate: "2024-01-15",
            },
            {
                description: "Mountain Standard Time (Arizona)",
                tzString: "America/Phoenix",
                calendarDate: "2024-01-15",
            },
            {
                description: "Central Standard Time",
                tzString: "America/Chicago",
                calendarDate: "2024-01-15",
            },
            {
                description: "Eastern Standard Time",
                tzString: "America/New_York",
                calendarDate: "2024-01-15",
            },
            /**
             * DST dates
             */
            {
                // Hawaii does not observe DST
                description: "Hawaiian Standard Time (No DST)",
                tzString: "Pacific/Honolulu",
                calendarDate: "2024-08-15",
            },
            {
                description: "Pacific Daylight Time",
                tzString: "America/Los_Angeles",
                calendarDate: "2024-08-15",
            },
            {
                description: "Mountain Daylight Time",
                tzString: "America/Denver",
                calendarDate: "2024-08-15",
            },
            {
                // Arizona does not observe DST
                description: "Mountain Standard Time (Arizona, No DST)",
                tzString: "America/Phoenix",
                calendarDate: "2024-08-15",
            },
            {
                description: "Central Daylight Time",
                tzString: "America/Chicago",
                calendarDate: "2024-08-15",
            },
            {
                description: "Eastern Daylight Time",
                tzString: "America/New_York",
                calendarDate: "2024-08-15",
            },
            // Non-US Time Zones
            {
                description: "Japan Standard Time",
                tzString: "Asia/Tokyo",
                calendarDate: "2024-01-15",
            },
            {
                description: "Western European Standard Time",
                tzString: "Europe/London",
                calendarDate: "2024-01-15",
            },
            {
                description: "Eastern European Standard Time",
                tzString: "Europe/Kyiv",
                calendarDate: "2024-01-15",
            },
        ])(
            "Gets the correct next scheduled time for each time zone",
            ({description, tzString, calendarDate}) => {
                const currentDateTime = parseDateTime(calendarDate);
                const currentZonedDateTime = toZoned(currentDateTime, tzString);
                // Convert milliseconds to hours
                const utcOffset = currentZonedDateTime.offset / 3600000;
                describe(`${description}(${utcOffset})`, () => {
                    test(`should select the earliest future scheduled time when there are multiple future times`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 5,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.set({
                            hour: 8,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["08:00", "17:00"]),
                        );

                        expect(result).not.toBeNull();
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });

                    test(`should select the future time that is closest to the current time`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 15,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.set({
                            hour: 17,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["08:00", "17:00", "20:00"]),
                        );
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });
                    test(`should return a date tomorrow when there are no future times`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 18,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.add({days: 1}).set({
                            hour: 8,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["08:00"]),
                        );
                        expect(result).not.toBeNull();
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });
                    test(`should skip a future time if it is within the lag time`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 16,
                            minute: 30,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.set({
                            hour: 20,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["08:00", "17:00", "20:00"]),
                            {lagTimeInMinutes: 60},
                        );
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });
                    test(`should select the earliest past time for the next day when no future times exist`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 18,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.add({days: 1}).set({
                            hour: 5,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["05:00", "08:00", "17:00"]),
                        );
                        expect(result).not.toBeNull();
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });

                    test(`should select the earliest past time even if there is a past time immediately before the current time`, async () => {
                        const currentLocalTime = currentZonedDateTime.set({
                            hour: 18,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });
                        const expectedTime = currentZonedDateTime.add({days: 1}).set({
                            hour: 8,
                            minute: 0,
                            second: 0,
                            millisecond: 0,
                        });

                        const result = computeDigestNotificationsNextScheduledDateTime(
                            currentLocalTime.toDate(),
                            tzString as TimeZone,
                            new Set(["08:00", "17:00"]),
                        );

                        expect(result).not.toBeNull();
                        expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
                    });
                });
            },
        );
    });

    describe("minute, second, and millisecond granularity", () => {
        const tzString = "America/New_York" as TimeZone;
        test("should handle current time with minutes when schedule is in hours", async () => {
            // Current time: 10:15 UTC, 05:15 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:15:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle current time with minutes close to the scheduled time when schedule is in hours", async () => {
            // Current time: 10:15 UTC, 05:15 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:59:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle current time with seconds when schedule is in hours", async () => {
            // Current time: 10:15 UTC, 05:15 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:00:15Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle current time with seconds close to the scheduled time when schedule is in hours", async () => {
            // Current time: 10:00:59 UTC, 05:00:59 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:00:59Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle current time with minutes and seconds close to the scheduled time when schedule is in hours", async () => {
            // Current time: 10:59:59 UTC, 05:59:59 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:59:59Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });

        test("should handle milliseconds", async () => {
            // Current time: 10:00:00.123 UTC, 05:00:00.123 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T10:00:00.123Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
    });

    describe("edge cases", () => {
        test("should use default time zone for null time zone argument", async () => {
            const tzString = null;
            const currentZonedDateTime = fromDate(
                new Date("2024-01-15T17:00:00Z"),
                defaultTimeZone,
            );

            const currentLocalTime = currentZonedDateTime.set({
                hour: 5,
                minute: 0,
                second: 0,
                millisecond: 0,
            });
            const expectedTime = currentZonedDateTime.set({
                hour: 8,
                minute: 0,
                second: 0,
                millisecond: 0,
            });

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentLocalTime.toDate(),
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
        });
        test("should handle non-UTC current time", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 20:00 UTC, 15:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T20:00:00-05:00");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["00:00", "06:00", "12:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 00:00 in America/New_York (EST, -5) timezone, which is 05:00 UTC
            const expectedTime = new Date("2024-01-16T05:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle unordered schedule set", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 17:00 UTC, 12:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T17:00:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["16:00", "08:00", "05:00", "17:00"]),
            );
            expect(result).not.toBeNull();
            const expectedTime = new Date("2024-01-15T21:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle when current UTC time is tomorrow compared to local time zone", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 01:00 UTC, prev. day 19:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T01:00:00Z");

            const utcCurrentDateTime = fromDate(currentTime, "UTC");
            const accountCurrentDateTime = fromDate(currentTime, "America/New_York");

            expect(utcCurrentDateTime.day).toBeGreaterThan(accountCurrentDateTime.day);

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["10:00", "20:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 20:00 in America/New_York (EST, -5) timezone, which is 01:00 UTC
            const expectedTime = new Date("2024-01-15T01:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });

        test("should handle when current UTC time is yesterday compared to local time zone", async () => {
            const tzString = "Asia/Tokyo" as TimeZone;
            // Current time: 23:00 UTC, next day 07:00 Asia/Tokyo (JST, +9)
            const currentTime = new Date("2024-01-15T23:00:00Z");

            const utcCurrentDateTime = fromDate(currentTime, "UTC");
            const accountCurrentDateTime = fromDate(currentTime, "Asia/Tokyo");

            expect(utcCurrentDateTime.day).toBeLessThan(accountCurrentDateTime.day);

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["10:00", "20:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 10:00 in Asia/Tokyo (JST, +9) timezone, which is 01:00 UTC
            const expectedTime = new Date("2024-01-16T01:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle current time exactly matching a scheduled hour", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 15:00 UTC, 10:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T15:00:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["10:00", "20:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 10:00 in America/New_York (EST, -5) timezone, which is 15:00 UTC
            const expectedTime = new Date("2024-01-15T15:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle midnight schedule", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 20:00 UTC, 15:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T20:00:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["00:00", "06:00", "12:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 00:00 in America/New_York (EST, -5) timezone, which is 05:00 UTC
            const expectedTime = new Date("2024-01-16T05:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });

        test("should handle current time at midnight", async () => {
            const tzString = "America/New_York" as TimeZone;
            // Current time: 00:00 UTC, 19:00 America/New_York (EST, -5)
            const currentTime = new Date("2024-01-15T00:00:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                new Set(["08:00", "17:00"]),
            );

            expect(result).not.toBeNull();
            // Should select 08:00 in America/New_York (EST, -5) timezone, which is 13:00 UTC
            const expectedTime = new Date("2024-01-15T13:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle all 24 hours scheduled", async () => {
            const tzString = "America/New_York" as TimeZone;
            const hourArray = [];
            for (let i = 0; i < 24; i++) {
                hourArray.push(`${i.toString().padStart(2, "0")}:00`);
            }
            const allHours = new Set(hourArray) as DigestNotificationsSchedule;

            const currentTime = new Date("2024-01-15T10:00:00Z");

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentTime,
                tzString,
                allHours,
            );

            expect(result).not.toBeNull();
            // Should select 05:00 in America/New_York (EST, -5) timezone, which is 10:00 UTC
            const expectedTime = new Date("2024-01-15T10:00:00Z");
            expect(result!.toISOString()).toBe(expectedTime.toISOString());
        });
        test("should handle non-DST to DST transition", async () => {
            const tzString = "America/New_York" as TimeZone;
            const currentDateTime = parseDateTime("2024-03-09");
            const currentZonedDateTime = toZoned(currentDateTime, "America/New_York");
            const currentLocalTime = currentZonedDateTime.set({
                hour: 18,
                minute: 0,
                second: 0,
                millisecond: 0,
            });
            const expectedTime = currentZonedDateTime.add({days: 1}).set({
                hour: 8,
                minute: 0,
                second: 0,
                millisecond: 0,
            });

            // The offset should change given DST transition
            expect(currentLocalTime.offset).not.toEqual(expectedTime.offset);

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentLocalTime.toDate(),
                tzString,
                new Set(["08:00"]),
            );

            expect(result).not.toBeNull();
            expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
        });
        test("should handle non-DST to DST transition with 2am scheduled time", async () => {
            const tzString = "America/New_York" as TimeZone;
            const currentDateTime = parseDateTime("2024-03-10");
            const currentZonedDateTime = toZoned(currentDateTime, "America/New_York");
            const currentLocalTime = currentZonedDateTime.set({
                hour: 1,
                minute: 0,
                second: 0,
                millisecond: 0,
            });
            const expectedTime = currentZonedDateTime.set({
                hour: 2,
                minute: 0,
                second: 0,
                millisecond: 0,
            });

            // The offset should change given DST transition
            expect(currentLocalTime.offset).not.toEqual(expectedTime.offset);

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentLocalTime.toDate(),
                tzString,
                new Set(["02:00"]),
            );

            expect(result).not.toBeNull();
            expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
        });
        test("should handle non-DST to DST transition at 2am current time", async () => {
            const tzString = "America/New_York" as TimeZone;
            const currentDateTime = parseDateTime("2024-03-10");
            const currentZonedDateTime = toZoned(currentDateTime, "America/New_York");
            const currentLocalTime = currentZonedDateTime.set({
                hour: 2,
                minute: 0,
                second: 0,
                millisecond: 0,
            });
            const expectedTime = currentZonedDateTime.set({
                hour: 8,
                minute: 0,
                second: 0,
                millisecond: 0,
            });

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentLocalTime.toDate(),
                tzString,
                new Set(["08:00"]),
            );

            expect(result).not.toBeNull();
            expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
        });
        test("should handle DST to non-DST transition", async () => {
            const tzString = "America/New_York" as TimeZone;
            const currentDateTime = parseDateTime("2024-11-02");
            const currentZonedDateTime = toZoned(currentDateTime, "America/New_York");
            const currentLocalTime = currentZonedDateTime.set({
                hour: 18,
                minute: 0,
                second: 0,
                millisecond: 0,
            });
            const expectedTime = currentZonedDateTime.add({days: 1}).set({
                hour: 8,
                minute: 0,
                second: 0,
                millisecond: 0,
            });

            // The offset should change given DST transition
            expect(currentLocalTime.offset).not.toEqual(expectedTime.offset);

            const result = computeDigestNotificationsNextScheduledDateTime(
                currentLocalTime.toDate(),
                tzString,
                new Set(["08:00"]),
            );

            expect(result).not.toBeNull();
            expect(result!.toISOString()).toBe(expectedTime.toAbsoluteString());
        });
    });
});
