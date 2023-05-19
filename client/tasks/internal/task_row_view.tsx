import {
    Memo,
    MutableRefObject,
    Ref,
    RefObject,
    forwardRef,
    useCallback,
    useImperativeHandle,
    useRef,
} from "react";
import {Box} from "~/client/design/box";
import {LocalTasksAction} from "~/client/tasks/internal/local_tasks_state";
import {TaskRow} from "~/client/tasks/internal/task_row";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
    taskRowTitleInputHeight,
} from "~/client/tasks/internal/task_row_title_input";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {colorSchemeVars} from "~/shared/styles/styles";

const taskRowHeight: Spacing = taskRowTitleInputHeight;

export type TaskRowViewRef = {
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitlePos(pos: number): void;
    focusTitleCoord(left: number): void;
};

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

function TaskRowView(
    {
        taskRow,
        nextTaskRow,
        nextTaskRowRef,
        previousTaskRow,
        previousTaskRowRef,
        firstTaskRowRef,
        lastTaskRowRef,
        taskGhostRowPlaceholder,
        lastArrowNavigationXRef,
        dispatch,
    }: {
        taskRow: TaskRow;
        nextTaskRow: TaskRow | null;
        nextTaskRowRef: RefObject<TaskRowViewRef>;
        previousTaskRow: TaskRow | null;
        previousTaskRowRef: RefObject<TaskRowViewRef>;
        firstTaskRowRef: RefObject<TaskRowViewRef>;
        lastTaskRowRef: RefObject<TaskRowViewRef>;
        taskGhostRowPlaceholder: string;
        lastArrowNavigationXRef: MutableRefObject<{setTime: Date; x: number} | null>;
        dispatch: Memo<(action: LocalTasksAction) => void>;
    },
    ref: Ref<TaskRowViewRef>,
) {
    const titleInputRef = useRef<TaskRowTitleInputRef>(null);

    const focusTitleStart = useCallback(() => {
        // Since a decorative ghost row is not focusable, instead move focus up to the
        // previous row. We focus the end since that's how documents behave, clicking
        // out of bounds focuses the content's end.
        if (taskRow.type === "DecorativeGhost") {
            previousTaskRowRef.current?.focusTitleEnd();
            return;
        }

        assertExists(titleInputRef.current).focusStart();
    }, [previousTaskRowRef, taskRow.type]);

    const focusTitleEnd = useCallback(() => {
        // Since a decorative ghost row is not focusable, instead move focus up to the
        // previous row. We focus the end since that's how documents behave, clicking
        // out of bounds focuses the content's end.
        if (taskRow.type === "DecorativeGhost") {
            previousTaskRowRef.current?.focusTitleEnd();
            return;
        }

        assertExists(titleInputRef.current).focusEnd();
    }, [previousTaskRowRef, taskRow.type]);

    const focusTitleAll = useCallback(() => {
        // Since a decorative ghost row is not focusable, instead move focus up to the
        // previous row.
        //
        // Unlike the other focus methods we will select everything in that previous
        // row since that's what clicking out of bounds at a document's end will do.
        if (taskRow.type === "DecorativeGhost") {
            previousTaskRowRef.current?.focusTitleAll();
            return;
        }

        assertExists(titleInputRef.current).focusAll();
    }, [previousTaskRowRef, taskRow.type]);

    const focusTitlePos = useCallback(
        (pos: number) => {
            // Since a decorative ghost row is not focusable, instead move focus up to the
            // previous row. We focus the end since that's how documents behave, clicking
            // out of bounds focuses the content's end.
            if (taskRow.type === "DecorativeGhost") {
                previousTaskRowRef.current?.focusTitleEnd();
                return;
            }

            assertExists(titleInputRef.current).focusPos(pos);
        },
        [previousTaskRowRef, taskRow.type],
    );

    const focusTitleCoord = useCallback(
        (left: number) => {
            // Since a decorative ghost row is not focusable, instead move focus up to the
            // previous row. We focus the end since that's how documents behave, clicking
            // out of bounds focuses the content's end.
            if (taskRow.type === "DecorativeGhost") {
                previousTaskRowRef.current?.focusTitleEnd();
                return;
            }

            assertExists(titleInputRef.current).focusCoord(left);
        },
        [previousTaskRowRef, taskRow.type],
    );

    useImperativeHandle(
        ref,
        () => ({focusTitleStart, focusTitleEnd, focusTitleAll, focusTitlePos, focusTitleCoord}),
        [focusTitleAll, focusTitleCoord, focusTitleEnd, focusTitlePos, focusTitleStart],
    );

    return (
        <Box display="flex">
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                // A double click selects the task text.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleStart,
                    onSelectAll: focusTitleAll,
                })}
            />
            <Box
                position="relative"
                flexGrow="1"
                overflow="hidden"
                display="flex"
                style={{
                    // Draw the top and bottom border with a shadow so it:
                    //
                    // 1. Doesn't add 2px to layout
                    // 2. Adjacent borders share the same space so we don't get 2px dividers
                    boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                }}
            >
                <Box
                    flexShrink="0"
                    style={{
                        width: `${
                            1.5 * (taskRow.type === "Normal" ? taskRow.parentStack.length : 0)
                        }rem`,
                    }}
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    cursor="text"
                    {...useOutOfBoundsClickSelection({
                        onSelect: focusTitleStart,
                        onSelectAll: focusTitleAll,
                    })}
                />
                <Box flexGrow="1" overflow="hidden">
                    {taskRow.type === "DecorativeGhost" ? (
                        <TaskDecorativeGhostRowView
                            focusTitleStart={focusTitleStart}
                            focusTitleAll={focusTitleAll}
                        />
                    ) : (
                        <TaskRowTitleInput
                            ref={titleInputRef}
                            taskRow={taskRow}
                            nextTaskRow={nextTaskRow}
                            nextTaskRowRef={nextTaskRowRef}
                            previousTaskRow={previousTaskRow}
                            previousTaskRowRef={previousTaskRowRef}
                            firstTaskRowRef={firstTaskRowRef}
                            lastTaskRowRef={lastTaskRowRef}
                            taskGhostRowPlaceholder={taskGhostRowPlaceholder}
                            lastArrowNavigationXRef={lastArrowNavigationXRef}
                            dispatch={dispatch}
                        />
                    )}
                </Box>
            </Box>
            <Box
                flexShrink="0"
                width="5"
                // Create an illusion that the text editor extends into the margins by giving
                // the margin a text cursor and making it clickable putting focus in the task.
                // A double click selects the task text.
                //
                // This is an affordance for mouse users, does not need to be usable
                // by keyboard.
                cursor="text"
                {...useOutOfBoundsClickSelection({
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            />
        </Box>
    );
}

function TaskDecorativeGhostRowView({
    focusTitleStart,
    focusTitleAll,
}: {
    focusTitleStart: () => void;
    focusTitleAll: () => void;
}) {
    return (
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
            {...useOutOfBoundsClickSelection({
                onSelect: focusTitleStart,
                onSelectAll: focusTitleAll,
            })}
        />
    );
}
