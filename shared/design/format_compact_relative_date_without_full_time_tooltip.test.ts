import {addDays, addHours, addMinutes, addSeconds} from "date-fns";
import {formatCompactRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_compact_relative_date_without_full_time_tooltip.js";

const currentTime = new Date("2026-07-27T12:00:00.000Z");

test("formats elapsed time at every compact granularity", () => {
    const format = (time: Date) =>
        formatCompactRelativeDateWithoutFullTimeTooltip(currentTime, time);

    expect({
        future: format(addMinutes(currentTime, 5)),
        justNow: format(addSeconds(currentTime, -30)),
        minutes: format(addMinutes(currentTime, -5)),
        hours: format(addHours(currentTime, -23)),
        days: format(addDays(currentTime, -2)),
        weeks: format(addDays(currentTime, -20)),
        months: format(addDays(currentTime, -40)),
        // 360-364 days is the seam between the units: it must render as months ("11mo"),
        // never as "12mo" or "0y".
        monthsNearYear: format(addDays(currentTime, -360)),
        oneYear: format(addDays(currentTime, -365)),
        years: format(addDays(currentTime, -800)),
    }).toEqual({
        future: "now",
        justNow: "now",
        minutes: "5m",
        hours: "23h",
        days: "2d",
        weeks: "2w",
        months: "1mo",
        monthsNearYear: "11mo",
        oneYear: "1y",
        years: "2y",
    });
});
