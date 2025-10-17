import {fromDate, parseDateTime, toZoned} from "@internationalized/date";
import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import * as EmailContextModule from "~/server/emails/noop_email_context_module.js";
import {permissionDeniedBotError} from "~/server/helpers/permission_denied_bot_error.js";
import {isScheduleDateTime} from "~/server/notifications/core/schedule_date_time.js";
import {
    InboxTable,
    internalInitialInboxGeneration,
} from "~/server/notifications/data/internal/notifications_realtime_table.js";
import {
    archiveInboxEntry,
    processNotificationEvent,
} from "~/server/notifications/data/notifications_actions.js";
import {
    computeDigestNotificationsNextScheduledDateTime,
    getNotificationDigestContent,
    isInboxEligibleForDigestNotification,
    sendNotificationDigestForInbox,
    sendScheduledDigestsForTime,
} from "~/server/notifications/data/notifications_actions_digest.js";
import {createNotificationsScenario} from "~/server/notifications/data/test_helpers/notifications_table_test_helpers.js";
import {generateEmailAddressForTest} from "~/server/spaces/test_helpers/generate_email_address_for_test.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {parseAccountNameAssumingWesternNameOrder} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {DigestNotificationsSchedule} from "~/shared/notifications/notifications_schedule_schema.js";

const sendNotificationDigestMock = import.meta.jest.fn();

const context = createTestContext({
    processJob: async (context, job, jobStartTime, span) => {
        if (job.type === "NotificationEvent") {
            await processNotificationEvent(context, job.event, span);
        }
        if (job.type === "SendNotificationDigest") {
            sendNotificationDigestMock();
        }
    },
});

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

    test("should return false when lastEntryUpdatedTime null", async () => {
        const result = await isInboxEligibleForDigestNotification(context.systemAction(spaceId), {
            entryCount: 1,
            digestNotificationsOptedOutTime: null,
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-05T00:00:00Z"),
            lastEntryUpdatedTime: null,
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

describe("sendNotificationDigestForInbox", () => {
    beforeEach(async () => {
        import.meta.jest.clearAllMocks();
    });

    test("should send email when all conditions are met", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).toHaveBeenCalledTimes(1);
    });

    test("should not send email when digestNotificationsLastSentTime is after sendTime", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        await ProcessContextModule.waitForTestTasks();

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-16T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should not send email when digestNotificationsOptedOutTime is set", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: new Date("2024-01-01T12:00:00Z"),
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should not send email when digestNotificationsSchedule is empty", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set([]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should not send email when sendTime does not match expected scheduled digest time", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should not send email when account is not a member of the space", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        await space.removeAccount(session.account);

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should update inbox item even when not sending email", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: new Date("2024-01-01T12:00:00Z"),
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        const updatedItem = await InboxTable.getItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
        });

        expect(sendMock).not.toHaveBeenCalled();
        expect(updatedItem.digestNotificationsLastSentTime).toEqual(sendTime);
    });

    test("should set digestNotificationsNextScheduledDateTime to null when updating inbox item", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: new Date("2024-01-01T12:00:00Z"),
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
            accountId: session.account.id,
            spaceId: space.id,
        });

        const updatedItem = await InboxTable.getItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
        });
        expect(updatedItem.digestNotificationsNextScheduledDateTime).toBeNull();
    });

    test("should throw when account is a bot", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);
        const sendTime = new Date("2024-01-15T13:00:00Z");

        await expect(
            sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
                accountId: bot.id,
                spaceId: space.id,
            }),
        ).rejects.toThrow(permissionDeniedBotError());
    });

    test("should throw when system actor is not a member of the space", async () => {
        const space = await TestSpace.create(context);
        const space2 = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:00Z"); // 08:00 EST
        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        await expect(
            sendNotificationDigestForInbox(context.systemAction(space2.id), sendTime, {
                accountId: session.account.id,
                spaceId: space.id,
            }),
        ).rejects.toThrow();
    });
});

