import {KeyboardEvent, Ref, RefObject, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {LocalTask, LocalTasksAction} from "~/client/tasks/internal/local_tasks_state";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

const taskRowHeight: Spacing = "9";

export type TaskRow = TaskNormalRow | TaskInteractiveGhostRow | TaskDecorativeGhostRow;

export type TaskNormalRow = {
    readonly type: "Normal";
    readonly task: LocalTask;
};

export type TaskInteractiveGhostRow = {
    readonly type: "InteractiveGhost";
    readonly ghostTaskId: LocalTaskId;
};

export type TaskDecorativeGhostRow = {
    readonly type: "DecorativeGhost";
};

export type TaskRowViewTitleFieldSelection =
    | {type: "Index"; selectionIndex: number}
    | {type: "Coordinate"; selectionX: number}
    | {type: "End"};

export type TaskRowViewRef = {
    focusTitleField(selection?: TaskRowViewTitleFieldSelection): void;
};

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

function TaskRowView(
    {
        row,
        rowIndex,
        nextTaskRow,
        nextTaskRowRef,
        previousTaskRow,
        previousTaskRowRef,
        dispatch,
    }: {
        row: TaskRow;
        rowIndex: number;
        nextTaskRow: TaskRow | null;
        nextTaskRowRef: RefObject<TaskRowViewRef>;
        previousTaskRow: TaskRow | null;
        previousTaskRowRef: RefObject<TaskRowViewRef>;
        dispatch: (action: LocalTasksAction) => void;
    },
    ref: Ref<TaskRowViewRef>,
) {
    const titleInputRef = useRef<HTMLInputElement>(null);
    const titleInputMeasurementRef = useRef<HTMLDivElement>(null);

    const focusTitleField = useEvent(
        (selection: TaskRowViewTitleFieldSelection = {type: "Index", selectionIndex: 0}) => {
            // Since a decorative ghost row is not focusable, if we try focusing it instead
            // move focus up to the previous row. We focus the end since that's how
            // documents behave. Selection below text bounds at any position goes to the
            // end of the text.
            if (row.type === "DecorativeGhost") {
                previousTaskRowRef.current?.focusTitleField({type: "End"});
                return;
            }

            const titleInputElement = assertExists(titleInputRef.current);

            switch (selection.type) {
                case "Index": {
                    titleInputElement.setSelectionRange(
                        selection.selectionIndex,
                        selection.selectionIndex,
                    );
                    titleInputElement.focus();
                    break;
                }
                case "Coordinate": {
                    // NOCOMMIT
                    titleInputElement.focus();
                    break;
                }
                case "End": {
                    titleInputElement.setSelectionRange(
                        titleInputElement.value.length,
                        titleInputElement.value.length,
                    );
                    titleInputElement.focus();
                    break;
                }
                default:
                    throw exhaustive(selection);
            }
        },
    );

    useImperativeHandle(ref, () => ({focusTitleField}), [focusTitleField]);

    const handleTitleFieldKeyDown = (
        row: TaskNormalRow | TaskInteractiveGhostRow,
        event: KeyboardEvent<HTMLInputElement>,
    ) => {
        const title = event.currentTarget.value;
        const selectionStart = assertExists(event.currentTarget.selectionStart);
        const selectionEnd = assertExists(event.currentTarget.selectionEnd);

        switch (event.key) {
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();

                if (!isModifiedKeyboardEvent(event)) {
                    dispatch({
                        type: "SplitTaskFromTitle",
                        taskId: row.type === "Normal" ? row.task.id : row.ghostTaskId,
                        titleSelectionStart: selectionStart,
                        titleSelectionEnd: selectionEnd,
                    });
                }
                break;
            }
            case "Backspace": {
                if (selectionStart === 0 && selectionEnd === 0) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    dispatch({
                        type: "JoinTaskFromTitle",
                        deleteTaskId: row.type === "Normal" ? row.task.id : row.ghostTaskId,
                    });
                }
                break;
            }
            case "Delete": {
                if (selectionStart === title.length && selectionEnd === title.length) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                        dispatch({
                            type: "JoinTaskFromTitle",
                            deleteTaskId:
                                nextTaskRow.type === "Normal"
                                    ? nextTaskRow.task.id
                                    : nextTaskRow.ghostTaskId,
                        });
                    }
                }
                break;
            }
            case "ArrowUp":
            case "ArrowDown": {
                event.preventDefault();
                event.stopPropagation();

                if (!isModifiedKeyboardEvent(event)) {
                    const titleInputElement = assertExists(titleInputRef.current);

                    // Get the X coordinate of the input's selection. We will maintain the X
                    // position when moving up/down with arrow keys.
                    //
                    // NOTE(calebmer): Unfortunately we can't use `window.getSelection()` with an
                    // `<input>` element so to figure out the X coordinate of our selection we need
                    // to insert the text in our editor to a hidden `<div>` to get correct
                    // measurements.
                    const titleInputMeasurementElement = assertExists(
                        titleInputMeasurementRef.current,
                    );

                    titleInputMeasurementElement.textContent = title.slice(0, selectionStart);

                    const selectionX =
                        titleInputMeasurementElement.getBoundingClientRect().right -
                        // We don't scroll our measurement element, so adjust the X position by how
                        // much the input has scrolled.
                        titleInputElement.scrollLeft;

                    titleInputMeasurementElement.textContent = "";

                    // NOCOMMIT: If we are continuously arrowing up/down we should reuse an old
                    // `selectionX`.
                    if (event.key === "ArrowUp") {
                        if (previousTaskRow && previousTaskRow.type !== "DecorativeGhost") {
                            assertExists(previousTaskRowRef.current).focusTitleField({
                                type: "Coordinate",
                                selectionX,
                            });
                        }
                    } else {
                        if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                            assertExists(nextTaskRowRef.current).focusTitleField({
                                type: "Coordinate",
                                selectionX,
                            });
                        }
                    }
                }
                break;
            }
        }
    };

    return (
        <Box display="flex">
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                onClick={() => focusTitleField()}
            />
            <Box
                position="relative"
                flexGrow="1"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                {row.type === "DecorativeGhost" ? (
                    <Box
                        width="full"
                        height={taskRowHeight}
                        // Create an illusion that even though this space is not editable that it's a
                        // text editor by giving this space a text cursor and making it clickable
                        // putting focus in the previous task.
                        //
                        // This is an affordance for mouse users, does not need to be usable
                        // by keyboard.
                        cursor="text"
                        onClick={() => focusTitleField()}
                    />
                ) : (
                    <>
                        <Box
                            // Element with identical styling to our `<input>`. We will imperatively add
                            // text content to this element and use it to measure how wide the content is.
                            ref={titleInputMeasurementRef}
                            position="absolute"
                            top="0"
                            paddingY="2"
                            style={{
                                ...contentSchemaStyles.paragraphFontSize,
                                opacity: 0,
                                pointerEvents: "none",
                            }}
                        />
                        <input
                            ref={titleInputRef}
                            placeholder={
                                row.type === "InteractiveGhost"
                                    ? rowIndex === 0
                                        ? "Click to add a task…"
                                        : rowIndex === 1
                                        ? "Press enter to add another task…"
                                        : rowIndex === 2
                                        ? "Press tab to convert into a subtask…"
                                        : rowIndex === 3
                                        ? "Keep adding tasks…"
                                        : "Add a task…"
                                    : undefined
                            }
                            style={contentSchemaStyles.paragraphFontSize}
                            className={sprinkles({
                                width: "full",
                                height: taskRowHeight,
                                paddingY: "2",
                                backgroundColor: "transparent",
                            })}
                            value={row.type === "Normal" ? row.task.title : ""}
                            onChange={event => {
                                const title = event.currentTarget.value;

                                if (row.type === "Normal") {
                                    dispatch({
                                        type: "UpdateTaskTitle",
                                        taskId: row.task.id,
                                        title,
                                    });
                                } else {
                                    dispatch({type: "CreateTaskFromGhost", title});
                                }
                            }}
                            onKeyDown={event => handleTitleFieldKeyDown(row, event)}
                        />
                    </>
                )}
            </Box>
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                //
                // TODO(calebmer): When this has more fields focus should go to the last field,
                // not the title input.
                cursor="text"
                onClick={() => focusTitleField({type: "End"})}
            />
        </Box>
    );
}
