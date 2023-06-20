import {parseAbsolute, toCalendarDate} from "@internationalized/date";
import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useSpaceContext} from "~/client/spaces/space_context";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/demo_2/internal/task_assignee_input";
import {
    taskRowViewFirstColumnPaddingLeft,
    taskRowViewFirstColumnWidth,
    taskRowViewColumnPaddingX,
    taskRowViewMinHeight,
} from "~/client/tasks/demo_2/internal/task_row_shared_styles";
import {TaskAssignee} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";

export function TaskRowAssigneeCell({
    assignee,
    onAssigneeChange,
}: {
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
}) {
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            style={{width: taskRowViewFirstColumnWidth}}
            paddingLeft={taskRowViewFirstColumnPaddingLeft}
            paddingRight={taskRowViewColumnPaddingX}
            overflow="hidden"
            className={tasksStyles.textCursorNotInheritedClassName}
            {...useOutOfBoundsClickSelection({
                onSelect: () => assertExists(inputRef.current).focus(),
                onSelectAll: () => assertExists(inputRef.current).focus(),
            })}
            onFocus={() => setIsFocusWithin(true)}
            onBlur={event => {
                if (!event.currentTarget.contains(event.relatedTarget)) {
                    setIsFocusWithin(false);
                }
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
                />
            </Box>
        </Box>
    );
}
