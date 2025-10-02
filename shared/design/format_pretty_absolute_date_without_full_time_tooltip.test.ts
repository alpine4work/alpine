import {CalendarDate} from "@internationalized/date";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.js";

describe("formatPrettyAbsoluteDateWithoutFullTimeTooltip(), default locale(en-US)", () => {
    const utcTimeZone = assertTimeZone("UTC");
    const enUsLocale = defaultLocale;
    const currentDate = new CalendarDate(2025, 8, 15);
    const testDate = new Date("2025-08-21T14:30:45.123Z");

    const testCases = [
        {
            description: "formats with default options",
            date: testDate,
            options: {},
            expected: "Aug 21st at 2:30pm",
        },
        {
            description: "formats with withoutDay option",
            date: testDate,
            options: {withoutDay: true},
            expected: "2:30pm",
        },
        {
            description: "formats with withSeconds option",
            date: testDate,
            options: {withSeconds: true},
            expected: "Aug 21st at 2:30:45pm",
        },
        {
            description: "formats with withWeekday option",
            date: testDate,
            options: {withWeekday: true},
            expected: "Thu, Aug 21st at 2:30pm",
        },
        {
            description: "formats with withLongMonth option",
            date: testDate,
            options: {withLongMonth: true},
            expected: "August 21st at 2:30pm",
        },
        {
            description: "formats with withLongWeekday option",
            date: testDate,
            options: {withLongWeekday: true},
            expected: "Thursday, Aug 21st at 2:30pm",
        },
        {
            description: "formats with withoutTime option",
            date: testDate,
            options: {withoutTime: true},
            expected: "Aug 21st",
        },
        {
            description: "formats with short weekday and long month",
            date: testDate,
            options: {withWeekday: true, withLongMonth: true},
            expected: "Thu, August 21st at 2:30pm",
        },
        {
            description: "formats with long weekday and long month and without time",
            date: testDate,
            options: {withLongWeekday: true, withLongMonth: true, withoutTime: true},
            expected: "Thursday, August 21st",
        },
        {
            description: "false options formats the same as default options",
            date: testDate,
            options: {withLongMonth: false, withLongWeekday: false, withoutTime: false},
            expected: "Aug 21st at 2:30pm",
        },
    ];

    testCases.forEach(({description, date, options, expected}) => {
        test(`${description}`, () => {
            const result = formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                enUsLocale,
                utcTimeZone,
                currentDate,
                date,
                options,
            );
            expect(result).toBe(expected);
        });
    });
});
