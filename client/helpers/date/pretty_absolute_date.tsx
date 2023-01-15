import {useMemo} from "react";
import {Tooltip} from "~/client/design/tooltip";
import {useDateContext} from "~/client/helpers/date/date_context";

/**
 * Render a date in a human readable form.
 *
 * Renders in an absolute style like "Jan 15, 2023". As opposed to rendering in
 * a relative style like "5 days ago".
 */
export function PrettyAbsoluteDate({date}: {date: Date}) {
    const {timeZone} = useDateContext();

    const prettyDate = useMemo(() => {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            calendar: "iso8601",
            year: "numeric",
            month: "short",
            day: "numeric",
        });

        return formatter.format(date);
    }, [date, timeZone]);

    const fullDate = useMemo(() => {
        const formatter = new Intl.DateTimeFormat("en-US", {
            timeZone,
            calendar: "iso8601",
            weekday: "long",
            year: "numeric",
            month: "long",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: true,
        });

        return formatter.format(date);
    }, [date, timeZone]);

    return (
        <Tooltip content={fullDate} placement="bottom">
            <span>{prettyDate}</span>
        </Tooltip>
    );
}
