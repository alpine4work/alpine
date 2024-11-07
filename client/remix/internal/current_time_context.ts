import {CalendarDate} from "@internationalized/date";
import {createContext} from "react";

export const CurrentDateContext = createContext<CalendarDate | null>(null);
export const CurrentTimeRoundedToHour = createContext<Date | null>(null);
export const CurrentTimeRoundedToNearestTenMinutes = createContext<Date | null>(null);

/**
 * Round the provided date to the start of the current hour.
 */
export function roundDateToHour(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), 0, 0, 0);
}
