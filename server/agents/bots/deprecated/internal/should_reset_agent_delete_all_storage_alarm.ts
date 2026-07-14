import {subHours} from "date-fns";

/**
 * Delete the agent's storage after 6 hours of inactivity. So the agent resets
 * overnight.
 */
export const agentDeleteAllStorageAlarmHours = 6;

/**
 * Reset the agent's alarm every day there's some activity.
 */
export function shouldResetAgentDeleteAllStorageAlarm({
    currentTime,
    alarmTime,
}: {
    currentTime: Date;
    alarmTime: Date;
}) {
    return currentTime > subHours(alarmTime, agentDeleteAllStorageAlarmHours - 1);
}
