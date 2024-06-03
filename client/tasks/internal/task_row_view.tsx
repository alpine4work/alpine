import {useDraggable} from "@dnd-kit/core";
import classNames from "classnames";
import {ArrowsOutSimple, DotsSixVertical} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {
    FocusEvent,
    Key,
    KeyboardEvent,
    Memo,
    Ref,
    RefObject,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import * as Y from "yjs";
import {useAppContext} from "~/client/context/app_context.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu.js";
import {isElementOwnedBy} from "~/client/helpers/elements/is_element_owned_by.js";
import {isTextInputElement} from "~/client/helpers/elements/is_text_input_element.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskCloseConfirmationModalDialog} from "~/client/tasks/internal/task_close_confirmation_modal_dialog.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewMobileKeyboardToolbar} from "~/client/tasks/internal/task_grid_view_mobile_keyboard_toolbar.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {
    TaskRowAssigneeCell,
    TaskRowAssigneeCellRef,
} from "~/client/tasks/internal/task_row_assignee_cell.js";
import {
    TaskRowCollectionsCell,
    TaskRowCollectionsCellRef,
} from "~/client/tasks/internal/task_row_collections_cell.js";
import {
    TaskRowDueDateCell,
    TaskRowDueDateCellRef,
} from "~/client/tasks/internal/task_row_due_date_cell.js";
import {
    TaskRowPriorityCell,
    TaskRowPriorityCellRef,
} from "~/client/tasks/internal/task_row_priority_cell.js";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/internal/task_row_title_input.js";
import {
    TaskRowViewDenseFields,
    TaskRowViewDenseFieldsRef,
} from "~/client/tasks/internal/task_row_view_dense_fields.js";
import {
    TaskRowViewDroppable,
    renderTaskRowViewDroppableIndentations,
} from "~/client/tasks/internal/task_row_view_droppable_indentations.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
    TaskClientStoreUpdateTitleActionTransactionBuilder,
} from "~/client/tasks/task_client_store.js";
import {TaskGridViewDraggableData} from "~/client/tasks/task_grid_view_dnd_context.js";
import {
    RemLength,
    Spacing,
    parseRemLengthNumber,
    screenPaddingX,
    screenPaddingXRem,
    spacing,
} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    colorSchemeVars,
    pointerEventsNoneNotInheritedClassName,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {
    desktopTaskRowViewIndentationRem,
    mobileTaskRowViewIndentationRem,
    taskRowViewFirstColumnExtraPaddingLeft,
    taskRowViewMinHeight,
} from "~/shared/styles/tasks_shared_styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

// NOCOMMIT: Haptic feedback when you close a task or mark it as active

export type TaskGridViewColumn =
    | "ExpandButton"
    | "StatusButton"
    | "Title"
    | "Assignee"
    | "Priority"
    | "DueDate"
    | "Collections";

function getNextTaskGridViewColumnIfExists(
    columns: ReadonlyArray<TaskGridViewColumn>,
    currentColumn: TaskGridViewColumn,
): TaskGridViewColumn | null {
    const index = columns.indexOf(currentColumn);
    if (index === -1) return null;
    if (index === columns.length - 1) return null;
    return columns[index + 1]!;
}

function getPreviousTaskGridViewColumnIfExists(
    columns: ReadonlyArray<TaskGridViewColumn>,
    currentColumn: TaskGridViewColumn,
): TaskGridViewColumn | null {
    const index = columns.indexOf(currentColumn);
    if (index === -1) return null;
    if (index === 0) return null;
    return columns[index - 1]!;
}

