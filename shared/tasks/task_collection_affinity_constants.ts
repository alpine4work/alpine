// Affinity points we assign to various actions. These point values will
// definitely need to be tweaked over time.
//
// TODO(calebmer): I wonder if we should add a "mobile multiplier" to some of
// these actions. Since all of these actions are harder to do on mobile that
// must mean it's worth more to the user?

/**
 * When a user adds a task to a collection we grant them this many
 * affinity points.
 */
export const addTaskToCollectionAffinityPoints = 0.2;

/**
 * When the user creates a collection we grant them this many affinity points.
 */
export const createTaskCollectionAffinityPoints = 2;

/**
 * For every 5min the user spends viewing a collection we grant them this many
 * affinity points.
 */
export const taskCollectionAffinityPointsPer5MinOfViewingTime = 1;
