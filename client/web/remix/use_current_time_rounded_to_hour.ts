import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {roundToNearestMinutes} from "date-fns/roundToNearestMinutes";
import {useContext} from "react";
import {
    CurrentDateContext,
    CurrentTimeRoundedToHour,
    CurrentTimeRoundedToNearestTenMinutes,
} from "~/client/web/remix/internal/current_time_context.js";
import {InternalError} from "~/shared/error/error.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {roundDateToHour} from "~/shared/helpers/date/round_date_to_hour.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";

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
 * Return the current time rounded to 10 minutes. This hook will update and
 * re-render the component every 10 minutes.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToNearestTenMinutes(): Date {
    const currentTimeRoundedToNearestTenMinutes = useContext(CurrentTimeRoundedToNearestTenMinutes);

    if (currentTimeRoundedToNearestTenMinutes === null) {
        // In Jest tests use a dummy value instead of requiring a root context provider.
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
 * Return the current time rounded to the start of the current hour. This hook will
 * update and re-render the component every hour.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentTimeRoundedToHour(): Date {
    const currentTimeRoundedToHour = useContext(CurrentTimeRoundedToHour);

    if (currentTimeRoundedToHour === null) {
        // In Jest tests use a dummy value instead of requiring a root context provider.
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
 * Return the current date. This hook will update and re-render when the day
 * changes.
 *
 * Works with server-side rendering. The initial time comes from the server.
 */
export function useCurrentDate(): CalendarDate {
    const currentDate = useContext(CurrentDateContext);

    if (currentDate === null) {
        // In Jest tests use a dummy value instead of requiring a root context provider.
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
 * Get the current time rounded to the nearest hour using a server context (with
 * `LoaderContextModule`). Returns the same value as
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
