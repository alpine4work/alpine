import {formatPrettyRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_relative_date_without_full_time_tooltip.js";
import {assertTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

test("formats date differences correctly", () => {
    const utcTimeZone = assertTimeZone("UTC");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-30T14:49:53.233Z"),
            "Days",
        ),
    ).toEqual("today");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-30T12:49:53.233Z"),
            "Days",
        ),
    ).toEqual("today");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-30T00:00:00.000Z"),
            "Days",
        ),
    ).toEqual("today");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-29T23:59:59.999Z"),
            "Days",
        ),
    ).toEqual("yesterday");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-29T16:49:53.233Z"),
            "Days",
        ),
    ).toEqual("yesterday");

    expect(
        formatPrettyRelativeDateWithoutFullTimeTooltip(
            utcTimeZone,
            new Date("2024-04-30T14:49:53.233Z"),
            new Date("2024-04-29T14:49:53.233Z"),
            "Days",
        ),
    ).toEqual("yesterday");
});
