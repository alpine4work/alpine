import {Ref, forwardRef, useImperativeHandle, useRef} from "react";
import {Box} from "~/client/design/box";
import {isModifiedKeyboardEvent} from "~/client/helpers/events/is_modified_keyboard_event";
import {useEvent} from "~/client/helpers/lifecycle/use_event";
import {LocalTask, LocalTasksAction} from "~/client/tasks/local_tasks_state";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
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

export type TaskRowViewRef = {
    focusStart(): void;
    focusEnd(): void;
};

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

function TaskRowView(
    {
        row,
        rowIndex,
        dispatch,
        onPreviousRowFocusEnd,
    }: {
        row: TaskRow;
        rowIndex: number;
        dispatch: (action: LocalTasksAction) => void;
        onPreviousRowFocusEnd: () => void;
    },
    ref: Ref<TaskRowViewRef>,
) {
    const nameInputRef = useRef<HTMLInputElement>(null);

    const focusStart = useEvent(() => {
        if (row.type === "DecorativeGhost") {
            onPreviousRowFocusEnd();
            return;
        }

        const nameInputElement = assertExists(nameInputRef.current);
        nameInputElement.setSelectionRange(0, 0);
        nameInputElement.focus();
    });

    const focusEnd = useEvent(() => {
        if (row.type === "DecorativeGhost") {
            onPreviousRowFocusEnd();
            return;
        }

        const nameInputElement = assertExists(nameInputRef.current);
        nameInputElement.setSelectionRange(
            nameInputElement.value.length,
            nameInputElement.value.length,
        );
        nameInputElement.focus();
    });

    useImperativeHandle(ref, () => ({focusStart, focusEnd}), [focusEnd, focusStart]);

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
                onClick={focusStart}
            />
            <Box
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
                        onClick={focusStart}
                    />
                ) : (
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
                        onKeyDown={event => {
                            switch (event.key) {
                                case "Enter": {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    if (isModifiedKeyboardEvent(event)) break;

                                    dispatch({
                                        type: "SplitTaskFromName",
                                        taskId:
                                            row.type === "Normal" ? row.task.id : row.ghostTaskId,
                                        nameSelectionStart: assertExists(
                                            event.currentTarget.selectionStart,
                                        ),
                                        nameSelectionEnd: assertExists(
                                            event.currentTarget.selectionEnd,
                                        ),
                                    });
                                    break;
                                }
                            }
                        }}
                    />
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
                onClick={focusEnd}
            />
        </Box>
    );
}
