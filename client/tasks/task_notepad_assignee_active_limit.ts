/**
 * The minimum number of tasks we expect in our `assigneeActiveQuery`. If the
 * task count dips below this number we'll load more tasks.
 */
export const taskNotepadAssigneeActiveMinLimit = 25;

/**
 * When loading more tasks in `assigneeActiveQuery` we use this limit. It
 * includes more tasks than the min limit so we have some buffer room so in
 * case active tasks are removed we don't immediately need to load more tasks.
 */
export const taskNotepadAssigneeActiveLoadLimit = taskNotepadAssigneeActiveMinLimit + 10;