describe("getNotificationDigestContent", () => {
    test("should get inbox entries", async () => {
        const scenario = await createNotificationsScenario(context);

        const chat = await TestChat.get(scenario.session1, scenario.session2, scenario.session3);
        await chat.sendMessage(scenario.session2, "message1");

        await ProcessContextModule.waitForTestTasks();

        const content = await getNotificationDigestContent(
            context.systemAction(scenario.space.id),
            {
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
            },
        );
        const expectedContent = {
            digestEntries: [
                {
                    brandIconType: "Chat",
                    firstAccount: {
                        avatar: null,
                        botId: undefined,
                        id: scenario.session3.account.id,
                        name: scenario.session3.account.initialName,
                        nameVersion: 0,
                        space: {
                            addedTime: expect.any(Date),
                            role: "Member",
                            state: {type: "Active"},
                            version: 1,
                        },
                        version: 0,
                        reactionCharacter: expect.any(Object),
                    },
                    loudNotificationCount: 1,
                    preview: "Test: message1",
                    secondAccount: {
                        avatar: null,
                        botId: undefined,
                        id: scenario.session2.account.id,
                        name: scenario.session2.account.initialName,

                        nameVersion: 0,
                        space: {
                            addedTime: expect.any(Date),
                            role: "Member",
                            state: {type: "Active"},
                            version: 1,
                        },
                        version: 0,
                        reactionCharacter: expect.any(Object),
                    },
                    summary: [
                        {
                            name: parseAccountNameAssumingWesternNameOrder(
                                scenario.session3.account.initialName,
                            ).givenName,
                            type: "Account",
                        },
                        " sent you",
                        " and ",
                        {
                            name: parseAccountNameAssumingWesternNameOrder(
                                scenario.session2.account.initialName,
                            ).givenName,
                            type: "Account",
                        },
                        " a message",
                    ],
                    time: expect.any(Date),
                    url: expect.any(URL),
                },
            ],
            inboxUrl: new URL(`/s/${scenario.space.id}/inbox`, context.constants.edgeServiceUrl),
            remainingEntryCount: 0,
        };
        expect(content).toEqual(expectedContent);
    });

    test("should skip archived inbox entries", async () => {
        const scenario = await createNotificationsScenario(context);
        const chat = await TestChat.get(scenario.session1, scenario.session2);
        await chat.sendMessage(scenario.session2, "message1");

        await ProcessContextModule.waitForTestTasks();

        await archiveInboxEntry(
            context.action(scenario.session1).clone({apns: new TestApnsContextModule()}),
            {
                spaceId: scenario.space.id,
                key: {type: "Chat", chatId: chat.id},
            },
        );

        const content = await getNotificationDigestContent(
            context.systemAction(scenario.space.id),
            {
                spaceId: scenario.space.id,
                accountId: scenario.session1.account.id,
            },
        );

        const expectedContent = {
            digestEntries: [],
            inboxUrl: new URL(`/s/${scenario.space.id}/inbox`, context.constants.edgeServiceUrl),
            remainingEntryCount: 0,
        };
        expect(content).toEqual(expectedContent);
    });

    test("should throw if bot account", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        const bot = await TestBot.createAndInstantiate(session);

        await expect(
            getNotificationDigestContent(context.systemAction(space.id), {
                spaceId: space.id,
                accountId: bot.id,
            }),
        ).rejects.toThrow(permissionDeniedBotError());
    });

    test("should throw if account is not a member of the space", async () => {
        const space = await TestSpace.create(context);
        const account = await TestAccount.create(context);

        await expect(
            getNotificationDigestContent(context.systemAction(space.id), {
                spaceId: space.id,
                accountId: account.id,
            }),
        ).rejects.toThrow();
    });
});

describe("sendScheduledDigestsForTime", () => {
    beforeEach(() => {
        sendNotificationDigestMock.mockReset();
    });

    afterEach(async () => {
        await context.resetDynamoLocal();
    });
    test("should send digests for the given digestTime that is already rounded to the nearest hour", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: 1,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2025-10-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: null,
            digestNotificationsNextScheduledDateTime: new Date("2025-10-15T21:00:00.000Z") as any,
        });
        const sendTime = new Date("2025-10-15T20:15:00.000Z");
        await sendScheduledDigestsForTime(context.unknownAnonymousAction(), sendTime);
        expect(sendNotificationDigestMock).toHaveBeenCalled();
    });

    test("should send digests for a digestTime with non-zero seconds or milliseconds", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: 1,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2025-10-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: null,
            digestNotificationsNextScheduledDateTime: new Date("2025-10-15T21:00:00.000Z") as any,
        });
        const sendTime = new Date("2025-10-15T20:01:02.123Z");
        await sendScheduledDigestsForTime(context.unknownAnonymousAction(), sendTime);
        expect(sendNotificationDigestMock).toHaveBeenCalled();
    });

    test("should throw if digestTime is not a valid date", async () => {
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: 1,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2025-10-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: null,
            digestNotificationsNextScheduledDateTime: new Date("2025-10-15T21:00:00.000Z") as any,
        });
        const sendTime = new Date("invalid");
        await expect(
            sendScheduledDigestsForTime(context.unknownAnonymousAction(), sendTime),
        ).rejects.toThrow();
        expect(sendNotificationDigestMock).not.toHaveBeenCalled();
    });

    test("should throw if sendTime is not a valid scheduleDateTime", async () => {
        const emailSpy = import.meta.jest.spyOn(
            EmailContextModule.NoopEmailContextModule.prototype,
            "send",
        );
        const sendMock = import.meta.jest.fn();
        emailSpy.mockImplementationOnce(sendMock);
        const space = await TestSpace.create(context);
        const session = await space.createSession({role: "Admin"});
        await session.account.createEmailAddress(generateEmailAddressForTest(session.account));

        const sendTime = new Date("2024-01-15T13:00:23Z"); // 08:00 EST

        await ProcessContextModule.waitForTestTasks();

        await InboxTable.createItem(context.action(session), {
            partitionType: "Account",
            sortRangeType: "InboxAttributes",
            spaceId: space.id,
            accountId: session.account.id,
            generation: internalInitialInboxGeneration,
            loudNotificationCount: 0,
            lastZeroEntryCountTime: null,
            digestNotificationsOptedOutTime: null,
            entryCount: 1,
            lastEntryUpdatedTime: new Date("2024-01-15T12:00:00Z"),
            digestNotificationsSchedule: new Set(["08:00", "17:00"]),
            digestNotificationsLastSentTime: new Date("2024-01-11T14:00:00Z"),
            digestNotificationsNextScheduledDateTime: sendTime as any,
        });

        expect(isScheduleDateTime(sendTime)).toBe(false);

        await expect(
            sendNotificationDigestForInbox(context.systemAction(space.id), sendTime, {
                accountId: session.account.id,
                spaceId: space.id,
            }),
        ).rejects.toThrow(InternalError);
        expect(sendMock).not.toHaveBeenCalled();
    });

    test("should do nothing if there are no scheduled digests", async () => {
        const sendTime = new Date("2025-10-15T20:00:00.000Z");
        await expect(
            sendScheduledDigestsForTime(context.unknownAnonymousAction(), sendTime),
        ).resolves.toBeUndefined();
        expect(sendNotificationDigestMock).not.toHaveBeenCalled();
    });
});
