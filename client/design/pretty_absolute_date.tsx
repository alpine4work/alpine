import {useMemo} from "react";
import {OverlayPlacement} from "~/client/design/overlay.js";
import {Tooltip} from "~/client/design/tooltip.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCurrentTimeRoundedToHour} from "~/client/remix/use_current_time_rounded_to_hour.js";

/**
 * Render a date in a human readable form.
 *
 * Renders in an absolute style like "Jan 15, 2023". As opposed to rendering in
 * a relative style like "5 days ago".
 */
export function PrettyAbsoluteDate({
    date,
    shouldExcludeTime,
    shouldIncludeSeconds,
    shouldIncludeWeekday,
    tooltipPlacement,
}: {
    date: Date;
    shouldExcludeTime?: boolean;
    shouldIncludeSeconds?: boolean;
    shouldIncludeWeekday?: boolean;
    tooltipPlacement?: OverlayPlacement;
}) {
    const formatDate = usePrettyAbsoluteDateFormatter({
        shouldExcludeTime,
        shouldIncludeSeconds,
        shouldIncludeWeekday,
    });

    const formattedDate = useMemo(() => formatDate(date), [date, formatDate]);

    return (
        <Tooltip
            content={<PrettyAbsoluteDateTooltipContent date={date} />}
            placement={tooltipPlacement}
        >
            <span>{formattedDate}</span>
        </Tooltip>
    );
}

export function usePrettyAbsoluteDateFormatter({
    shouldExcludeTime,
    shouldIncludeSeconds,
    shouldIncludeWeekday,
}: {
    shouldExcludeTime?: boolean;
    shouldIncludeSeconds?: boolean;
    shouldIncludeWeekday?: boolean;
} = {}) {
    const {timeZone, locale} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();

    return useMemo(() => {
        const baseOptions: Intl.DateTimeFormatOptions = {
            timeZone,
            calendar: "iso8601",
            day: "numeric",
            weekday: shouldIncludeWeekday ? "short" : undefined,
            hour: !shouldExcludeTime ? "numeric" : undefined,
            minute: !shouldExcludeTime ? "2-digit" : undefined,
            second: shouldIncludeSeconds ? "2-digit" : undefined,
            hour12: true,
        };

        const formatterWithoutYear = new Intl.DateTimeFormat(locale, {
            ...baseOptions,
            month: "short",
        });

        const formatterWithYear = new Intl.DateTimeFormat(locale, {
            ...baseOptions,
            year: "numeric",
            // If we include a short weekday, always use short months as well.
            month: !shouldIncludeWeekday ? "long" : "short",
        });

        return (date: Date) => {
            const isCurrentYear = currentTime.getFullYear() === date.getFullYear();

            const formatter = isCurrentYear ? formatterWithoutYear : formatterWithYear;

            return formatter
                .format(date)
                .replace(/, (\d+:\d+)/, " at $1")
                .replaceAll(/\s*(AM|PM)/g, string => string.trim().toLowerCase());
        };
    }, [
        currentTime,
        locale,
        shouldExcludeTime,
        shouldIncludeSeconds,
        shouldIncludeWeekday,
        timeZone,
    ]);
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
