import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {InternalError} from "~/shared/error/error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {defaultTimeZone} from "~/shared/helpers/date/time_zone.js";

/**
 * Round the provided date to the start of the current hour.
 */
export function roundDateToHour(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), 0, 0, 0);
}

const CurrentTimeContext = createContext<{
    readonly currentTimeRoundedToHour: Date;
    readonly currentDate: CalendarDate;
} | null>(null);

const currentTimeForTest = import.meta.jest ? roundDateToHour(new Date()) : null;
const currentDateForTest = import.meta.jest
    ? toCalendarDate(parseAbsolute(currentTimeForTest!.toISOString(), defaultTimeZone))
    : null;

/**
 * Return the current time rounded to the start of the current hour. This hook
 * will update and re-render the component every hour.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToHour(): Date {
    const context = useContext(CurrentTimeContext);

    if (context === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return assertExists(currentTimeForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return context.currentTimeRoundedToHour;
}

/**
 * Return the current date. This hook will update and re-render when the
 * day changes.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentDate(): CalendarDate {
    const context = useContext(CurrentTimeContext);

    if (context === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return assertExists(currentDateForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return context.currentDate;
}

export function CurrentTimeContextProvider({
    initialTime,
    children,
}: {
    initialTime: Date;
    children?: ReactNode;
}) {
    const {timeZone} = useClientInfo();

    const [state, setState] = useState(() => {
        const currentTimeRoundedToHour = roundDateToHour(initialTime);
        const currentDate = toCalendarDate(
            parseAbsolute(currentTimeRoundedToHour.toISOString(), timeZone),
        );
        return {currentTimeRoundedToHour, currentDate};
    });

    useEffect(() => {
        let timeout: Timeout;

        const update = () => {
            const currentTimeRoundedToHour = roundDateToHour(new Date());

            setState(previousState => {
                if (
                    currentTimeRoundedToHour.toISOString() ===
                    previousState.currentTimeRoundedToHour.toISOString()
                ) {
                    return previousState;
                }
                return {
                    currentTimeRoundedToHour,
                    currentDate: toCalendarDate(
                        parseAbsolute(currentTimeRoundedToHour.toISOString(), timeZone),
                    ),
                };
            });

            let nextTimeRoundedToHour = new Date(currentTimeRoundedToHour.getTime());
            nextTimeRoundedToHour.setHours(nextTimeRoundedToHour.getHours() + 1);
            nextTimeRoundedToHour = roundDateToHour(nextTimeRoundedToHour);

            timeout = createTimeout(update, nextTimeRoundedToHour.getTime() - Date.now());
        };

        update();

        return () => {
            timeout.clear();
        };
    }, [initialTime, timeZone]);

    return <CurrentTimeContext.Provider value={state}>{children}</CurrentTimeContext.Provider>;
}
