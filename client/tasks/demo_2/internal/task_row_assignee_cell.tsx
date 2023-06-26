import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/demo_2/internal/task_assignee_input.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles.js";
import {TaskAssignee} from "~/client/tasks/demo_2/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {tasksStyles} from "~/shared/styles/styles.js";

export type TaskRowAssigneeCellRef = {
    focus(): void;
};

const TaskRowAssigneeCellForwardRef = forwardRef(TaskRowAssigneeCell);
export {TaskRowAssigneeCellForwardRef as TaskRowAssigneeCell};

function TaskRowAssigneeCell(
    {
        assignee,
        onAssigneeChange,
        focusTaskNextCell,
        focusTaskPreviousCell,
    }: {
        assignee: TaskAssignee | null;
        onAssigneeChange: (assignee: TaskAssignee | null) => void;
        focusTaskNextCell: () => void;
        focusTaskPreviousCell: () => void;
    },
    ref: Ref<TaskRowAssigneeCellRef>,
) {
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            style={{
                width: taskRowViewFirstColumnWidth,
                paddingLeft: taskRowViewFirstColumnPaddingLeft,
            }}
            paddingRight={taskRowViewColumnPaddingX}
            overflow="hidden"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(inputRef.current).focus(),
                onSelectAll: () => assertExists(inputRef.current).focus(),
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
            }}
        >
            <Box
                height={taskRowViewMinHeight}
                display="flex"
                alignItems="center"
                className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                opacity={assignee || isHovered || isFocusWithin ? "100" : "0"}
            >
                <TaskAssigneeInput
                    ref={inputRef}
                    aria-label="Assignee"
                    shouldDisplayShortName={true}
                    assigneeAccount={assignee?.account ?? null}
                    onAssigneeAccountChange={assigneeAccount => {
                        const assignedTime = new Date();
                        const assignedDate = toCalendarDate(
                            parseAbsolute(assignedTime.toISOString(), timeZone),
                        );

                        onAssigneeChange(
                            assigneeAccount
                                ? {
                                      account: assigneeAccount,
                                      assignerId: currentAccount.id,
                                      assignedTime,
                                      assignerTimeZone: timeZone,
                                      assignedDate,
                                      status: {type: "Inactive"},
                                  }
                                : null,
                        );
                    }}
                    onArrowLeftLeaveKeyDown={focusTaskPreviousCell}
                    onArrowRightLeaveKeyDown={focusTaskNextCell}
                />
            </Box>
        </Box>
    );
}
