import {CaretRight, Check} from "phosphor-react";
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
import {usePress} from "react-aria";
import {Box} from "~/client/design/box";
import {buttonPressedOverlayOpacity} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {LocalTasksAction} from "~/client/tasks/demo_1/internal/local_tasks_state_old";
import {TaskRow} from "~/client/tasks/demo_1/internal/task_row";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
    taskRowTitleInputHeight,
} from "~/client/tasks/demo_1/internal/task_row_title_input_old";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {Spacing, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {colorSchemeVars, contentSchemaStyles, sprinkles, tasksStyles} from "~/shared/styles/styles";

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
                    display="flex"
                    justifyContent="flex-end"
                    alignItems="center"
                    style={{
                        width: `${
                            parseRemLengthNumber(spacing["5"]) +
                            parseRemLengthNumber(spacing["6"]) +
                            parseRemLengthNumber(contentSchemaStyles.listItemIndentation) *
                                (taskRow.type === "Normal" ? taskRow.parentStack.length : 0)
                        }rem`,
                    }}
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    className={tasksStyles.textCursorNotInheritedClassName}
                    {...useOutOfBoundsClickSelection({
                        onSelect: focusTitleStart,
                        onSelectAll: focusTitleAll,
                    })}
                >
                    <Box
                        width="5"
                        paddingRight="1"
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                    >
                        {taskRow.type === "Normal" &&
                            taskRow.task.childTaskIdByOrderKey.size > 0 && (
                                <IconButton
                                    size="xs"
                                    description={
                                        taskRow.task.isExpanded
                                            ? "Collapse subtasks"
                                            : "Expand subtasks"
                                    }
                                    onPress={() => {
                                        dispatch({
                                            type: "UpdateTaskIsExpanded",
                                            taskId: taskRow.task.id,
                                            isExpanded: !taskRow.task.isExpanded,
                                        });
                                    }}
                                >
                                    <CaretRight
                                        style={{
                                            transform: taskRow.task.isExpanded
                                                ? "rotate(90deg)"
                                                : "rotate(0deg)",
                                            transition: "transform 100ms ease",
                                        }}
                                    />
                                </IconButton>
                            )}
                    </Box>
                    <Box
                        width="6"
                        paddingRight="2"
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                    >
                        {taskRow.type === "Normal" && (
                            <TaskRowCloseButton
                                taskId={taskRow.task.id}
                                isOpen={taskRow.task.isOpen}
                                dispatch={dispatch}
                            />
                        )}
                    </Box>
                </Box>
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

function TaskRowCloseButton({
    taskId,
    isOpen,
    dispatch,
}: {
    taskId: LocalTaskId;
    isOpen: boolean;
    dispatch: Memo<(action: LocalTasksAction) => void>;
}) {
    const {isPressed, pressProps} = usePress({
        onPress: () => {
            dispatch({
                type: "UpdateTaskIsOpen",
                taskId,
                isOpen: !isOpen,
            });
        },
    });

    return (
        <Box
            {...pressProps}
            width="4"
            height="4"
            borderRadius="full"
            display="flex"
            justifyContent="center"
            alignItems="center"
            position="relative"
            overflow="hidden"
            border={
                isOpen
                    ? isPressed
                        ? // Darken border on press regardless of whether we are in light or dark mode.
                          {light: "grey-40", dark: "grey-20"}
                        : "grey-30"
                    : undefined
            }
            backgroundColor={!isOpen ? "theme-50-const" : undefined}
            color={isOpen ? "grey-text" : "grey-0-const"}
        >
            {isPressed && !isOpen && (
                // For accent buttons, instead of choosing a darker background color shade when
                // pressed we add a black overlay at a lowered opacity. We accomplish this with
                // an overlay element since such a color is not in our color scheme.
                //
                // Darker shades in our color scheme are more saturated. We want the effect of a
                // button being physically pressed down.
                //
                // When we added this there was a happy accident. The text color also got
                // darker! This is more fitting for the physical analogy of a button being
                // pressed down.
                <span
                    className={sprinkles({
                        position: "absolute",
                        inset: "0",
                        backgroundColor: "grey-dark",
                        pointerEvents: "none",
                    })}
                    style={{opacity: buttonPressedOverlayOpacity}}
                />
            )}
            {!isOpen && <Check weight="bold" size={addRemLengths(spacing["2"], spacing["0.5"])} />}
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
