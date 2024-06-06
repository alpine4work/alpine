import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {roundToNearestMinutes} from "date-fns";
import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {InternalError} from "~/shared/error/error.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/date/time_zone.js";

/**
 * Round the provided date to the start of the current hour.
 */
export function roundDateToHour(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), 0, 0, 0);
}

const CurrentDateContext = createContext<CalendarDate | null>(null);
const CurrentTimeRoundedToHour = createContext<Date | null>(null);
const CurrentTimeRoundedToNearestTenMinutes = createContext<Date | null>(null);

const currentTimeRoundedToNearestTenMinutesForTest = import.meta.jest
    ? roundToNearestMinutes(new Date(), {
          nearestTo: 10,
          roundingMethod: "ceil",
      })
    : null;
const currentTimeRoundedToHourForTest = import.meta.jest
    ? roundDateToHour(currentTimeRoundedToNearestTenMinutesForTest!)
    : null;
const currentDateForTest = import.meta.jest
    ? toCalendarDate(parseAbsolute(currentTimeRoundedToHourForTest!.toISOString(), defaultTimeZone))
    : null;

/**
 * Return the current time rounded to 10 minutes. This hook will update and re
 * render the component every 10 minutes.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToNearestTenMinutes(): Date {
    const currentTimeRoundedToNearestTenMinutes = useContext(CurrentTimeRoundedToNearestTenMinutes);

    if (currentTimeRoundedToNearestTenMinutes === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return assertExists(currentTimeRoundedToNearestTenMinutesForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return currentTimeRoundedToNearestTenMinutes;
}

/**
 * Return the current time rounded to the start of the current hour. This hook
 * will update and re-render the component every hour.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToHour(): Date {
    const currentTimeRoundedToHour = useContext(CurrentTimeRoundedToHour);

    if (currentTimeRoundedToHour === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return assertExists(currentTimeRoundedToHourForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return currentTimeRoundedToHour;
}

/**
 * Return the current date. This hook will update and re-render when the
 * day changes.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentDate(): CalendarDate {
    const currentDate = useContext(CurrentDateContext);

    if (currentDate === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (import.meta.jest) {
            return assertExists(currentDateForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return currentDate;
}

/**
 * Get the current time rounded to the nearest hour using a server context
 * (with `LoaderContextModule`). Returns the same value as
 * `useCurrentTimeRoundedToHour()`.
 */
export function getCurrentTimeRoundedToHour(context: {loader: {getInitialTime: () => Date}}) {
    return roundDateToHour(context.loader.getInitialTime()).toISOString();
}

/**
 * Get the current date using a server context (with `LoaderContextModule`).
 * Returns the same value as `useCurrentDate()`.
 */
export function getCurrentDate(context: {
    loader: {getInitialTime: () => Date; getClientInfo: () => {timeZone: TimeZone}};
}) {
    return toCalendarDate(
        parseAbsolute(
            getCurrentTimeRoundedToHour(context),
            context.loader.getClientInfo().timeZone,
        ),
    );
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
        const currentTimeRoundedToNearestTenMinutes = roundToNearestMinutes(initialTime, {
            nearestTo: 10,
            roundingMethod: "ceil",
        });

        const currentDate = toCalendarDate(
            parseAbsolute(currentTimeRoundedToHour.toISOString(), timeZone),
        );

        return {currentTimeRoundedToHour, currentTimeRoundedToNearestTenMinutes, currentDate};
    });

    useEffect(() => {
        let timeout: Timeout;

        const update = () => {
            const currentTime = new Date();
            const currentTimeRoundedToHour = roundDateToHour(currentTime);
            const currentTimeRoundedToNearestTenMinutes = roundToNearestMinutes(currentTime, {
                nearestTo: 10,
                roundingMethod: "ceil",
            });

            setState(previousState => {
                if (
                    currentTimeRoundedToHour.toISOString() ===
                        previousState.currentTimeRoundedToHour.toISOString() &&
                    currentTimeRoundedToNearestTenMinutes.toISOString() ===
                        previousState.currentTimeRoundedToNearestTenMinutes.toISOString()
                ) {
                    return previousState;
                }

                return {
                    currentTimeRoundedToHour,
                    currentTimeRoundedToNearestTenMinutes,
                    currentDate: toCalendarDate(
                        parseAbsolute(currentTimeRoundedToHour.toISOString(), timeZone),
                    ),
                };
            });

            const nextTimeRoundedToNearestTenMinutes = new Date(
                currentTimeRoundedToNearestTenMinutes.getTime() + 1000 * 60 * 10,
            );

            timeout = createTimeout(
                update,
                nextTimeRoundedToNearestTenMinutes.getTime() - Date.now(),
            );
        };

        update();

        return () => {
            timeout.clear();
        };
    }, [initialTime, timeZone]);

    return (
        <CurrentDateContext.Provider value={state.currentDate}>
            <CurrentTimeRoundedToHour.Provider value={state.currentTimeRoundedToHour}>
                <CurrentTimeRoundedToNearestTenMinutes.Provider
                    value={state.currentTimeRoundedToNearestTenMinutes}
                >
                    {children}
                </CurrentTimeRoundedToNearestTenMinutes.Provider>
            </CurrentTimeRoundedToHour.Provider>
        </CurrentDateContext.Provider>
    );
}
