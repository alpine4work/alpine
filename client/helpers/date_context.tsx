import Cookies from "js-cookie";
import {ReactNode, createContext, useContext, useEffect, useMemo, useState} from "react";
import {InternalError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {TimeZone, defaultTimeZone, isTimeZone} from "~/shared/helpers/date/time_zone";

type DateContext = {
    timeZone: TimeZone;
};

const DateContext = createContext<DateContext | null>(null);

const testDateContext: DateContext = {
    timeZone: defaultTimeZone,
};

/**
 * We include some information about time in React context to make sure
 * wherever we render dates they all appear consistent.
 *
 * Like the time zone and a date to render relative date strings (e.g.
 * "30min ago") against.
 */
export function useDateContext(): DateContext {
    const dateContext = useContext(DateContext);

    if (dateContext === null) {
        // In Jest tests use a dummy date context instead of requiring a root
        // context provider.
        if (typeof jest !== "undefined") {
            return testDateContext;
        }

        throw new InternalError("Expected component to be rendered inside a <DateContextProvider>");
    }

    return dateContext;
}

export function DateContextProvider({
    initialTimeZone,
    children,
}: {
    initialTimeZone: TimeZone;
    children: ReactNode;
}) {
    const [timeZone, setTimeZone] = useState(initialTimeZone);

    useEffect(() => {
        const actualTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        assert(isTimeZone(actualTimeZone));

        setTimeZone(actualTimeZone);

        // Update the time zone cookie to the client's actual time zone. Now in the
        // future server-side renders will have the right time zone.
        const cookieTimeZone = Cookies.get("time-zone");
        if (cookieTimeZone !== actualTimeZone) {
            Cookies.set("time-zone", actualTimeZone, {expires: 365});
        }
    }, []);

    const dateContext: DateContext = useMemo(() => ({timeZone}), [timeZone]);

    return <DateContext.Provider value={dateContext}>{children}</DateContext.Provider>;
}
