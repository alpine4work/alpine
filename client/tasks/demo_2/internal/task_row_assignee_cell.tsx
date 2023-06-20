import {useRef, useState} from "react";
import {Box} from "~/client/design/box";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/demo_2/internal/task_assignee_input";
import {taskRowViewMinHeight} from "~/client/tasks/demo_2/task_row_presentational_view";
import {TaskAssignee} from "~/client/tasks/demo_2/task_status_button";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {tasksStyles} from "~/shared/styles/styles";

export function TaskRowAssigneeCell({
    assignee,
    onAssigneeChange,
}: {
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
}) {
    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    return (
        <Box
            ref={hoverRef}
            flexShrink="0"
            style={{width: `calc(${addRemLengths(spacing["32"], spacing["1.5"], spacing["3"])})`}}
            paddingLeft="6"
            paddingRight="1.5"
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
                    onAssigneeAccountChange={() => {
                        // NOCOMMIT
                    }}
                />
            </Box>
        </Box>
    );
}
