import {useDraggable} from "@dnd-kit/core";
import classNames from "classnames";
import {ArrowsOutSimple, DotsSixVertical} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {
    KeyboardEvent,
    Ref,
    forwardRef,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {usePeekContext} from "~/client/peek/peek_remix_embed.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewDraggableData} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
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
import {TaskRowViewDroppableIndentations} from "~/client/tasks/internal/task_row_view_droppable_indentations.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    taskRowViewFirstColumnExtraPaddingLeft,
    taskRowViewMinHeight,
} from "~/client/tasks/task_row_shared_styles.js";
import {Context} from "~/shared/context/context.js";
import {RemLength, addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key.js";
import {generateId} from "~/shared/id/id.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    sprinkles,
    tasksStyles,
} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {emptyTaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {
    TaskQuerySortCursor,
    getTaskQuerySortCursorTaskId,
} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskTitleUpdate} from "~/shared/tasks/task_title.js";

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
    isTitleFocused(): boolean;
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitleCoord(coord: number, side: "top" | "bottom"): void;
    focusTitleSelection(selection: Selection): void;
    focusCell(column: TaskGridViewColumn): void;
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

const borderCoverClassName = sprinkles({
    position: "absolute",
    zIndex: "-10",
    top: "0",
    bottom: "0",
    left: "5",
    right: "5",
    pointerEvents: "none",
});

const marginLeftContainerClassName = sprinkles({
    position: "relative",
    flexShrink: "0",
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    height: taskRowViewMinHeight,
});

const placeholderStatusButtonClassName = sprinkles({
    width: "4",
    height: "4",
    borderRadius: "full",
    border: "grey-10",
    pointerEvents: "none",
});

const titleCellClassName = sprinkles({
    flexGrow: "1",
    overflow: "hidden",
});

const paddingBottomClassName = sprinkles({
    width: "full",
    height: "5",
    pointerEvents: "none",
});

