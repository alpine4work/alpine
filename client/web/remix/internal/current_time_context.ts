import {CalendarDate} from "@internationalized/date";
import {createContext} from "react";

export const CurrentDateContext = createContext<CalendarDate | null>(null);
export const CurrentTimeRoundedToHour = createContext<Date | null>(null);
export const CurrentTimeRoundedToNearestTenMinutes = createContext<Date | null>(null);
