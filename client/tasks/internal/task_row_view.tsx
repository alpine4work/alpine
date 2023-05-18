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

export type TaskRowViewNameFieldSelection =
    | {type: "Index"; selectionIndex: number}
    | {type: "Coordinate"; selectionX: number}
    | {type: "End"};

export type TaskRowViewRef = {
    focusNameField(selection?: TaskRowViewNameFieldSelection): void;
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
    const nameInputRef = useRef<HTMLInputElement>(null);
    const nameInputMeasurementRef = useRef<HTMLDivElement>(null);

    const focusNameField = useEvent(
        (selection: TaskRowViewNameFieldSelection = {type: "Index", selectionIndex: 0}) => {
            // Since a decorative ghost row is not focusable, if we try focusing it instead
            // move focus up to the previous row. We focus the end since that's how
            // documents behave. Selection below text bounds at any position goes to the
            // end of the text.
            if (row.type === "DecorativeGhost") {
                previousTaskRowRef.current?.focusNameField({type: "End"});
                return;
            }

            const nameInputElement = assertExists(nameInputRef.current);

            switch (selection.type) {
                case "Index": {
                    nameInputElement.setSelectionRange(
                        selection.selectionIndex,
                        selection.selectionIndex,
                    );
                    nameInputElement.focus();
                    break;
                }
                case "Coordinate": {
                    // NOCOMMIT
                    nameInputElement.focus();
                    break;
                }
                case "End": {
                    nameInputElement.setSelectionRange(
                        nameInputElement.value.length,
                        nameInputElement.value.length,
                    );
                    nameInputElement.focus();
                    break;
                }
                default:
                    throw exhaustive(selection);
            }
        },
    );

    useImperativeHandle(ref, () => ({focusNameField}), [focusNameField]);

    const handleNameFieldKeyDown = (
        row: TaskNormalRow | TaskInteractiveGhostRow,
        event: KeyboardEvent<HTMLInputElement>,
    ) => {
        const name = event.currentTarget.value;
        const selectionStart = assertExists(event.currentTarget.selectionStart);
        const selectionEnd = assertExists(event.currentTarget.selectionEnd);

        switch (event.key) {
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();

                if (!isModifiedKeyboardEvent(event)) {
                    dispatch({
                        type: "SplitTaskFromName",
                        taskId: row.type === "Normal" ? row.task.id : row.ghostTaskId,
                        nameSelectionStart: selectionStart,
                        nameSelectionEnd: selectionEnd,
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
                        type: "JoinTaskFromName",
                        deleteTaskId: row.type === "Normal" ? row.task.id : row.ghostTaskId,
                    });
                }
                break;
            }
            case "Delete": {
                if (selectionStart === name.length && selectionEnd === name.length) {
                    event.preventDefault();
                    event.stopPropagation();

                    // TODO(calebmer): If the task we're deleting has other fields (like comments
                    // and notes) we should probably popup a warning and ask "are you sure you want
                    // to delete"? The join behavior is great for quickly iterating on tasks but
                    // can be dangerous.
                    if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                        dispatch({
                            type: "JoinTaskFromName",
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
                    const nameInputElement = assertExists(nameInputRef.current);

                    // Get the X coordinate of the input's selection. We will maintain the X
                    // position when moving up/down with arrow keys.
                    //
                    // NOTE(calebmer): Unfortunately we can't use `window.getSelection()` with an
                    // `<input>` element so to figure out the X coordinate of our selection we need
                    // to insert the text in our editor to a hidden `<div>` to get correct
                    // measurements.
                    const nameInputMeasurementElement = assertExists(
                        nameInputMeasurementRef.current,
                    );

                    nameInputMeasurementElement.textContent = name.slice(0, selectionStart);

                    const selectionX =
                        nameInputMeasurementElement.getBoundingClientRect().right -
                        // We don't scroll our measurement element, so adjust the X position by how
                        // much the input has scrolled.
                        nameInputElement.scrollLeft;

                    nameInputMeasurementElement.textContent = "";

                    // NOCOMMIT: If we are continuously arrowing up/down we should reuse an old
                    // `selectionX`.
                    if (event.key === "ArrowUp") {
                        if (previousTaskRow && previousTaskRow.type !== "DecorativeGhost") {
                            assertExists(previousTaskRowRef.current).focusNameField({
                                type: "Coordinate",
                                selectionX,
                            });
                        }
                    } else {
                        if (nextTaskRow && nextTaskRow.type !== "DecorativeGhost") {
                            assertExists(nextTaskRowRef.current).focusNameField({
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
                onClick={() => focusNameField()}
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
                        onClick={() => focusNameField()}
                    />
                ) : (
                    <>
                        <Box
                            // Element with identical styling to our `<input>`. We will imperatively add
                            // text content to this element and use it to measure how wide the content is.
                            ref={nameInputMeasurementRef}
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
                            ref={nameInputRef}
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
                            value={row.type === "Normal" ? row.task.name : ""}
                            onChange={event => {
                                const name = event.currentTarget.value;

                                if (row.type === "Normal") {
                                    dispatch({type: "UpdateTaskName", taskId: row.task.id, name});
                                } else {
                                    dispatch({type: "CreateTaskFromGhost", name});
                                }
                            }}
                            onKeyDown={event => handleNameFieldKeyDown(row, event)}
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
                // not the name input.
                cursor="text"
                onClick={() => focusNameField({type: "End"})}
            />
        </Box>
    );
}
