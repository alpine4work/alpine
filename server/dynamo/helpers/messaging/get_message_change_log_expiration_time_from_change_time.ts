import {addDays} from "date-fns";

/**
 * Get the expiration time for a message change log entry base don the change
 * time for that change log entry.
 */
export function getMessageChangeLogExpirationTimeFromChangeTime(changeTime: Date): Date {
    return addDays(changeTime, 7);
}
