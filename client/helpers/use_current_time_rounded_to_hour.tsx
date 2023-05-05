import {ReactNode, createContext, useContext, useEffect, useState} from "react";
import {InternalError} from "~/shared/error/error";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";

/**
 * Round the provided date to the start of the current hour.
 */
export function roundDateToHour(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), 0, 0, 0);
}

const CurrentTimeContext = createContext<Date | null>(null);

const currentTimeForTest = typeof jest !== "undefined" ? roundDateToHour(new Date()) : null;

/**
 * Return the current time rounded to the start of the current hour. This hook
 * will update and re-render the component every hour.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToHour() {
    const currentTime = useContext(CurrentTimeContext);

    if (currentTime === null) {
        // In Jest tests use a dummy value instead of requiring a root
        // context provider.
        if (typeof jest !== "undefined") {
            return assertExists(currentTimeForTest);
        }

        throw new InternalError(
            "Expected component to be rendered inside a `<CurrentTimeContextProvider>`",
        );
    }

    return currentTime;
}

export function CurrentTimeContextProvider({
    initialTime,
    children,
}: {
    initialTime: Date;
    children?: ReactNode;
}) {
    const [currentTimeRoundedToHour, setCurrentTimeRoundedToHour] = useState(() =>
        roundDateToHour(initialTime),
    );

    useEffect(() => {
        let timeout: Timeout;

        const schedule = () => {
            const currentTime = new Date();

            let nextHourTime = new Date();
            nextHourTime.setHours(nextHourTime.getHours() + 1);
            nextHourTime = roundDateToHour(nextHourTime);

            // Add 5s in case `setTimeout()` runs a little early.
            const msToNextHour = nextHourTime.getTime() - currentTime.getTime() + 5 * 1000;

            timeout = createTimeout(() => {
                setCurrentTimeRoundedToHour(roundDateToHour(new Date()));

                // Schedule a timeout for an hour from now...
                schedule();
            }, msToNextHour);
        };

        schedule();

        return () => {
            timeout.clear();
        };
    }, []);

    return (
        <CurrentTimeContext.Provider value={currentTimeRoundedToHour}>
            {children}
        </CurrentTimeContext.Provider>
    );
}
