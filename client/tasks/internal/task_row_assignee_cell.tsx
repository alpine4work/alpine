import classNames from "classnames";
import {
    KeyboardEvent,
    Memo,
    Ref,
    forwardRef,
    memo,
    useImperativeHandle,
    useRef,
    useState,
} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {AccountShortName} from "~/client/accounts/account_short_name.js";
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
import {TaskGridViewColumn} from "~/client/tasks/internal/task_row_view.js";
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

const TaskRowAssigneeCellForwardRefMemo = memo(forwardRef(TaskRowAssigneeCell));
export {TaskRowAssigneeCellForwardRefMemo as TaskRowAssigneeCell};

const cellClassName = sprinkles({
    flexShrink: "0",
    width: taskRowViewColumnWidth,
    paddingX: taskRowViewColumnPaddingX,
    overflow: "hidden",
    height: taskRowViewMinHeight,
    display: "flex",
    alignItems: "center",
});

const previewClassName = sprinkles({
    marginLeft: "-0.5",
    maxWidth: "full",
    height: "5",
    marginY: "-0.5",
    overflow: "hidden",
    display: "inline-flex",
    alignItems: "center",
    gap: "1.5",
    userSelect: "text",
});

const previewNameClassName = sprinkles({
    fontStyle: "truncate",
});

function TaskRowAssigneeCell(
    {
        store,
        task,
        disableExpensiveFeaturesDuringScroll,
        isFirstRow,
        onCellKeyDownCapture,
        focusNextCell,
        focusPreviousCell,
    }: {
        store: TaskClientStore;
        task: TaskModel | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        isFirstRow: boolean;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
    },
    ref: Ref<TaskRowAssigneeCellRef>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this file. It is critical for scroll performance that this component renders
    // fast. Use the `sprinkles()` function in the module body instead. We've
    // observed while profiling the sprinkles function takes a meaningful amount of
    // time during render.
    //
    // One day we'd like to introduce transformations that automatically
    // pre-evaluates `sprinkles()` functions at which point lifting them to the
    // module scope wouldn't do anything.
    //
    // So we assign the `sprinkles` variable to null here so you get a TypeScript
    // error if you try to use `sprinkles()`.
    //
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const sprinkles = null;

    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const assigneeAccountStore = task ? store.getTaskAssigneeAccountStore(task) : null;
    const assigneeAccountData = useStore(assigneeAccountStore);

    const cellRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    // Disable expensive features until the user hovers/focuses the cell in
    // question while not scrolling.
    //
    // This improves scroll performance and initial load performance. Since we only
    // need to render the read-only version of a cell on initial load.
    const [_disableExpensiveFeatures, setDisableExpensiveFeatures] = useState(true);
    let disableExpensiveFeatures = _disableExpensiveFeatures;
    if (
        disableExpensiveFeatures &&
        !disableExpensiveFeaturesDuringScroll &&
        (isHovered || isFocusWithin)
    ) {
        disableExpensiveFeatures = false;
        setDisableExpensiveFeatures(false);
    }

    // NOTE(calebmer): We haven't implemented read-only task rows yet but when we
    // do the optimized cell implementation and read-only mode should share an
    // implementation.
    const isReadOnly = disableExpensiveFeatures;

    useImperativeHandle(
        ref,
        () => ({
            focusCell: () => assertExists(cellRef.current).focus(),
            focusCellInput: () => {
                if (isReadOnly) {
                    assertExists(cellRef.current).focus();
                } else {
                    assertExists(inputRef.current).focus();
                }
            },
        }),
        [isReadOnly],
    );

    return (
        <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                tabIndex={-1}
                className={classNames(tasksStyles.textCursorNotInheritedClassName, cellClassName)}
                style={{opacity: assigneeAccountData || isHovered || isFocusWithin ? 1 : 0}}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: () => assertExists(inputRef.current).focus(),
                    onSelectAll: () => assertExists(inputRef.current).focus(),
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDownCapture={event => onCellKeyDownCapture("Assignee", event)}
            >
                {isReadOnly ? (
                    assigneeAccountData && (
                        <div
                            className={previewClassName}
                            style={{
                                // Get around the `textCursorNotInheritedClassName` reset.
                                cursor: "text",
                                // `display: inline-flex` creates an inline layout which adds extra space
                                // below the element. Adding `vertical-align` stops the space from being added.
                                // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                                verticalAlign: "top",
                            }}
                        >
                            <AccountAvatar size="5" account={assigneeAccountData} />
                            <AccountShortName
                                className={previewNameClassName}
                                account={assigneeAccountData}
                                // Place the first row's tooltip below the name. Since we may have a
                                // column header with a z-index higher than overlays so it can render
                                // overlays when scrolled..
                                tooltipPlacement={isFirstRow ? "bottom" : "top"}
                            />
                        </div>
                    )
                ) : (
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
                        onArrowLeftLeaveKeyDown={() => focusPreviousCell("Assignee")}
                        onArrowRightLeaveKeyDown={() => focusNextCell("Assignee")}
                    />
                )}
            </div>
        </FocusRing>
    );
}