export type TaskRowViewRef = {
    isFocusWithin(): boolean;
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitleCoord(coord: number, side: "top" | "bottom"): void;
    focusTitleSelection(selection: Selection): void;
    focusCell(column: TaskGridViewColumn): void;
    isFocusWithinCell(column: TaskGridViewColumn): boolean;
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

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

const desktopTaskRowViewStatusButtonWidth = "6";
const desktopTaskRowViewStatusButtonWidthRem = parseRemLengthNumber(
    spacing[desktopTaskRowViewStatusButtonWidth],
);

const mobileTaskRowViewStatusButtonWidth = "7";
const mobileTaskRowViewStatusButtonWidthRem = parseRemLengthNumber(
    spacing[mobileTaskRowViewStatusButtonWidth],
);

const taskRowViewExpandButtonWidth = "5";
const taskRowViewExpandButtonWidthRem = parseRemLengthNumber(spacing[taskRowViewExpandButtonWidth]);

const taskRowViewDragHandleWidth = "5";
const taskRowViewDragHandleWidthRem = parseRemLengthNumber(spacing[taskRowViewDragHandleWidth]);

const borderCoverClassName = sprinkles({
    position: "absolute",
    zIndex: "-10",
    top: "0",
    bottom: "0",
    left: screenPaddingX,
    right: screenPaddingX,
    pointerEvents: "none",
    backgroundColor: "grey-0",
});

const marginLeftContainerClassName = sprinkles({
    alignSelf: "stretch",
    position: "relative",
    flexShrink: "0",
    display: "flex",
    justifyContent: "flex-end",
});

const dragHandleContainerClassName = `${pointerEventsNoneNotInheritedClassName} ${sprinkles({
    position: "relative",
    width: taskRowViewDragHandleWidth,
    height: taskRowViewMinHeight,
    paddingX: "0.5",
    display: "flex",
    alignItems: "center",
})}`;

const dragHandleContainerIfPrimaryInputCanNotHoverClassName = `${dragHandleContainerClassName} ${sprinkles(
    {
        left: "-1.5",
    },
)}`;

const expandButtonContainerClassName = `${pointerEventsNoneNotInheritedClassName} ${sprinkles({
    width: taskRowViewExpandButtonWidth,
    height: taskRowViewMinHeight,
    paddingRight: "1",
    display: "flex",
    alignItems: "center",
})}`;

const desktopStatusButtonContainerClassName = `${pointerEventsNoneNotInheritedClassName} ${sprinkles(
    {
        width: desktopTaskRowViewStatusButtonWidth,
        height: taskRowViewMinHeight,
        paddingRight: "2",
        display: "flex",
        alignItems: "center",
    },
)}`;

const mobileStatusButtonContainerClassName = `${pointerEventsNoneNotInheritedClassName} ${sprinkles(
    {
        width: mobileTaskRowViewStatusButtonWidth,
        height: taskRowViewMinHeight,
        paddingRight: "2",
        display: "flex",
        alignItems: "center",
        // Add a lil extra space between status button and task title.
        position: "relative",
        left: "-0.5",
    },
)}`;

const desktopPlaceholderStatusButtonClassName = sprinkles({
    width: "4",
    height: "4",
    borderRadius: "full",
    border: "grey-10",
    pointerEvents: "none",
});

const mobilePlaceholderStatusButtonClassName = sprinkles({
    width: "5",
    height: "5",
    borderRadius: "full",
    border: "grey-10",
    pointerEvents: "none",
});

const titleCellClassName = sprinkles({
    flexGrow: "1",
    overflow: "hidden",
});

const paddingBottomHeight = "5";

const paddingBottomClassName = sprinkles({
    width: "full",
    height: paddingBottomHeight,
});

function TaskRowView(
    {
        capabilities,
        maxGridExpandableTaskDepth,
        stateKey,
        query,
        isQueryManuallySorted,
        undoManager,
        affinityManager,
        cursor,
        ghostTaskId = null,
        onGhostTaskCreated,
        gridKey,
        parents,
        rowMaxWidth,
        disableExpensiveFeaturesDuringScroll,
        isFirstRow,
        isFirstTaskInQuery,
        nextIndentation,
        titlePlaceholder,
        areChildTasksExpandedStore,
        onAreChildTasksExpandedToggle,
        withoutPaddingLeft,
        withPaddingBottom,
        getMoveTaskToQueryActions,
        getMoveTaskToRootQueryActions,
        getMaybeRemoveTaskFromQueryActions,
        createTaskAbove,
        createTaskBelowAndFocus,
        nestWithPreviousTaskRowIfExistsAndExpand,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildren,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        focusNextTaskTitleCoord,
        focusPreviousTaskTitleCoord,
        focusNextTaskCell,
        focusPreviousTaskCell,
        preserveLastTaskTitleArrowNavigationCoord,
        focusFirstVisibleTaskTitleStart,
        focusFirstVisibleTaskCell,
        focusLastVisibleTaskTitleEnd,
        focusLastVisibleTaskCell,
        pushUndoStackYDocEntry,
        pushUndoStackYDocEntryFromRedo,
        pushRedoStackYDocEntry,
        setRowZIndex,
        mobileKeyboardToolbarPortalRef,
    }: {
        capabilities: TaskGridViewCapabilities;
        maxGridExpandableTaskDepth: number;
        stateKey: Key | undefined;
        query: TaskClientQuery;
        isQueryManuallySorted: boolean;
        undoManager: TaskClientStoreUndoManager;
        affinityManager: TaskClientStoreSearchAffinityManager;
        cursor: TaskQuerySortCursor | null;
        ghostTaskId?: TaskId | null;
        onGhostTaskCreated?: () => void;
        gridKey: TaskGridViewTaskKey;
        parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
        rowMaxWidth: Spacing | null;
        disableExpensiveFeaturesDuringScroll: boolean;
        isFirstRow: boolean;
        isFirstTaskInQuery: boolean;
        nextIndentation: number;
        titlePlaceholder?: string;
        areChildTasksExpandedStore: Store<true | undefined>;
        onAreChildTasksExpandedToggle: () => void;
        withoutPaddingLeft?: boolean;
        withPaddingBottom?: boolean;
        getMoveTaskToQueryActions: (
            taskId: TaskId,
            position:
                | {type: "Start"}
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskAction>;
        getMoveTaskToRootQueryActions: (
            taskId: TaskId,
            position:
                | {type: "Start"}
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskAction>;
        getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
        createTaskAbove: () => void;
        createTaskBelowAndFocus: () => void;
        nestWithPreviousTaskRowIfExistsAndExpand: (titleSelection: Selection) => void;
        unnestTaskIfNestedRow: (titleSelection: Selection) => void;
        deleteTaskAndAllChildren: () => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: () => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        focusNextTaskCell: (column: TaskGridViewColumn) => void;
        focusPreviousTaskCell: (column: TaskGridViewColumn) => void;
        preserveLastTaskTitleArrowNavigationCoord: () => void;
        focusFirstVisibleTaskTitleStart: () => void;
        focusFirstVisibleTaskCell: (column: TaskGridViewColumn) => void;
        focusLastVisibleTaskTitleEnd: () => void;
        focusLastVisibleTaskCell: (column: TaskGridViewColumn) => void;
        pushUndoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
        pushUndoStackYDocEntryFromRedo: (entry: {
            yUndoManager: Y.UndoManager;
            release: () => void;
        }) => void;
        pushRedoStackYDocEntry: (entry: {yUndoManager: Y.UndoManager; release: () => void}) => void;
        setRowZIndex: Memo<(zIndex: number) => () => void>;
        mobileKeyboardToolbarPortalRef: RefObject<HTMLDivElement>;
    },
    ref: Ref<TaskRowViewRef>,
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

    // Either `cursor` or `ghostTaskId` should be provided. This component
    // transitions from a ghost task to a regular task when the user enters data.
    assert(cursor !== null ? ghostTaskId === null : ghostTaskId !== null);

    const isInitialAppRender = useIsInitialAppRender();
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const navigate = useNavigate();
    const context = useAppContext();
    const {timeZone, isAppleDevice} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const taskId = cursor !== null ? getTaskQuerySortCursorTaskId(cursor) : null;
    const taskEntry = useStore(taskId !== null ? query.getLoadedTaskEntryStore(taskId) : null);
    const task = taskEntry?.task ?? null;
    const effectiveTaskId = assertExists(taskId ?? ghostTaskId);

    const parentTaskId = task?.getParent()?.taskId ?? null;
    const parentTaskEntryStore =
        parentTaskId !== null ? query.getReferencedTaskEntryStore(parentTaskId) : null;

    // If `cursor` is non-null then we expect `task` to also be non-null and
    // authorized. This component should only be rendered with `TaskId`s in the
    // query's loaded range and if the task is in the query's loaded range we
    // expect that it exists on the client and is authorized.
    assert(
        cursor !== null
            ? task !== null && taskEntry?.authorizationState?.value === "Authorized"
            : task === null,
    );

    // Always false if we have no child tasks.
    const areChildTasksExpanded =
        useStore((task?.getChildTaskCount() ?? 0) > 0 ? areChildTasksExpandedStore : null) ?? false;

    const titleCommitStateRef = useRef<{
        pendingActionTransactionBuilder: TaskClientStoreUpdateTitleActionTransactionBuilder | null;
    } | null>(null);

    const onTitleChange = (titleUpdate: TaskTitleUpdate) => {
        // When our commit promise finishes, commit the pending update title action if
        // there is one.
        const handleCommitPromise = (commitPromise: {finally: (callback: () => void) => void}) => {
            assert(!titleCommitStateRef.current);

            titleCommitStateRef.current = {
                pendingActionTransactionBuilder: null,
            };

            commitPromise.finally(() => {
                assert(titleCommitStateRef.current);

                const {pendingActionTransactionBuilder} = titleCommitStateRef.current;
                titleCommitStateRef.current = null;

                if (pendingActionTransactionBuilder) {
                    const commitPromise = pendingActionTransactionBuilder.commit(context);
                    handleCommitPromise(commitPromise);
                }
            });
        };

        // If we are currently committing the title then add our update to our pending
        // action transaction builder. We'll commit the pending action after our
        // current action commits.
        if (titleCommitStateRef.current) {
            if (titleCommitStateRef.current.pendingActionTransactionBuilder) {
                titleCommitStateRef.current.pendingActionTransactionBuilder.add(titleUpdate);
            } else {
                titleCommitStateRef.current.pendingActionTransactionBuilder =
                    query.store.getTaskUpdateTitleActionTransactionBuilder(
                        effectiveTaskId,
                        titleUpdate,
                        {affinityManager},
                    );
            }
            return;
        }

        const commitPromise = commitActionTransactionEvenIfGhost(taskId => [
            {
                type: "UpdateTask",
                time: query.store.clock.now(),
                taskId,
                taskAction: {
                    type: "UpdateTitle",
                    titleUpdate,
                },
            },
        ]);

        handleCommitPromise(commitPromise);
    };

    const expandButtonRef = useRef<HTMLElement>(null);
    const statusButtonRef = useRef<HTMLElement>(null);
    const titleCellRef = useRef<HTMLDivElement>(null);
    const titleInputRef = useRef<TaskRowTitleInputRef>(null);
    const denseFieldsRef = useRef<TaskRowViewDenseFieldsRef>(null);
    const assigneeCellRef = useRef<TaskRowAssigneeCellRef>(null);
    const priorityCellRef = useRef<TaskRowPriorityCellRef>(null);
    const dueDateCellRef = useRef<TaskRowDueDateCellRef>(null);
    const collectionsCellRef = useRef<TaskRowCollectionsCellRef>(null);

    const hasTask = !!task;

    const columns = useMemo(() => {
        const columns: Array<TaskGridViewColumn> = [];

        if (hasTask) {
            columns.push("ExpandButton");
            columns.push("StatusButton");
        }

        columns.push("Title");

        if (capabilities.hasColumns) {
            columns.push("Assignee");
            columns.push("Priority");
            columns.push("DueDate");
            columns.push("Collections");
        }

        return columns;
    }, [capabilities.hasColumns, hasTask]);

    const {
        isFocusWithin,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
        focusCell,
        focusCellInput,
        isFocusWithinCell,
        focusNextCell,
        focusPreviousCell,
        handleCellKeyDown,
        handleCellKeyDownCapture,
        commitActionTransactionEvenIfGhost,
    } = useEvents({
        isFocusWithin: () => assertExists(containerRef.current).contains(document.activeElement),

        focusTitleStart: () => {
            assertExists(titleInputRef.current).focusStart();
        },

        focusTitleEnd: () => {
            assertExists(titleInputRef.current).focusEnd();
        },

        focusTitleAll: () => {
            assertExists(titleInputRef.current).focusAll();
        },

        focusTitleCoord: (coord: number, side: "top" | "bottom") => {
            assertExists(titleInputRef.current).focusCoord(coord, side);
        },

        focusTitleSelection: (selection: Selection) => {
            assertExists(titleInputRef.current).focusSelection(selection);
        },

        // TODO(calebmer): `focusCell()` is a bit of a misnomer considering this also
        // focuses dense field inputs if cells aren't available. Currently our
        // nomenclature doesn't consider dense field inputs as "cells". It's great to
        // have one `focus(column)` method for undo/redo though. Since if the undo
        // target is, say, priority we can call `focus("Priority")`.
        focusCell: (column: TaskGridViewColumn) => {
            switch (column) {
                case "ExpandButton": {
                    if (columns.includes(column)) {
                        assertExists(expandButtonRef.current).focus();
                    }
                    return;
                }
                case "StatusButton": {
                    if (columns.includes(column)) {
                        assertExists(statusButtonRef.current).focus();
                    }
                    return;
                }
                case "Title": {
                    // If we have no columns then directly focus the title input.
                    if (!capabilities.hasColumns) {
                        assertExists(titleInputRef.current).focusAll();
                    } else {
                        assertExists(titleCellRef.current).focus();
                    }
                    return;
                }
                case "Assignee": {
                    if (capabilities.hasColumns && columns.includes(column)) {
                        assertExists(assigneeCellRef.current).focusCell();
                    } else if (capabilities.hasDenseFields) {
                        assertExists(denseFieldsRef.current).focusAssigneeInput();
                    }
                    return;
                }
                case "Priority": {
                    if (capabilities.hasColumns && columns.includes(column)) {
                        assertExists(priorityCellRef.current).focusCell();
                    } else if (capabilities.hasDenseFields) {
                        assertExists(denseFieldsRef.current).focusPriorityInput();
                    }
                    return;
                }
                case "DueDate": {
                    if (capabilities.hasColumns && columns.includes(column)) {
                        assertExists(dueDateCellRef.current).focusCell();
                    } else if (capabilities.hasDenseFields) {
                        assertExists(denseFieldsRef.current).focusDueDateInput();
                    }
                    return;
                }
                case "Collections": {
                    if (capabilities.hasColumns && columns.includes(column)) {
                        assertExists(collectionsCellRef.current).focusCell();
                    }
                    return;
                }
                default:
                    throw exhaustive(column);
            }
        },

        focusCellInput: (column: TaskGridViewColumn) => {
            // Noop if the column isn't rendered. This means it should be safe for us to
            // assert that the ref for our column exists since it shouldn't be included in
            // `columns` unless it's rendered.
            if (!columns.includes(column)) return;

            switch (column) {
                case "ExpandButton": {
                    assertExists(expandButtonRef.current).focus();
                    return;
                }
                case "StatusButton": {
                    assertExists(statusButtonRef.current).focus();
                    return;
                }
                case "Title": {
                    assertExists(titleInputRef.current).focusAll();
                    return;
                }
                case "Assignee": {
                    assertExists(assigneeCellRef.current).focusCellInput();
                    return;
                }
                case "Priority": {
                    assertExists(priorityCellRef.current).focusCellInput();
                    return;
                }
                case "DueDate": {
                    assertExists(dueDateCellRef.current).focusCellInputStart();
                    return;
                }
                case "Collections": {
                    assertExists(collectionsCellRef.current).focusCellInputStart();
                    return;
                }
                default:
                    throw exhaustive(column);
            }
        },

        isFocusWithinCell: (column: TaskGridViewColumn): boolean => {
            // If a column isn't rendered, focus definitely isn't within. This allows us to
            // safely assert that our cell refs exist.
            if (!columns.includes(column)) return false;

            switch (column) {
                case "ExpandButton": {
                    return (
                        !!document.activeElement &&
                        isElementOwnedBy(
                            assertExists(expandButtonRef.current),
                            document.activeElement,
                        )
                    );
                }
                case "StatusButton": {
                    return (
                        !!document.activeElement &&
                        isElementOwnedBy(
                            assertExists(statusButtonRef.current),
                            document.activeElement,
                        )
                    );
                }
                case "Title": {
                    return (
                        !!document.activeElement &&
                        isElementOwnedBy(assertExists(titleCellRef.current), document.activeElement)
                    );
                }
                case "Assignee": {
                    return assertExists(assigneeCellRef.current).isFocusWithinCell();
                }
                case "Priority": {
                    return assertExists(priorityCellRef.current).isFocusWithinCell();
                }
                case "DueDate": {
                    return assertExists(dueDateCellRef.current).isFocusWithinCell();
                }
                case "Collections": {
                    return assertExists(collectionsCellRef.current).isFocusWithinCell();
                }
                default:
                    throw exhaustive(column);
            }
        },

        focusNextCell: (column: TaskGridViewColumn) => {
            const nextColumn = getNextTaskGridViewColumnIfExists(columns, column);
            if (!nextColumn) return;

            focusCell(nextColumn);
        },

        focusPreviousCell: (column: TaskGridViewColumn) => {
            const previousColumn = getPreviousTaskGridViewColumnIfExists(columns, column);
            if (!previousColumn) return;

            focusCell(previousColumn);
        },

        // We implement the ARIA grid keyboard shortcuts for our grid view cells. We do
        // not implement the full grid spec at the moment since our virtualized list
        // approach leads to flattening all our rows in the DOM.
        //
        // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
        //
        // Some key bindings are implemented here and some should be implemented in the
        // capture phase with `handleCellKeyDownCapture`.
        handleCellKeyDown: (column: TaskGridViewColumn, event: KeyboardEvent) => {
            switch (event.key) {
                // Moves focus one cell to the left. If focus is on the left-most cell in the
                // row, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowLeft": {
                    if (event.target !== event.currentTarget) {
                        if (!isTextInputElement(event.target)) {
                            // If an arrow key event propagates to this point then prevent the default
                            // browser scroll but don't navigate.
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        // Even though title isn't technically the first column, it's the first
                        // editable column so we put the user there.
                        focusCell("Title");
                    } else {
                        focusPreviousCell(column);
                    }

                    break;
                }

                // Moves focus one cell to the right. If focus is on the right-most cell in the
                // row, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowRight": {
                    if (event.target !== event.currentTarget) {
                        if (!isTextInputElement(event.target)) {
                            // If an arrow key event propagates to this point then prevent the default
                            // browser scroll but don't navigate.
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        focusCell(columns[columns.length - 1]!);
                    } else {
                        focusNextCell(column);
                    }
                    break;
                }

                // Moves focus one cell up. If focus is on the top cell in the column, focus
                // does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowUp": {
                    if (event.target !== event.currentTarget) {
                        if (!isTextInputElement(event.target)) {
                            // If an arrow key event propagates to this point then prevent the default
                            // browser scroll but don't navigate.
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        focusFirstVisibleTaskCell(column);
                    } else {
                        focusPreviousTaskCell(column);
                    }
                    break;
                }

                // Moves focus one cell down. If focus is on the bottom cell in the column,
                // focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowDown": {
                    if (event.target !== event.currentTarget) {
                        if (!isTextInputElement(event.target)) {
                            // If an arrow key event propagates to this point then prevent the default
                            // browser scroll but don't navigate.
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }

                    event.preventDefault();
                    event.stopPropagation();

                    if (isAppleDevice ? event.metaKey : event.ctrlKey) {
                        focusLastVisibleTaskCell(column);
                    } else {
                        focusNextTaskCell(column);
                    }
                    break;
                }

                // Moves focus down an author-determined number of rows, typically scrolling so
                // the bottom row in the currently visible set of rows becomes one of the first
                // visible rows. If focus is in the last row of the grid, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "PageDown": {
                    event.preventDefault();
                    event.stopPropagation();

                    if (assertExists(titleInputRef.current).isFocused()) {
                        focusLastVisibleTaskTitleEnd();
                    } else {
                        focusLastVisibleTaskCell(column);
                    }
                    break;
                }

                // Moves focus up an author-determined number of rows, typically scrolling so
                // the top row in the currently visible set of rows becomes one of the last
                // visible rows. If focus is in the first row of the grid, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "PageUp": {
                    event.preventDefault();
                    event.stopPropagation();

                    if (assertExists(titleInputRef.current).isFocused()) {
                        focusFirstVisibleTaskTitleStart();
                    } else {
                        focusFirstVisibleTaskCell(column);
                    }
                    break;
                }

                // Moves focus to the first cell in the row that contains focus.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // (We don't implement Ctrl+Home since we haven't implemented jumping to the
                // end of the grid and scrolling up.)
                case "Home": {
                    if (capabilities.hasColumns) {
                        event.preventDefault();
                        event.stopPropagation();

                        // Even though title isn't technically the first column, it's the first
                        // editable column so we put the user there.
                        focusCell("Title");
                    }
                    break;
                }

                // Moves focus to the last cell in the row that contains focus.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // (We don't implement Ctrl+Home since we haven't implemented jumping to the
                // end of the grid and scrolling up.)
                case "End": {
                    if (capabilities.hasColumns) {
                        event.preventDefault();
                        event.stopPropagation();

                        focusCell(columns[columns.length - 1]!);
                    }
                    break;
                }

                // `Enter`: Disables grid navigation and:
                //
                // - If the cell contains editable content, places focus in an input field,
                //   such as a textbox. If the input is a single-line text field, a subsequent
                //   press of `Enter` may either restore grid navigation functions or move
                //   focus to an input field in a neighboring cell.
                // - If the cell contains one or more widgets, places focus on the first
                //   widget.
                //
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "Enter": {
                    if (event.target !== event.currentTarget) break;

                    // Hitting enter on a button should activate the button.
                    if (event.target.tagName === "BUTTON" || event.target.role === "button") break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusCellInput(column);
                    break;
                }
            }
        },

        handleCellKeyDownCapture: (column: TaskGridViewColumn, event: KeyboardEvent) => {
            switch (event.key) {
                // Restores grid navigation. If content was being edited, it may also undo edits.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // Being in the `keydown` capture phase is essential. In case the cell input has
                // an `Escape` handler that simply closes a dropdown or blurs the input.
                case "Escape": {
                    // Only refocus the cell if we got this `keydown` from a child.
                    if (event.target === event.currentTarget) break;

                    // If we do not have columns then the title cell is not focusable.
                    if (!capabilities.hasColumns && column === "Title") break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusCell(column);
                    break;
                }
            }
        },

        // Commit an action transaction against our task. If this is a ghost task then
        // we'll create a new task before applying the update.
        commitActionTransactionEvenIfGhost: (
            getActions: (taskId: TaskId) => Array<TaskAction>,
            options?: {referencedCollections?: ReadonlyArray<TaskCollectionModel>},
        ): {
            finally: (callback: () => void) => void;
        } => {
            if (taskId) {
                return query.store.commitTaskActionTransaction(context, getActions(taskId), {
                    ...options,
                    undoManager,
                    affinityManager,
                });
            }

            assert(ghostTaskId);

            // Typing to create a task to replace the ghost row row only makes sense in a
            // manually sorted query. We don't have control of task order in an
            // auto-sorted query.
            //
            // We should not show a ghost row in a manually sorted query.
            assert(isQueryManuallySorted);

            // Make sure any state update from the `onGhostTaskCreated` callback runs in
            // the same React commit as our store updates (which use
            // `useSyncExternalStore()`).
            return runWithImmediatePriority(() => {
                disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(ghostTaskId);

                const commitPromise = query.store.commitTaskActionTransaction(
                    context,
                    [
                        {
                            type: "UpdateTask",
                            time: query.store.clock.now(),
                            taskId: ghostTaskId,
                            taskAction: {
                                type: "Create",
                                creatorId: currentAccount.id,
                                creatorTimeZone: timeZone,
                            },
                        },
                        ...getMoveTaskToQueryActions(ghostTaskId, {
                            type: isFirstRow ? "Start" : "End",
                        }),
                        ...getActions(ghostTaskId),
                    ],
                    {...options, undoManager, affinityManager},
                );

                // When we create a new task that occupies our ghost `TaskId` then we need to
                // regenerate a new ghost `TaskId` so there are no conflicts.
                onGhostTaskCreated?.();

                return commitPromise;
            });
        },
    });

    useImperativeHandle(ref, () => ({
        isFocusWithin,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
        focusCell,
        isFocusWithinCell,
    }));

    const containerRef = useRef<HTMLDivElement>(null);
    const [isHovered, hoverRef] = useHoverWithOverlaySupport();
    const mergedContainerRef = useMergedRefs<HTMLDivElement>(containerRef, hoverRef);

    const [isExpandButtonFocused, setIsExpandButtonFocused] = useState(false);

    // Checks if a user has confirmed a task can be completed
    const [taskCloseConfirmationState, setTaskCloseConfirmationState] = useState<{
        taskId: TaskId;
        onConfirm: () => void;
    } | null>(null);

    const contextMenuActions = (() => {
        const contextMenuActions: Array<ReadonlyArray<MenuAction>> = [];

        if (task) {
            contextMenuActions.push([
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy task link",
                    onPress: async () => {
                        const url = new URL(
                            `/s/${task.getSpaceId()}/tasks/${task.id}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ]);
        }

        if (!capabilities.isReadOnly) {
            if (task) {
                contextMenuActions.push(
                    getTaskStatusMenuActions({
                        context,
                        timeZone,
                        currentAccount,
                        store: query.store,
                        undoManager,
                        affinityManager,
                        task,
                        onCloseConfirmationDialogueOpen: ({onConfirm}) => {
                            setTaskCloseConfirmationState({taskId: task.id, onConfirm});
                        },
                    }),
                );
            }

            if (capabilities.hasDenseFields) {
                contextMenuActions.push([
                    {
                        label: task?.getAssignee() ? "Edit assignee" : "Add assignee",
                        onPress: () => {
                            assertExists(denseFieldsRef.current).focusAssigneeInput();
                        },
                    },
                    {
                        label: task?.getPriority() ? "Edit priority" : "Add priority",
                        onPress: () => {
                            assertExists(denseFieldsRef.current).focusPriorityInput();
                        },
                    },
                    {
                        label: task?.getDueDate() ? "Edit due date" : "Add due date",
                        onPress: () => {
                            assertExists(denseFieldsRef.current).focusDueDateInput();
                        },
                    },
                ]);
            }

            if (taskId !== null) {
                contextMenuActions.push([
                    {
                        label: "Delete",
                        onPress: () => deleteTaskAndAllChildren(),
                    },
                ]);
            }
        }

        return contextMenuActions;
    })();

    const [isTextInputWithinFocusedIfMobile, setIsTextInputWithinFocusedIfMobile] = useState(false);
    if (!isMobile && isTextInputWithinFocusedIfMobile) setIsTextInputWithinFocusedIfMobile(false);

    const handleFocusChange = (event: FocusEvent) => {
        setIsTextInputWithinFocusedIfMobile(
            !isInitialAppRender &&
                isMobile &&
                document.activeElement instanceof Element &&
                isTextInputElement(document.activeElement) &&
                event.currentTarget.contains(document.activeElement),
        );
    };

    // Is the entire row draggable after a long touch? True if the query is
    // manually sorted and we're on a mobile device.
    //
    // If we're in a mobile layout but the primary input can hover then there's
    // no affordance for reordering task rows. Must either be on a desktop
    // layout (so the drag handle is accessible) or be on a device without hover
    // affordance (to enable touch dragging).
    //
    // This is because touch dragging requires `<TaskRowTitleInput>` to be in
    // dual modality mode. Which is very inconvenient for devices with a mouse. So
    // we prefer normal input editing over touch dragging.
    const isDraggableAfterLongTouch =
        !canPrimaryInputHover && !capabilities.isReadOnly && isQueryManuallySorted && hasTask;

    const onManuallyActivateTouchSensorRef = useRef<((event: any) => void) | null>(null);

    useEffect(() => {
        if (!isDraggableAfterLongTouch) return;

        // If the row is focused and the keyboard is open then a long press won't start
        // a drag. The keyboard must close first. Instead long presses will perform
        // text selection.
        if (isTextInputWithinFocusedIfMobile) return;

        const containerElement = assertExists(containerRef.current);

        let touchState: {
            initialClientX: number;
            initialClientY: number;
            longTouchTimeout: Timeout | null;
        } | null = null;

        const handleTouchStart = (event: TouchEvent) => {
            touchState?.longTouchTimeout?.clear();
            touchState = null;

            if (event.touches.length > 1) return;

            // Emulate a `UILongPressGestureRecognizer` on iOS. Which [waits for a touch to
            // last 0.5 seconds][1] before firing.
            //
            // [1]: https://developer.apple.com/documentation/uikit/uilongpressgesturerecognizer/1616423-minimumpressduration
            const longTouchTimeout = createTimeout(() => {
                if (touchState?.longTouchTimeout === longTouchTimeout)
                    touchState.longTouchTimeout = null;

                // Unfocus whatever the focused element is to close the keyboard.
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }

                // NOCOMMIT: Haptic feedback when dragging starts and when dragging crosses
                // each task boundary.
                onManuallyActivateTouchSensorRef.current?.({nativeEvent: event});

                // Dispatch a `pointercancel` event so that any `usePress()` hooks cancel their
                // press when a drag starts. To see this work, on mobile try pressing on an
                // assignee avatar in a dense field long enough to start dragging. Then release
                // without moving the mouse. Without firing a `pointercancel` the assignee
                // input will open since `pointerup` is fired and `usePress()` calls `onPress`.
                //
                // `pointerup` will still be dispatched but since we dispatched `pointercancel`
                // first `usePress()` will have cancelled its press state.
                event.target?.dispatchEvent(new PointerEvent("pointercancel", event));
            }, 500);

            const touch = event.touches[0]!;

            touchState = {
                initialClientX: touch.clientX,
                initialClientY: touch.clientY,
                longTouchTimeout,
            };
        };

        const handleTouchEnd = () => {
            touchState?.longTouchTimeout?.clear();
            touchState = null;
        };

        const handleTouchMove = () => {
            touchState?.longTouchTimeout?.clear();
            if (touchState) touchState.longTouchTimeout = null;
        };

        const handleTouchCancel = () => {
            touchState?.longTouchTimeout?.clear();
            touchState = null;
        };

        containerElement.addEventListener("touchstart", handleTouchStart, {capture: true});
        containerElement.addEventListener("touchend", handleTouchEnd, {capture: true});
        containerElement.addEventListener("touchmove", handleTouchMove, {capture: true});
        containerElement.addEventListener("touchcancel", handleTouchCancel, {capture: true});

        // NOTE(calebmer): I've observed cases where `touchend` is not fired but
        // `pointerup` is. Perhaps this occurs if the touched element is removed from
        // the DOM? Listen to `pointerup` as a fallback for cancelling a long touch.
        containerElement.addEventListener("pointerup", handleTouchEnd, {capture: true});

        return () => {
            touchState?.longTouchTimeout?.clear();
            touchState = null;

            containerElement.removeEventListener("touchstart", handleTouchStart, {capture: true});
            containerElement.removeEventListener("touchend", handleTouchEnd, {capture: true});
            containerElement.removeEventListener("touchmove", handleTouchMove, {capture: true});
            containerElement.removeEventListener("touchcancel", handleTouchCancel, {capture: true});
            containerElement.removeEventListener("pointerup", handleTouchEnd, {capture: true});
        };
    }, [isDraggableAfterLongTouch, isTextInputWithinFocusedIfMobile]);

    const marginLeft: RemLength = `${
        !withoutPaddingLeft
            ? (isMobile ? mobileTaskRowViewIndentationRem : desktopTaskRowViewIndentationRem) *
                  parents.length +
              // On mobile we don't show the expand button, but if the query is auto-sorted
              // we still want to render row numbers in the expand button space.
              (!isMobile || canPrimaryInputHover
                  ? taskRowViewDragHandleWidthRem + taskRowViewExpandButtonWidthRem
                  : screenPaddingXRem.mobile +
                    // Hardcoded `spacing["2.5"]`
                    0.625) +
              (isMobile
                  ? mobileTaskRowViewStatusButtonWidthRem
                  : desktopTaskRowViewStatusButtonWidthRem)
            : screenPaddingXRem[isMobile ? "mobile" : "desktop"]
    }rem`;

    const borderCoverNode = (
        <div
            className={borderCoverClassName}
            style={{
                // Draw the top and bottom border with a shadow so it:
                //
                // 1. Doesn't add 2px to layout
                // 2. Adjacent borders share the same space so we don't get 2px dividers
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        />
    );

    const droppableIndentationsNode =
        !disableExpensiveFeaturesDuringScroll &&
        !capabilities.isReadOnly &&
        (isQueryManuallySorted || nextIndentation !== 0) &&
        cursor &&
        task &&
        renderTaskRowViewDroppableIndentations({
            query,
            cursor,
            task,
            parents,
            nextIndentation,
            areChildTasksExpanded,
            getMoveTaskToRootQueryActions,
            setRowZIndex,
        });

    const firstRowDroppableIndentationsNode = !disableExpensiveFeaturesDuringScroll &&
        !capabilities.isReadOnly &&
        isQueryManuallySorted &&
        isFirstRow &&
        cursor &&
        task && (
            <TaskRowViewDroppable
                indentation={0}
                nextAdjacentIndentation={null}
                previousAdjacentIndentation={null}
                isPositionedAbove={true}
                isVerticallyFlipped={true}
                getDropActions={taskId =>
                    getMoveTaskToRootQueryActions(taskId, {
                        type: "Above",
                        taskId: getTaskQuerySortCursorTaskId(cursor),
                    })
                }
                setRowZIndex={setRowZIndex}
            />
        );

    const marginRightOutOfBoundsClickSelectionProps = useOutOfBoundsClickSelection({
        isDisabled: capabilities.isReadOnly,
        onSelect: focusTitleEnd,
        onSelectAll: focusTitleAll,
    });

    const node = (
        <div
            ref={!capabilities.hasDenseFields ? mergedContainerRef : undefined}
            data-testid={
                process.env.NODE_ENV !== "production" && !capabilities.hasDenseFields
                    ? `TaskRowView:${effectiveTaskId}`
                    : undefined
            }
            data-indentation={!capabilities.hasDenseFields ? parents.length : undefined}
            style={{
                width: !capabilities.hasDenseFields ? "100%" : undefined,
                maxWidth:
                    !capabilities.hasDenseFields && rowMaxWidth !== null
                        ? spacing[rowMaxWidth]
                        : undefined,
                margin: !capabilities.hasDenseFields ? "0 auto" : undefined,
                minHeight: spacing[taskRowViewMinHeight],
                position: "relative",
                zIndex: "0",
                // Important not to set `overflow="hidden"` here so that the collections overlay
                // we open in edit mode can render outside the bounds of the row.
                overflow: undefined,
                display: "flex",
            }}
            onFocus={!capabilities.hasDenseFields ? handleFocusChange : undefined}
            onBlur={!capabilities.hasDenseFields ? handleFocusChange : undefined}
        >
            {!capabilities.hasDenseFields && borderCoverNode}
            <div
                className={classNames(
                    marginLeftContainerClassName,
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    !capabilities.isReadOnly && tasksStyles.textCursorNotInheritedClassName,
                )}
                style={{width: marginLeft}}
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
                    onSelect: focusTitleStart,
                    onSelectAll: focusTitleAll,
                })}
            >
                {!disableExpensiveFeaturesDuringScroll && isDraggableAfterLongTouch && (
                    <TaskRowViewDragAfterLongTouchController
                        undoManager={undoManager}
                        affinityManager={affinityManager}
                        parents={parents}
                        // If `hasTask` is true then `cursor` will be non-null.
                        cursor={cursor!}
                        task={task}
                        getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
                        onManuallyActivateTouchSensorRef={onManuallyActivateTouchSensorRef}
                    />
                )}
                {!withoutPaddingLeft &&
                    (!isMobile || (hasTask && !isQueryManuallySorted)) &&
                    (!disableExpensiveFeaturesDuringScroll &&
                    !capabilities.isReadOnly &&
                    !isDraggableAfterLongTouch &&
                    isQueryManuallySorted &&
                    hasTask ? (
                        <TaskRowViewDragHandle
                            undoManager={undoManager}
                            affinityManager={affinityManager}
                            parents={parents}
                            // If `hasTask` is true then `cursor` will be non-null.
                            cursor={cursor!}
                            task={task}
                            getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
                            isHovered={isHovered}
                        />
                    ) : (
                        <div
                            className={
                                !canPrimaryInputHover
                                    ? dragHandleContainerIfPrimaryInputCanNotHoverClassName
                                    : dragHandleContainerClassName
                            }
                        >
                            {hasTask && !isQueryManuallySorted && (
                                <div className={tasksStyles.rowNumberClassName} />
                            )}
                        </div>
                    ))}
                {!withoutPaddingLeft &&
                    // If the primary input can't hover, don't render expand button. That way user
                    // can't tap in that general location to hit the button.
                    canPrimaryInputHover &&
                    (!disableExpensiveFeaturesDuringScroll && hasTask ? (
                        <div
                            className={expandButtonContainerClassName}
                            style={{opacity: isHovered || isExpandButtonFocused ? 1 : 0}}
                        >
                            <IconButton
                                ref={expandButtonRef}
                                // Expand button is not tab focusable. Keyboard navigation within a task grid is
                                // not done with tab navigation.
                                isTabbable={false}
                                // Don't show the tooltip when focused through keyboard navigation. It's a
                                // little distracting to see it move as you arrow key up/down.
                                isTooltipVisibleWhenFocused={false}
                                size="xs"
                                description="Open"
                                pressErrorTitle="Couldn’t open task"
                                onPress={async () => {
                                    await navigate(`/s/${task.getSpaceId()}/tasks/${task.id}`);

                                    // After opening a task, don't continue to think the expand button is focused.
                                    setIsExpandButtonFocused(false);
                                }}
                                onFocusChange={setIsExpandButtonFocused}
                                onKeyDown={event => handleCellKeyDown("ExpandButton", event)}
                                onKeyDownCapture={event =>
                                    handleCellKeyDownCapture("ExpandButton", event)
                                }
                            >
                                <ArrowsOutSimple />
                            </IconButton>
                        </div>
                    ) : (
                        <div className={expandButtonContainerClassName} />
                    ))}
                {!withoutPaddingLeft && (
                    <div
                        className={
                            isMobile
                                ? mobileStatusButtonContainerClassName
                                : desktopStatusButtonContainerClassName
                        }
                    >
                        {hasTask ? (
                            <TaskStatusButton
                                ref={statusButtonRef}
                                store={query.store}
                                undoManager={undoManager}
                                affinityManager={affinityManager}
                                size={isMobile ? "5" : "4"}
                                task={task}
                                // Disable the ability to tab to this button. Since there are so many tasks and
                                // the `Tab` keyboard shortcut indents a task, we don't rely on `Tab` for focus
                                // navigation.
                                isFocusable={true}
                                isTabbable={false}
                                isDisabled={capabilities.isReadOnly}
                                onKeyDown={event => handleCellKeyDown("StatusButton", event)}
                                onKeyDownCapture={event =>
                                    handleCellKeyDownCapture("StatusButton", event)
                                }
                                // Small UX detail that makes (I feel) a big difference. When you press the
                                // status button to close a task, after releasing the task immediately animates
                                // out if the query's filters don't allow closed tasks. This may confuse a user.
                                // Why did the task do that? Where'd it go?
                                //
                                // If the user is in a query where closed tasks are filtered out we show the
                                // closed check when the user presses down on the status button. This way we
                                // briefly show them what the new state of their task will be. And give them
                                // the satisfaction of seeing a closed task.
                                shouldShowClosedStatusWhenPressed={
                                    !query.filters.displayStatusFilter.ifClosed
                                }
                                onCloseConfirmationDialogueOpen={({onConfirm}) => {
                                    setTaskCloseConfirmationState({
                                        taskId: task.id,
                                        onConfirm,
                                    });
                                }}
                            />
                        ) : (
                            <div
                                className={
                                    isMobile
                                        ? mobileStatusButtonContainerClassName
                                        : desktopStatusButtonContainerClassName
                                }
                            >
                                <div
                                    className={
                                        isMobile
                                            ? mobilePlaceholderStatusButtonClassName
                                            : desktopPlaceholderStatusButtonClassName
                                    }
                                />
                            </div>
                        )}
                    </div>
                )}
            </div>
            <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
                <div
                    ref={titleCellRef}
                    data-testid={
                        process.env.NODE_ENV !== "production" ? "TaskRowTitleCell" : undefined
                    }
                    tabIndex={capabilities.hasColumns ? (isFirstRow ? 0 : -1) : undefined}
                    className={titleCellClassName}
                    onKeyDown={event => {
                        switch (event.key) {
                            case "Backspace":
                            case "Delete": {
                                if (event.currentTarget === event.target) {
                                    event.preventDefault();
                                    event.stopPropagation();

                                    if (!capabilities.isReadOnly) {
                                        const titleInput = assertExists(titleInputRef.current);

                                        if (titleInput.isEmpty()) {
                                            deleteTaskAndAllChildrenAndFocusPreviousRow();
                                        } else {
                                            titleInput.clear();
                                        }
                                    }
                                }
                                break;
                            }
                            default: {
                                handleCellKeyDown("Title", event);
                                break;
                            }
                        }
                    }}
                    onKeyDownCapture={event => handleCellKeyDownCapture("Title", event)}
                >
                    <TaskRowTitleInput
                        ref={titleInputRef}
                        capabilities={capabilities}
                        maxGridExpandableTaskDepth={maxGridExpandableTaskDepth}
                        stateKey={stateKey}
                        query={query}
                        task={task}
                        onTitleChange={onTitleChange}
                        placeholder={titlePlaceholder}
                        indentation={parents.length}
                        paddingRight={
                            capabilities.hasColumns
                                ? taskRowViewFirstColumnExtraPaddingLeft
                                : undefined
                        }
                        parentTaskEntryStore={parentTaskEntryStore}
                        areChildTasksExpanded={areChildTasksExpanded}
                        onAreChildTasksExpandedToggle={onAreChildTasksExpandedToggle}
                        createTaskAbove={createTaskAbove}
                        createTaskBelowAndFocus={createTaskBelowAndFocus}
                        nestWithPreviousTaskRowIfExistsAndExpand={
                            nestWithPreviousTaskRowIfExistsAndExpand
                        }
                        unnestTaskIfNestedRow={unnestTaskIfNestedRow}
                        deleteTaskAndAllChildrenAndFocusPreviousRow={
                            deleteTaskAndAllChildrenAndFocusPreviousRow
                        }
                        focusNextTaskTitleCoord={focusNextTaskTitleCoord}
                        focusPreviousTaskTitleCoord={focusPreviousTaskTitleCoord}
                        preserveLastTaskTitleArrowNavigationCoord={
                            preserveLastTaskTitleArrowNavigationCoord
                        }
                        focusFirstVisibleTaskTitleStart={focusFirstVisibleTaskTitleStart}
                        focusLastVisibleTaskTitleEnd={focusLastVisibleTaskTitleEnd}
                        focusNextCell={() => focusNextCell("Title")}
                        focusPreviousCell={() => focusPreviousCell("Title")}
                        pushUndoStackYDocEntry={pushUndoStackYDocEntry}
                        pushUndoStackYDocEntryFromRedo={pushUndoStackYDocEntryFromRedo}
                        pushRedoStackYDocEntry={pushRedoStackYDocEntry}
                    />
                </div>
            </FocusRing>
            {capabilities.hasColumns && (
                <>
                    <TaskRowAssigneeCell
                        ref={assigneeCellRef}
                        isReadOnly={capabilities.isReadOnly}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        isFirstRow={isFirstRow}
                        onCellKeyDown={handleCellKeyDown}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                        commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                    />
                    <TaskRowPriorityCell
                        ref={priorityCellRef}
                        isReadOnly={capabilities.isReadOnly}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        onCellKeyDown={handleCellKeyDown}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                        commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                    />
                    <TaskRowDueDateCell
                        ref={dueDateCellRef}
                        isReadOnly={capabilities.isReadOnly}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        onCellKeyDown={handleCellKeyDown}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                        commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                    />
                    <TaskRowCollectionsCell
                        ref={collectionsCellRef}
                        isReadOnly={capabilities.isReadOnly}
                        query={query}
                        undoManager={undoManager}
                        affinityManager={affinityManager}
                        task={task}
                        onCellKeyDown={handleCellKeyDown}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusPreviousCell={focusPreviousCell}
                        setRowZIndex={setRowZIndex}
                        commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                    />
                </>
            )}
            <div
                style={{
                    flexShrink: 0,
                    width: spacing["5"],
                    // Create an illusion that the text editor extends into the margins by giving
                    // the margin a text cursor and making it clickable putting focus in the task.
                    // A double click selects the task text.
                    //
                    // This is an affordance for mouse users, does not need to be usable
                    // by keyboard.
                    cursor: capabilities.hasColumns
                        ? undefined
                        : !capabilities.isReadOnly
                        ? "text"
                        : undefined,
                    pointerEvents: capabilities.hasColumns ? "none" : undefined,
                }}
                {...marginRightOutOfBoundsClickSelectionProps}
            />
            {!capabilities.hasDenseFields && firstRowDroppableIndentationsNode}
            {!capabilities.hasDenseFields && droppableIndentationsNode}
        </div>
    );

    return (
        <>
            <ContextMenuActions actions={contextMenuActions}>
                {!capabilities.hasDenseFields ? (
                    node
                ) : (
                    <div
                        ref={mergedContainerRef}
                        data-testid={
                            process.env.NODE_ENV !== "production"
                                ? `TaskRowView:${effectiveTaskId}`
                                : undefined
                        }
                        data-indentation={parents.length}
                        style={{
                            width: "100%",
                            maxWidth: rowMaxWidth !== null ? spacing[rowMaxWidth] : undefined,
                            minHeight: spacing[taskRowViewMinHeight],
                            margin: "0 auto",
                            position: "relative",
                            zIndex: "0",
                            backgroundColor: colorSchemeVars["grey-0"],
                        }}
                        onFocus={handleFocusChange}
                        onBlur={handleFocusChange}
                    >
                        {borderCoverNode}
                        {node}
                        <TaskRowViewDenseFields
                            // NOTE(calebmer): This component is not rendered by a fullscreen grid view
                            // which may have many, many tasks. So we haven't spent time optimizing it yet.
                            // However, if tasks with many children are common this component may slow
                            // us down.
                            ref={denseFieldsRef}
                            isReadOnly={capabilities.isReadOnly}
                            store={query.store}
                            task={task}
                            marginLeft={marginLeft}
                            focusTitleStart={focusTitleStart}
                            focusTitleEnd={focusTitleEnd}
                            focusTitleAll={focusTitleAll}
                            commitActionTransactionEvenIfGhost={commitActionTransactionEvenIfGhost}
                        />
                        {firstRowDroppableIndentationsNode}
                        {droppableIndentationsNode}
                    </div>
                )}
            </ContextMenuActions>
            {withPaddingBottom && (
                <TaskRowViewPaddingBottom
                    capabilities={capabilities}
                    focusTitleEnd={focusTitleEnd}
                    focusTitleAll={focusTitleAll}
                />
            )}
            {!isInitialAppRender && isMobile && isTextInputWithinFocusedIfMobile && (
                <TaskGridViewMobileKeyboardToolbar
                    portalRef={mobileKeyboardToolbarPortalRef}
                    maxGridExpandableTaskDepth={maxGridExpandableTaskDepth}
                    task={task}
                    parents={parents}
                    isQueryManuallySorted={isQueryManuallySorted}
                    isFirstTaskInQuery={isFirstTaskInQuery}
                    titleInputRef={titleInputRef}
                    nestWithPreviousTaskRowIfExistsAndExpand={
                        nestWithPreviousTaskRowIfExistsAndExpand
                    }
                    unnestTaskIfNestedRow={unnestTaskIfNestedRow}
                    focusAssigneeInput={() => {
                        if (!capabilities.hasDenseFields) return;
                        assertExists(denseFieldsRef.current).focusAssigneeInput();
                    }}
                    focusPriorityInput={() => {
                        if (!capabilities.hasDenseFields) return;
                        assertExists(denseFieldsRef.current).focusPriorityInput();
                    }}
                    focusDueDateInput={() => {
                        if (!capabilities.hasDenseFields) return;
                        assertExists(denseFieldsRef.current).focusDueDateInput();
                    }}
                />
            )}
            {taskCloseConfirmationState && (
                <TaskCloseConfirmationModalDialog
                    store={query.store}
                    taskId={taskCloseConfirmationState.taskId}
                    onClose={() => setTaskCloseConfirmationState(null)}
                    onConfirm={taskCloseConfirmationState.onConfirm}
                />
            )}
        </>
    );
}

function TaskRowViewDragHandle({
    undoManager,
    affinityManager,
    parents,
    cursor,
    task,
    getMaybeRemoveTaskFromQueryActions,
    isHovered,
}: {
    undoManager: TaskClientStoreUndoManager;
    affinityManager: TaskClientStoreSearchAffinityManager;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    cursor: TaskQuerySortCursor;
    task: TaskModel;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    isHovered: boolean;
}) {
    const [isDragHandlePressed, setIsDragHandlePressed] = useState(false);

    // When drag state updates, only re-render `<TaskRowViewDragHandle>`s. Not
    // every row.
    const {
        attributes: draggableAttributes,
        listeners: {
            // @ts-expect-error: Added by `TouchSensorWithManualActivation` but TypeScript
            // doesn't know about it.
            onManuallyActivateTouchSensor,
            ...draggableListeners
        },
        setNodeRef: setDraggableNodeRef,
    } = useDraggable({
        id: useId(),
        data: cast<TaskGridViewDraggableData>({
            type: "Row",
            undoManager,
            affinityManager,
            parents,
            cursor,
            taskId: task.id,
            displayStatus: task.getDisplayStatus(),
            assigneeAccountId: task.getAssignee()?.assignee.accountId ?? null,
            title: task.getTitle(),
            getDropOnRowActions: getMaybeRemoveTaskFromQueryActions,
            overlayPlacement: "ActivatorNode",
        }),
    });

    return (
        <div className={dragHandleContainerClassName} style={{opacity: isHovered ? 1 : 0}}>
            <FocusRing>
                <button
                    {...mergeProps(draggableAttributes, draggableListeners ?? {}, {
                        onPointerDown: () => setIsDragHandlePressed(true),
                        onPointerUp: () => setIsDragHandlePressed(false),
                        onPointerOut: () => setIsDragHandlePressed(false),
                        onPointerCancel: () => setIsDragHandlePressed(false),
                    })}
                    ref={setDraggableNodeRef}
                    className={sprinkles({
                        display: "block",
                        width: "4",
                        height: "4",
                        padding: "0.5",
                        borderRadius: "full",
                        // Dragging doesn't activate until the mouse moves. Set the grabbing cursor
                        // immediately on press.
                        cursor: isDragHandlePressed ? "grabbing" : "grab",
                    })}
                    // Drag handle is not tab focusable. Keyboard navigation within a task grid is
                    // not done with tab navigation.
                    tabIndex={-1}
                >
                    <DotsSixVertical size={spacing["3"]} />
                </button>
            </FocusRing>
        </div>
    );
}

function TaskRowViewDragAfterLongTouchController({
    undoManager,
    affinityManager,
    parents,
    cursor,
    task,
    getMaybeRemoveTaskFromQueryActions,
    onManuallyActivateTouchSensorRef,
}: {
    undoManager: TaskClientStoreUndoManager;
    affinityManager: TaskClientStoreSearchAffinityManager;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    cursor: TaskQuerySortCursor;
    task: TaskModel;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    onManuallyActivateTouchSensorRef: RefObject<((event: any) => void) | null>;
}) {
    // When drag state updates, only re-render
    // `<TaskRowViewDragAfterLongTouchController>`s. Not every row component.
    // That's why we have this controller component instead of putting the
    // `useDraggable()` hook directly in `<TaskRowView>`.
    const {
        listeners: {
            // @ts-expect-error: Added by `TouchSensorWithManualActivation` but TypeScript
            // doesn't know about it.
            onManuallyActivateTouchSensor,
        },
        setNodeRef: setDraggableNodeRef,
    } = useDraggable({
        id: useId(),
        data: cast<TaskGridViewDraggableData>({
            type: "Row",
            undoManager,
            affinityManager,
            parents,
            cursor,
            taskId: task.id,
            displayStatus: task.getDisplayStatus(),
            assigneeAccountId: task.getAssignee()?.assignee.accountId ?? null,
            title: task.getTitle(),
            getDropOnRowActions: getMaybeRemoveTaskFromQueryActions,
            overlayPlacement: "ActivatorTouch",
        }),
    });

    useImperativeHandle(onManuallyActivateTouchSensorRef, () => onManuallyActivateTouchSensor, [
        onManuallyActivateTouchSensor,
    ]);

    // We need a DOM element for `@dnd-kit/core` to be able to correctly position
    // our drag overlay. Render it at the beginning of our margin left with 0
    // width. The user should not be able to interact with this element, it should
    // only be used for spacing.
    return (
        <div
            ref={setDraggableNodeRef}
            style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: 0,
                width: 0,
            }}
        />
    );
}

function TaskRowViewPaddingBottom({
    capabilities,
    focusTitleEnd,
    focusTitleAll,
}: {
    capabilities: TaskGridViewCapabilities;
    focusTitleEnd: () => void;
    focusTitleAll: () => void;
}) {
    const isMobile = useIsMobile();

    return (
        <div
            className={paddingBottomClassName}
            style={{
                cursor: !capabilities.isReadOnly ? "text" : undefined,
                height: isMobile
                    ? `calc(var(--safe-area-inset-bottom, 0px) + ${spacing[paddingBottomHeight]})`
                    : undefined,
            }}
            {...useOutOfBoundsClickSelection({
                isDisabled: capabilities.isReadOnly,
                onSelect: focusTitleEnd,
                onSelectAll: focusTitleAll,
            })}
        />
    );
}