function TaskRowView(
    {
        capabilities,
        query,
        cursor,
        ghostTaskId = null,
        onGhostTaskCreated,
        parents,
        disableExpensiveFeaturesDuringScroll,
        isFirstRow,
        titlePlaceholder,
        nextIndentation,
        areChildTasksExpandedStore,
        onAreChildTasksExpandedToggle,
        withoutPaddingLeft,
        withPaddingBottom,
        getMoveTaskToQueryActions,
        getMoveTaskToRootQueryActions,
        getMaybeRemoveTaskFromQueryActions,
        nestWithPreviousTaskRowIfExistsAndExpand,
        unnestTaskIfNestedRow,
        deleteTaskAndAllChildren,
        deleteTaskAndAllChildrenAndFocusPreviousRow,
        focusTaskTitleStart,
        focusNextTaskTitleCoord,
        focusPreviousTaskTitleCoord,
        focusNextTaskCell,
        focusPreviousTaskCell,
        preserveLastTaskTitleArrowNavigationCoord,
        focusFirstVisibleTaskTitleStart,
        focusLastVisibleTaskTitleEnd,
    }: {
        capabilities: TaskGridViewCapabilities;
        query: TaskClientQuery;
        cursor: TaskQuerySortCursor | null;
        ghostTaskId?: TaskId | null;
        onGhostTaskCreated?: () => void;
        parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
        disableExpensiveFeaturesDuringScroll: boolean;
        isFirstRow: boolean;
        nextIndentation: number;
        titlePlaceholder?: string;
        // NOCOMMIT:
        // allCollections: ReadonlyArray<LocalTaskCollection>;
        // collections: ReadonlyArray<LocalTaskCollection>;
        // createCollectionAndAddToTask: (collection: {
        //     id: LocalTaskCollectionId;
        //     name: string;
        //     color: ThemeColor;
        // }) => void;
        // addCollectionToTask: (collectionId: LocalTaskCollectionId) => void;
        // removeCollectionFromTask: (collectionId: LocalTaskCollectionId) => void;
        // isEditingCollections: boolean;
        // onEditingCollectionsChange: (isEditingCollections: boolean) => void;
        // editingCollectionsContainerRef: RefCallback<HTMLElement> | null;
        areChildTasksExpandedStore: Store<true | undefined>;
        onAreChildTasksExpandedToggle: () => void;
        withoutPaddingLeft?: boolean;
        withPaddingBottom?: boolean;
        getMoveTaskToQueryActions: (
            taskId: TaskId,
            position:
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskAction>;
        getMoveTaskToRootQueryActions: (
            taskId: TaskId,
            position:
                | {type: "End"}
                | {type: "Above"; taskId: TaskId}
                | {type: "Below"; taskId: TaskId},
        ) => Array<TaskAction>;
        getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
        nestWithPreviousTaskRowIfExistsAndExpand: (titleSelection: Selection) => void;
        unnestTaskIfNestedRow: (titleSelection: Selection) => void;
        deleteTaskAndAllChildren: (options: {withConfirmation: boolean}) => void;
        deleteTaskAndAllChildrenAndFocusPreviousRow: (options: {withConfirmation: boolean}) => void;
        focusTaskTitleStart: (taskKey: TaskGridViewTaskKey) => void;
        focusNextTaskTitleCoord: (coord: number) => void;
        focusPreviousTaskTitleCoord: (coord: number) => void;
        focusNextTaskCell: (column: TaskGridViewColumn) => void;
        focusPreviousTaskCell: (column: TaskGridViewColumn) => void;
        preserveLastTaskTitleArrowNavigationCoord: () => void;
        focusFirstVisibleTaskTitleStart: () => void;
        focusLastVisibleTaskTitleEnd: () => void;
    },
    ref: Ref<TaskRowViewRef>,
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

    // Either `cursor` or `ghostTaskId` should be provided. This component
    // transitions from a ghost task to a regular task when the user enters data.
    assert(cursor !== null ? ghostTaskId === null : ghostTaskId !== null);

    const navigate = useNavigate();
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const peekContext = usePeekContext();
    const peekStackContext = usePeekStackContext();

    const taskId = cursor !== null ? getTaskQuerySortCursorTaskId(cursor) : null;
    const taskEntry = useStore(taskId !== null ? query.getLoadedTaskEntryStore(taskId) : null);
    const task = taskEntry?.task ?? null;

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
        pendingActionTransactionBuilder: {
            add: (titleUpdate: TaskTitleUpdate) => void;
            commit: (context: Context<{rpc: RpcContextModuleBase}>) => {
                finally: (callback: () => void) => void;
            };
        } | null;
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
                        assertExists(taskId ?? ghostTaskId),
                        titleUpdate,
                    );
            }
            return;
        }

        if (taskId) {
            const time = query.store.clock.now();

            const commitPromise = query.store.commitTaskActionTransaction(context, [
                {
                    type: "UpdateTask",
                    time,
                    taskId,
                    taskAction: {
                        type: "UpdateTitle",
                        titleUpdate,
                    },
                },
            ]);

            handleCommitPromise(commitPromise);
        } else {
            assert(ghostTaskId);

            // Make sure any state update from the `onGhostTaskCreated` callback runs in
            // the same React commit as our store updates (which use
            // `useSyncExternalStore()`).
            runWithImmediatePriority(() => {
                const commitPromise = query.store.commitTaskActionTransaction(context, [
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
                    {
                        type: "UpdateTask",
                        time: query.store.clock.now(),
                        taskId: ghostTaskId,
                        taskAction: {
                            type: "UpdateTitle",
                            titleUpdate,
                        },
                    },
                    ...getMoveTaskToQueryActions(ghostTaskId, {type: "End"}),
                ]);

                handleCommitPromise(commitPromise);

                // When we create a new task that occupies our ghost `TaskId` then we need to
                // regenerate a new ghost `TaskId` so there are no conflicts.
                onGhostTaskCreated?.();
            });
        }
    };

    const expandButtonRef = useRef<HTMLButtonElement>(null);
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
        isTitleFocused,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
        focusCell,
        focusCellInput,
        focusNextCell,
        focusPreviousCell,
        handleCellKeyDownCapture,
    } = useEvents({
        isTitleFocused: () => assertExists(titleInputRef.current).isFocused(),

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

        focusCell: (column: TaskGridViewColumn) => {
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
                    // If we have no columns then directly focus the title input.
                    if (!capabilities.hasColumns) {
                        assertExists(titleInputRef.current).focusStart();
                    } else {
                        assertExists(titleCellRef.current).focus();
                    }
                    return;
                }
                case "Assignee": {
                    assertExists(assigneeCellRef.current).focusCell();
                    return;
                }
                case "Priority": {
                    assertExists(priorityCellRef.current).focusCell();
                    return;
                }
                case "DueDate": {
                    assertExists(dueDateCellRef.current).focusCell();
                    return;
                }
                case "Collections": {
                    assertExists(collectionsCellRef.current).focusCell();
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
        // Should be called in the capture phase of event handling.
        handleCellKeyDownCapture: (column: TaskGridViewColumn, event: KeyboardEvent) => {
            switch (event.key) {
                // Moves focus one cell to the left. If focus is on the left-most cell in the
                // row, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowLeft": {
                    if (event.target !== event.currentTarget) break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusPreviousCell(column);
                    break;
                }

                // Moves focus one cell to the right. If focus is on the right-most cell in the
                // row, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowRight": {
                    if (event.target !== event.currentTarget) break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusNextCell(column);
                    break;
                }

                // Moves focus one cell up. If focus is on the top cell in the column, focus
                // does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowUp": {
                    if (event.target !== event.currentTarget) break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusPreviousTaskCell(column);
                    break;
                }

                // Moves focus one cell down. If focus is on the bottom cell in the column,
                // focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "ArrowDown": {
                    if (event.target !== event.currentTarget) break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusNextTaskCell(column);
                    break;
                }

                // Moves focus down an author-determined number of rows, typically scrolling so
                // the bottom row in the currently visible set of rows becomes one of the first
                // visible rows. If focus is in the last row of the grid, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "PageDown": {
                    // NOCOMMIT
                    break;
                }

                // Moves focus up an author-determined number of rows, typically scrolling so
                // the top row in the currently visible set of rows becomes one of the last
                // visible rows. If focus is in the first row of the grid, focus does not move.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                case "PageUp": {
                    // NOCOMMIT
                    break;
                }

                // Moves focus to the first cell in the row that contains focus.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // (We don't implement Ctrl+Home since we haven't implemented jumping to the
                // end of the grid and scrolling up.)
                case "Home": {
                    // NOCOMMIT
                    break;
                }

                // Moves focus to the last cell in the row that contains focus.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // (We don't implement Ctrl+Home since we haven't implemented jumping to the
                // end of the grid and scrolling up.)
                case "End": {
                    // NOCOMMIT
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

                // Restores grid navigation. If content was being edited, it may also undo edits.
                // https://www.w3.org/WAI/ARIA/apg/patterns/grid/
                //
                // Being in the `keydown` capture phase is essential. In case the cell input has
                // an `Escape` handler that simply closes a dropdown or blurs the input.
                case "Escape": {
                    // Only refocus the cell if we got this `keydown` from a child.
                    if (event.target === event.currentTarget) break;

                    event.preventDefault();
                    event.stopPropagation();

                    focusCell(column);
                    break;
                }
            }
        },
    });

    useImperativeHandle(ref, () => ({
        isTitleFocused,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
        focusCell,
    }));

    const [isHovered, hoverRef] = useHoverWithOverlaySupport();

    const [isExpandButtonFocused, setIsExpandButtonFocused] = useState(false);

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
                        task,
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
                        onPress: () => deleteTaskAndAllChildren({withConfirmation: true}),
                    },
                ]);
            }
        }

        return contextMenuActions;
    })();

    const createTaskAbove = () => {
        const newTaskId = generateId<TaskId>();

        query.store.commitTaskActionTransaction(context, [
            {
                type: "UpdateTask",
                time: query.store.clock.now(),
                taskId: newTaskId,
                taskAction: {
                    type: "Create",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                },
            },
            ...getMoveTaskToQueryActions(
                newTaskId,
                taskId ? {type: "Above", taskId} : {type: "End"},
            ),
        ]);
    };

    const createTaskBelowAndFocus = () => {
        const newTaskId = generateId<TaskId>();

        // If we have a task with children, the children are expanded, and the children
        // are loaded then to create a task below this task we need to create it as the
        // first child of this task.
        //
        // Otherwise we fall down to the branch below and create a task below ours in
        // our query.
        if (task && task.getChildTaskCount() > 0 && areChildTasksExpanded) {
            const childrenQuery = query.store.getTaskChildrenQueryStore(task.id).getSnapshot();
            if (childrenQuery && childrenQuery.loadedStateStore.getSnapshot() !== "Unloaded") {
                const time1 = query.store.clock.now();
                const time2 = query.store.clock.now();
                const time3 = query.store.clock.now();

                let position: TaskPosition = {
                    orderTime: time3,
                    orderKey: initialOrderKey,
                };

                const firstChildCursor = childrenQuery.taskOrderStore.getSnapshot().begin.key;

                const firstChildPosition = firstChildCursor
                    ? childrenQuery
                          .getLoadedTaskSnapshot(getTaskQuerySortCursorTaskId(firstChildCursor))
                          .getParent()?.position
                    : null;

                if (firstChildPosition) {
                    position = {
                        orderTime: firstChildPosition.orderTime,
                        orderKey: generateOrderKeyBetween(null, firstChildPosition.orderKey),
                    };
                }

                query.store.commitTaskActionTransaction(context, [
                    {
                        type: "UpdateTask",
                        time: time1,
                        taskId: newTaskId,
                        taskAction: {
                            type: "Create",
                            creatorId: currentAccount.id,
                            creatorTimeZone: timeZone,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time2,
                        taskId: newTaskId,
                        taskAction: {
                            type: "UpdateParentTaskId",
                            parentTaskId: taskId,
                        },
                    },
                    {
                        type: "UpdateTask",
                        time: time3,
                        taskId: newTaskId,
                        taskAction: {
                            type: "UpdateParentPosition",
                            parentPosition: position,
                        },
                    },
                ]);

                // Store updates are rendered by React immediately. So focus our task before
                // the next paint.
                requestAnimationFrame(() => {
                    if (parents.length === 0) {
                        focusTaskTitleStart(`${task.id}-${newTaskId}`);
                    } else {
                        focusTaskTitleStart(
                            `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${newTaskId}`,
                        );
                    }
                });
                return;
            }
        }

        query.store.commitTaskActionTransaction(context, [
            {
                type: "UpdateTask",
                time: query.store.clock.now(),
                taskId: newTaskId,
                taskAction: {
                    type: "Create",
                    creatorId: currentAccount.id,
                    creatorTimeZone: timeZone,
                },
            },
            ...getMoveTaskToQueryActions(
                newTaskId,
                taskId ? {type: "Below", taskId} : {type: "End"},
            ),
        ]);

        // Store updates are rendered by React immediately. So focus our task before
        // the next paint.
        requestAnimationFrame(() => {
            if (parents.length === 0) {
                focusTaskTitleStart(newTaskId);
            } else {
                focusTaskTitleStart(
                    `${getTaskQuerySortCursorTaskId(parents[0]!.cursor)}-${newTaskId}`,
                );
            }
        });
    };

    const marginLeft: RemLength = `${
        parseRemLengthNumber(spacing["5"]) +
        (!withoutPaddingLeft
            ? parseRemLengthNumber(spacing["5"]) +
              parseRemLengthNumber(spacing["6"]) +
              parseRemLengthNumber(contentSchemaStyles.listItemIndentation) * parents.length
            : 0)
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

    const droppableIndentationsNode = !disableExpensiveFeaturesDuringScroll &&
        !capabilities.isReadOnly &&
        cursor &&
        task && (
            <TaskRowViewDroppableIndentations
                query={query}
                cursor={cursor}
                task={task}
                parents={parents}
                nextIndentation={nextIndentation}
                areChildTasksExpanded={areChildTasksExpanded}
                getMoveTaskToRootQueryActions={getMoveTaskToRootQueryActions}
            />
        );

    const node = (
        <div
            ref={!capabilities.hasDenseFields ? hoverRef : undefined}
            style={{
                minHeight: spacing[taskRowViewMinHeight],
                position: "relative",
                // NOTE(calebmer): Setting z-index here creates a new stacking context which
                // means the editable collection overlay can't render on top of adjacent rows.
                zIndex: undefined,
                // Important not to set `overflow="hidden"` here so that the collections overlay
                // we open in edit mode can render outside the bounds of the row.
                overflow: undefined,
                display: "flex",
            }}
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
                {!withoutPaddingLeft &&
                    (!disableExpensiveFeaturesDuringScroll &&
                    !capabilities.isReadOnly &&
                    hasTask ? (
                        <TaskRowViewDragHandle
                            task={task}
                            getMaybeRemoveTaskFromQueryActions={getMaybeRemoveTaskFromQueryActions}
                            isHovered={isHovered}
                        />
                    ) : (
                        <div
                            className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            style={{
                                width: taskRowViewDragHandleWidth,
                                paddingRight: spacing["0.5"],
                            }}
                        />
                    ))}
                {!withoutPaddingLeft &&
                    (!disableExpensiveFeaturesDuringScroll && hasTask ? (
                        <div
                            className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            style={{
                                width: spacing["5"],
                                paddingRight: spacing["1"],
                                opacity: isHovered || isExpandButtonFocused ? 1 : 0,
                            }}
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
                                description="Expand"
                                pressErrorTitle="Couldn’t expand task"
                                onPress={async () => {
                                    // If we are already in a peek then navigate the peek instead of opening a
                                    // new one.
                                    if (peekContext?.withMobileLayout) {
                                        await navigate(`/s/${task.getSpaceId()}/tasks/${task.id}`);
                                    } else {
                                        await peekStackContext.push(
                                            `/s/${task.getSpaceId()}/tasks/${task.id}`,
                                        );
                                    }
                                }}
                                onFocusChange={setIsExpandButtonFocused}
                                onKeyDownCapture={event =>
                                    handleCellKeyDownCapture("ExpandButton", event)
                                }
                            >
                                <ArrowsOutSimple />
                            </IconButton>
                        </div>
                    ) : (
                        <div
                            className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                            style={{
                                width: spacing["5"],
                                paddingRight: spacing["1"],
                            }}
                        />
                    ))}
                {!withoutPaddingLeft && (
                    <div
                        className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                        style={{width: spacing["6"], paddingRight: spacing["2"]}}
                    >
                        {hasTask ? (
                            <TaskStatusButton
                                ref={statusButtonRef}
                                store={query.store}
                                task={task}
                                // Disable the ability to tab to this button. Since there are so many tasks and
                                // the `Tab` keyboard shortcut indents a task, we don't rely on `Tab` for focus
                                // navigation.
                                isFocusable={true}
                                isTabbable={false}
                                isDisabled={capabilities.isReadOnly}
                                onKeyDownCapture={event =>
                                    handleCellKeyDownCapture("StatusButton", event)
                                }
                            />
                        ) : (
                            <div className={placeholderStatusButtonClassName} />
                        )}
                    </div>
                )}
            </div>
            <FocusRing isVisibleFromAnyFocus={true} offset="0" insetBottom="border">
                <div
                    ref={titleCellRef}
                    tabIndex={capabilities.hasColumns ? (isFirstRow ? 0 : -1) : undefined}
                    className={titleCellClassName}
                    onKeyDownCapture={event => handleCellKeyDownCapture("Title", event)}
                >
                    <TaskRowTitleInput
                        ref={titleInputRef}
                        capabilities={capabilities}
                        title={task?.getTitle() ?? emptyTaskTitleModel.get()}
                        onTitleChange={onTitleChange}
                        placeholder={titlePlaceholder}
                        indentation={parents.length}
                        paddingRight={
                            capabilities.hasColumns
                                ? taskRowViewFirstColumnExtraPaddingLeft
                                : undefined
                        }
                        parentTaskEntryStore={parentTaskEntryStore}
                        childTaskCount={task?.getChildTaskCount() ?? 0}
                        closedChildTaskCount={task?.getClosedChildTaskCount() ?? 0}
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
                    />
                </div>
            </FocusRing>
            {capabilities.hasColumns && (
                <>
                    <TaskRowAssigneeCell
                        ref={assigneeCellRef}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        isFirstRow={isFirstRow}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                    />
                    <TaskRowPriorityCell
                        ref={priorityCellRef}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                    />
                    <TaskRowDueDateCell
                        ref={dueDateCellRef}
                        store={query.store}
                        task={task}
                        disableExpensiveFeaturesDuringScroll={disableExpensiveFeaturesDuringScroll}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusNextCell={focusNextCell}
                        focusPreviousCell={focusPreviousCell}
                    />
                    <TaskRowCollectionsCell
                        ref={collectionsCellRef}
                        query={query}
                        task={task}
                        onCellKeyDownCapture={handleCellKeyDownCapture}
                        focusPreviousCell={focusPreviousCell}
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
                {...useOutOfBoundsClickSelection({
                    isDisabled: capabilities.isReadOnly,
                    onSelect: focusTitleEnd,
                    onSelectAll: focusTitleAll,
                })}
            />
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
                        ref={hoverRef}
                        style={{
                            minHeight: spacing[taskRowViewMinHeight],
                            position: "relative",
                            // NOTE(calebmer): Setting z-index here creates a new stacking context which
                            // means the task row drop indicator lines can't render on top of
                            // adjacent rows.
                            zIndex: undefined,
                        }}
                    >
                        {borderCoverNode}
                        {node}
                        {task && (
                            // NOTE(calebmer): This component is not rendered by a fullscreen grid view
                            // which may have many, many tasks. So we haven't spent time optimizing it yet.
                            // However, if tasks with many children are common this component may slow
                            // us down.
                            <TaskRowViewDenseFields
                                ref={denseFieldsRef}
                                store={query.store}
                                task={task}
                                marginLeft={marginLeft}
                                focusTitleStart={focusTitleStart}
                                focusTitleEnd={focusTitleEnd}
                                focusTitleAll={focusTitleAll}
                            />
                        )}
                        {droppableIndentationsNode}
                    </div>
                )}
            </ContextMenuActions>
            {/* NOCOMMIT: Test that we can click here to select */}
            {withPaddingBottom && <div className={paddingBottomClassName} />}
        </>
    );
}

const taskRowViewDragHandleWidth = addRemLengths(spacing["4"], spacing["0.5"]);

function TaskRowViewDragHandle({
    task,
    getMaybeRemoveTaskFromQueryActions,
    isHovered,
}: {
    task: TaskModel | null;
    getMaybeRemoveTaskFromQueryActions: (taskId: TaskId) => Array<TaskAction>;
    isHovered: boolean;
}) {
    const [isDragHandlePressed, setIsDragHandlePressed] = useState(false);

    // When drag state updates, only re-render `<TaskRowViewDragHandle>`s. Not
    // every row.
    const {
        attributes: draggableAttributes,
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
    } = useDraggable({
        id: useId(),
        data: task
            ? cast<TaskGridViewDraggableData>({
                  type: "Row",
                  task,
                  getDropActions: getMaybeRemoveTaskFromQueryActions,
              })
            : undefined,
        disabled: !task,
    });

    return (
        <div
            className={classNames(
                tasksStyles.pointerEventsNoneNotInheritedClassName,
                sprinkles({
                    paddingRight: "0.5",
                    opacity: isHovered ? "100" : "0",
                }),
            )}
            style={{width: taskRowViewDragHandleWidth}}
        >
            <FocusRing>
                <button
                    {...mergeProps(draggableAttributes, draggableListeners ?? {}, {
                        onPointerDown: () => setIsDragHandlePressed(true),
                        onPointerUp: () => setIsDragHandlePressed(false),
                        onPointerOut: () => setIsDragHandlePressed(false),
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
