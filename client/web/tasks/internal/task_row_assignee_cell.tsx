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
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {isElementOwnedBy} from "~/client/web/helpers/elements/is_element_owned_by.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useHoverWithOverlaySupport} from "~/client/web/helpers/use_hover_with_overlay_support.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {sprinkles, tasksStyles} from "~/client/web/styles/styles.js";
import {
    taskRowViewColumnPaddingX,
    taskRowViewColumnWidth,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {
    TaskAssigneeInput,
    TaskAssigneeInputRef,
} from "~/client/web/tasks/internal/task_assignee_input.js";
import {TaskGridViewColumn} from "~/client/web/tasks/internal/task_row_view.js";
import {useOutOfBoundsClickSelection} from "~/client/web/tasks/internal/use_out_of_bounds_click_selection.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";

export type TaskRowAssigneeCellRef = {
    focusCell(): void;
    focusCellInput(): void;
    isFocusWithinCell(): boolean;
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
        isReadOnly: isActuallyReadOnly,
        store,
        task,
        disableExpensiveFeaturesDuringScroll,
        isFirstRow,
        onCellKeyDown,
        onCellKeyDownCapture,
        focusNextCell,
        focusPreviousCell,
        commitActionTransaction,
    }: {
        isReadOnly: boolean;
        store: TaskClientReadonlyStore;
        task: TaskModel | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        isFirstRow: boolean;
        onCellKeyDown: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        onCellKeyDownCapture: Memo<(column: TaskGridViewColumn, event: KeyboardEvent) => void>;
        focusNextCell: Memo<(column: TaskGridViewColumn) => void>;
        focusPreviousCell: Memo<(column: TaskGridViewColumn) => void>;
        commitActionTransaction: Memo<
            (getActions: (taskId: TaskId) => Array<TaskActionModel>) => void
        >;
    },
    ref: Ref<TaskRowAssigneeCellRef>,
) {
    // NOTE(calebmer): You are not allowed to use the `sprinkles()` function in
    // this component. It is critical for scroll performance that this component
    // renders fast. Use the `sprinkles()` function in the module body instead.
    // We've observed while profiling the sprinkles function takes a meaningful
    // amount of time during render.
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

    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const assigneeAccountStore = task ? store.getTaskAssigneeAccountStore(task) : null;
    const assigneeAccountData = useStore(assigneeAccountStore);

    const cellRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<TaskAssigneeInputRef>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const [isFocusWithin, setIsFocusWithin] = useState(false);

    // Disable expensive features until the user hovers/focuses the cell in question
    // while not scrolling.
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

    // Treat the cell as read-only while expensive features are disabled.
    const isReadOnly = isActuallyReadOnly || disableExpensiveFeatures;

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
            isFocusWithinCell: () =>
                !!document.activeElement &&
                isElementOwnedBy(assertExists(cellRef.current), document.activeElement),
        }),
        [isReadOnly],
    );

    const handleAssigneeAccountChange = (assigneeAccount: AccountModel | null) => {
        // Currently, accounts without space access can't edit tasks. The max permission
        // level of `urlGrant` is `View`.
        assert(currentAccount);

        commitActionTransaction(taskId => {
            const time = store.clock.now();

            return [
                {
                    type: "UpdateTask",
                    time,
                    taskId,
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
            ];
        });
    };

    return (
        <FocusRing
            isVisibleFromAnyFocus={true}
            offset="0"
            insetTop="border"
            // Render underneath the combobox overlay.
            overlayZIndex="-10"
        >
            <div
                ref={useMergedRefs<HTMLDivElement>(cellRef, hoverRef)}
                data-testid={
                    process.env.NODE_ENV !== "production" ? "TaskRowAssigneeCell" : undefined
                }
                tabIndex={-1}
                className={classNames(
                    !isActuallyReadOnly && tasksStyles.textCursorNotInheritedClassName,
                    cellClassName,
                )}
                style={{
                    width: taskRowViewColumnWidth,
                    opacity: assigneeAccountData || isHovered || isFocusWithin ? 1 : 0,
                }}
                {...useOutOfBoundsClickSelection({
                    isDisabled: isReadOnly,
                    onSelect: () => assertExists(inputRef.current).focus(),
                    onSelectAll: () => assertExists(inputRef.current).focus(),
                })}
                onFocus={() => setIsFocusWithin(true)}
                onBlur={event => {
                    setIsFocusWithin(event.currentTarget.contains(event.relatedTarget));
                }}
                onKeyDown={event => {
                    switch (event.key) {
                        case "Backspace":
                        case "Delete": {
                            if (event.currentTarget === event.target) {
                                event.preventDefault();
                                event.stopPropagation();

                                if (!isReadOnly) {
                                    handleAssigneeAccountChange(null);
                                }
                            }
                            break;
                        }
                        default: {
                            onCellKeyDown("Assignee", event);
                            break;
                        }
                    }
                }}
                onKeyDownCapture={event => onCellKeyDownCapture("Assignee", event)}
            >
                {isReadOnly ? (
                    assigneeAccountData && (
                        <div
                            className={previewClassName}
                            style={{
                                // Get around the `textCursorNotInheritedClassName` reset.
                                cursor: !isReadOnly ? "text" : "auto",
                                // `display: inline-flex` creates an inline layout which adds extra space below the
                                // element. Adding `vertical-align` stops the space from being added.
                                // https://stackoverflow.com/questions/27536428/inline-block-element-height-issue
                                verticalAlign: "top",
                            }}
                        >
                            <AccountAvatar size="5" account={assigneeAccountData} />
                            <AccountShortName
                                className={previewNameClassName}
                                account={assigneeAccountData}
                                // Place the first row's tooltip below the name. Since we may have a column header
                                // with a z-index higher than overlays so it can render overlays when scrolled..
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
                        onAssigneeAccountChange={handleAssigneeAccountChange}
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
