import {useMemo} from "react";
import {OverlayPlacement} from "~/client/design/overlay";
import {Tooltip} from "~/client/design/tooltip";
import {useCurrentTimeRoundedToHour} from "~/client/helpers/use_current_time_rounded_to_hour";
import {useClientInfo} from "~/client/remix/client_info_context";

/**
 * Render a date in a human readable form.
 *
 * Renders in an absolute style like "Jan 15, 2023". As opposed to rendering in
 * a relative style like "5 days ago".
 */
export function PrettyAbsoluteDate({date, placement}: {date: Date; placement?: OverlayPlacement}) {
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    const formattedDate = useMemo(() => {
        const isCurrentYear = currentTime.getFullYear() === date.getFullYear();

        const formatter = new Intl.DateTimeFormat(locale, {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: !isCurrentYear ? "long" : "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });

        return formatter
            .format(date)
            .replace(/, (\d+:\d+)/, " at $1")
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
    }, [currentTime, date, locale, timeZone]);

    return (
        <Tooltip content={<PrettyAbsoluteDateTooltipContent date={date} />} placement={placement}>
            <span>{formattedDate}</span>
        </Tooltip>
    );
}

/**
 * The tooltip content of a `<PrettyAbsoluteDate>`.
 */
export function PrettyAbsoluteDateTooltipContent({date}: {date: Date}) {
    const {timeZone, locale} = useClientInfo();

    const formattedDate = useMemo(() => {
        const formatter = new Intl.DateTimeFormat(locale, {
            timeZone,
            calendar: "iso8601",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
            hour12: true,
        });

        return formatter
            .format(date)
            .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
    }, [date, locale, timeZone]);

    return <>{formattedDate}</>;
}
