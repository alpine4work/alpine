import {useMemo} from "react";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {getIntlDateTimeFormat} from "~/shared/helpers/intl/get_intl_date_time_format.js";

/**
 * Render a date in a human readable form.
 *
 * Renders in an absolute style like "Jan 15, 2023". As opposed to rendering in a
 * relative style like "5 days ago".
 */
export function PrettyAbsoluteDate({
    date,
    withoutDay,
    withoutTime,
    withSeconds,
    withWeekday,
    tooltipPlacement,
}: {
    date: Date;
    withoutDay?: boolean;
    withoutTime?: boolean;
    withSeconds?: boolean;
    withWeekday?: boolean;
    tooltipPlacement?: OverlayPlacement;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();

    const formattedDate = useMemo(
        () =>
            formatPrettyAbsoluteDateWithoutFullTimeTooltip(locale, timeZone, currentDate, date, {
                withoutDay,
                withoutTime,
                withSeconds,
                withWeekday,
            }),
        [locale, timeZone, currentDate, date, withoutDay, withoutTime, withSeconds, withWeekday],
    );

    return (
        <Tooltip
            content={<PrettyAbsoluteDateTooltipContent date={date} />}
            placement={tooltipPlacement}
        >
            <span>{formattedDate}</span>
        </Tooltip>
    );
}

/**
 * The tooltip content of a `<PrettyAbsoluteDate>`.
 */
export function PrettyAbsoluteDateTooltipContent({
    date,
    withoutWeekday = false,
}: {
    date: Date;
    withoutWeekday?: boolean;
}) {
    const {timeZone, locale} = useClientInfo();

    const formattedDate = useMemo(() => {
        const formatter = getIntlDateTimeFormat({
            locale,
            timeZone,
            weekday: !withoutWeekday ? "long" : undefined,
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
        });

        return formatter
            .format(date)
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
    }, [date, locale, timeZone, withoutWeekday]);

    return <>{formattedDate}</>;
}
