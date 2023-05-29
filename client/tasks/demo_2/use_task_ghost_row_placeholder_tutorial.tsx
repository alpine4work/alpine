import {useState} from "react";

/**
 * The first couple times you add tasks we show a short tutorial in the
 * placeholder of the ghost row. These are the entries in that tutorial.
 */
const taskGhostRowPlaceholderTutorial = [
    "Click to add a task…",
    "Press enter to add another task…",
    "Press tab to convert into a subtask…",
    "Keep adding tasks…",
];

export function useTaskGhostRowPlaceholderTutorial(taskRowCount: number) {
    const [
        shouldShowTaskGhostRowPlaceholderTutorial,
        setShouldShowTaskGhostRowPlaceholderTutorial,
    ] = useState(taskRowCount === 0);

    // If the user deletes all their tasks then show the placeholder
    // tutorial again.
    if (taskRowCount === 0 && !shouldShowTaskGhostRowPlaceholderTutorial) {
        setShouldShowTaskGhostRowPlaceholderTutorial(true);
    }

    // Once we complete the tutorial we shouldn't show it again if the user starts
    // deleting tasks. Unless the user deletes all their tasks.
    if (
        taskRowCount >= taskGhostRowPlaceholderTutorial.length &&
        shouldShowTaskGhostRowPlaceholderTutorial
    ) {
        setShouldShowTaskGhostRowPlaceholderTutorial(false);
    }

    const taskGhostRowPlaceholder =
        shouldShowTaskGhostRowPlaceholderTutorial &&
        taskRowCount < taskGhostRowPlaceholderTutorial.length
            ? taskGhostRowPlaceholderTutorial[taskRowCount]!
            : undefined;

    return {taskGhostRowPlaceholder};
}
