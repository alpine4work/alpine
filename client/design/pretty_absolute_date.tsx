import {useMemo} from "react";
import {Tooltip} from "~/client/design/tooltip";
import {useClientInfo} from "~/client/remix/client_info_context";

/**
 * Render a date in a human readable form.
 *
 * Renders in an absolute style like "Jan 15, 2023". As opposed to rendering in
 * a relative style like "5 days ago".
 */
export function PrettyAbsoluteDate({date}: {date: Date}) {
    const {timeZone} = useClientInfo();

    const formattedDate = useMemo(() => {
        const isCurrentYear = new Date().getFullYear() === date.getFullYear();

        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            calendar: "iso8601",
            year: !isCurrentYear ? "numeric" : undefined,
            month: "short",
            day: "numeric",
        });

        return formatter.format(date);
    }, [date, timeZone]);

    return (
        <Tooltip content={<PrettyAbsoluteDateTooltipContent date={date} />} placement="bottom">
            <span>{formattedDate}</span>
        </Tooltip>
    );
}

/**
 * The tooltip content of a `<PrettyAbsoluteDate>`.
 */
export function PrettyAbsoluteDateTooltipContent({date}: {date: Date}) {
    const {timeZone} = useClientInfo();

    const formattedDate = useMemo(() => {
        const formatter = new Intl.DateTimeFormat("en-US", {
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

        return formatter.format(date);
    }, [date, timeZone]);

    return <>{formattedDate}</>;
}
