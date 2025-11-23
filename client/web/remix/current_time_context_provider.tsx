import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {roundToNearestMinutes} from "date-fns/roundToNearestMinutes";
import {ReactNode, useEffect, useState} from "react";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    CurrentDateContext,
    CurrentTimeRoundedToHour,
    CurrentTimeRoundedToNearestTenMinutes,
} from "~/client/web/remix/internal/current_time_context.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {roundDateToHour} from "~/shared/helpers/date/round_date_to_hour.js";

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
