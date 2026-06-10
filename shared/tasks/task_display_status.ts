import {createEnumIntegerMapping} from "~/shared/helpers/string/create_enum_integer_mapping.js";

/**
 * The status that is displayed to users in the task checkbox circle is different
 * from our `TaskStatus` and is influenced by multiple factors.
 *
 * Namely, we display tasks that are open and active as different than tasks that
 * are open and inactive.
 *
 * We may add more display statuses in the future. For example "cancelled" or
 * "waiting on approval". We should be careful when adding display statuses to make
 * sure they are useful across a variety of use cases.
 */
export type TaskDisplayStatus = "OpenInactive" | "OpenActive" | "Closed";

// Leave room between enum values for more enum values to be inserted in the
// future. We may add other display statuses in the future like "expired" or
// "waiting on approval". If we do we don't yet know how we'll want these states to
// be ordered. So to start we take the max value for our field type (`byte` which
// has a max of 127), divide by 4 so we can distribute our statuses with room at
// all positions to add new statuses.
export const TaskDisplayStatusIntegerMapping = createEnumIntegerMapping({
    OpenInactive: 32,
    OpenActive: 64,
    Closed: 96,
});
