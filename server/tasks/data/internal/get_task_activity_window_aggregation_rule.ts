// Windows behave like a debounce with a maximum wait: the entry appears on the
// first update (leading edge), stays open while updates keep arriving within the
// idle time, and closes at the hard duration cap even if updates continue.
export type TaskActivityWindowAggregationRule = {
    /** Idle time after which another update starts a new window. */
    readonly idleDebounceMs: number;
    /** Maximum duration of a window, even while updates continue. */
    readonly maxDurationMs: number;
};

/**
 * Task note updates are aggregated into windows for 10 minutes after the last
 * update, with a maximum duration of 1 hour. The idle time and maximum duration
 * are relatively long to reflect the fact that task notes are closer to documents.
 * Users may make edits to the notes while going back and forth between task
 * description and other work. We'll "keep the window alive" for 10 minutes after
 * each edit.
 *
 * These numbers are arbitrary and should be adjusted if needed.
 */
const taskActivityNotesWindowAggregationRule: TaskActivityWindowAggregationRule = {
    idleDebounceMs: 10 * 60 * 1000, // 10 minutes
    maxDurationMs: 60 * 60 * 1000, // 1 hour
};

/**
 * Task title updates are aggregated into windows for 2 minutes after the last
 * update, with a maximum duration of 15 minutes. The idle time and maximum
 * duration are relatively short to reflect the fact that task titles are more
 * likely to be updated in a single sitting.
 *
 * These numbers are arbitrary and should be adjusted if needed.
 */
const taskActivityTitleWindowAggregationRule: TaskActivityWindowAggregationRule = {
    idleDebounceMs: 2 * 60 * 1000, // 2 minutes
    maxDurationMs: 15 * 60 * 1000, // 15 minutes
};

export function getTaskActivityWindowAggregationRule(
    contentField: "Title" | "Notes",
): TaskActivityWindowAggregationRule {
    return contentField === "Title"
        ? taskActivityTitleWindowAggregationRule
        : taskActivityNotesWindowAggregationRule;
}
