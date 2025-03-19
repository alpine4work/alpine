/**
 * Round the provided date to the start of the current hour.
 */
export function roundDateToHour(time: Date): Date {
    return new Date(time.getFullYear(), time.getMonth(), time.getDate(), time.getHours(), 0, 0, 0);
}
