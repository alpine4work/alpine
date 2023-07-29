/**
 * The status that is displayed to users in the task checkbox circle is
 * different from our `TaskStatus` and is influenced by multiple factors.
 *
 * Namely, we display tasks that are open and active as different than tasks
 * that are open and inactive.
 *
 * We may add more display statuses in the future. For example "cancelled" or
 * "waiting on approval". We should be careful when adding display statuses to
 * make sure they are useful across a variety of use cases.
 */
export type TaskDisplayStatus = "OpenInactive" | "OpenActive" | "Closed";
