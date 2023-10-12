import classNames from "classnames";
import {KeyboardEvent, Ref, forwardRef, useImperativeHandle, useRef, useState} from "react";
import {useAppContext} from "~/client/context/app_context.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/tasks/internal/task_assignee_input.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sprinkles, tasksStyles} from "~/shared/styles/styles.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export type TaskRowAssigneeCellRef = {
    focusCell(): void;
    focusCellInput(): void;
};

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// So we assign the `Box` variable to null here so you get a TypeScript error
// if you try to use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

const TaskRowAssigneeCellForwardRef = forwardRef(TaskRowAssigneeCell);
export {TaskRowAssigneeCellForwardRef as TaskRowAssigneeCell};

function TaskRowAssigneeCell(
    {
        store,
        task,
        onCellKeyDownCapture,
        focusNextCell,
        focusPreviousCell,
    }: {
        store: TaskClientStore;
        task: TaskModel | null;
        onCellKeyDownCapture: (event: KeyboardEvent) => void;
        focusNextCell: () => void;
        focusPreviousCell: () => void;
    },
    ref: Ref<TaskRowAssigneeCellRef>,
) {
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const assigneeAccountStore = task ? store.getTaskAssigneeAccountStore(task) : null;
    const assigneeAccountData = useStore(assigneeAccountStore);

    const cellRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInput: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
                className={classNames(
                    tasksStyles.textCursorNotInheritedClassName,
                    sprinkles({
                        flexShrink: "0",
                        width: taskRowViewColumnWidth,
                        paddingX: taskRowViewColumnPaddingX,
                        overflow: "hidden",
                        height: taskRowViewMinHeight,
                        display: "flex",
                        alignItems: "center",
                        opacity: assigneeAccountData || isHovered || isFocusWithin ? "100" : "0",
                    }),
                )}
                {...useOutOfBoundsClickSelection({
                    onSelect: () => assertExists(inputRef.current).focus(),
                    onSelectAll: () => assertExists(inputRef.current).focus(),
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDownCapture={onCellKeyDownCapture}
            >
                <TaskAssigneeInput
                    ref={inputRef}
                    aria-label="Assignee"
                    shouldDisplayShortName={true}
                    assigneeAccountData={assigneeAccountData}
                    onAssigneeAccountChange={assigneeAccount => {
                        if (!task) return;

                        const time = store.clock.now();

                        store.commitTaskActionTransaction(context, [
                            {
                                type: "UpdateTask",
                                time,
                                taskId: task.id,
                                taskAction: {
                                    type: "UpdateAssignee",
                                    assignee: assigneeAccount
                                        ? {
                                              assigneeId: assigneeAccount.id,
                                              assignerId: currentAccount.id,
                                              assignedTime: new TaskFilterableTime({
                                                  absoluteTime: time,
                                                  setterTimeZone: timeZone,
                                              }),
                                          }
                                        : null,
                                },
                            },
                        ]);
                    }}
                    // Keyboard navigation in grid view is not done with the tab key.
                    isTabbable={false}
                    onArrowLeftLeaveKeyDown={focusPreviousCell}
                    onArrowRightLeaveKeyDown={focusNextCell}
                />
            </div>
        </FocusRing>
    );
}
