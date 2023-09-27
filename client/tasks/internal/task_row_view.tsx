import {useDraggable} from "@dnd-kit/core";
import {DotsSixVertical} from "phosphor-react";
import {Selection} from "prosemirror-state";
import {Ref, forwardRef, useId, useImperativeHandle, useMemo, useRef, useState} from "react";
import {mergeProps} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useHoverWithOverlaySupport} from "~/client/helpers/use_hover_with_overlay_support.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/get_new_task_position_for_query_sorted_by_position.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskGridViewCapabilities} from "~/client/tasks/internal/task_grid_view_capabilities.js";
import {TaskGridViewDraggableData} from "~/client/tasks/internal/task_grid_view_dnd_context.js";
import {TaskGridViewTaskKey} from "~/client/tasks/internal/task_grid_view_task_key.js";
import {
    TaskRowTitleInput,
    TaskRowTitleInputRef,
} from "~/client/tasks/internal/task_row_title_input.js";
import {TaskRowViewDroppable} from "~/client/tasks/internal/task_row_view_droppable.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {useOutOfBoundsClickSelection} from "~/client/tasks/internal/use_out_of_bounds_click_selection.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {Context} from "~/shared/context/context.js";
import {RemLength, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
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

export type TaskRowViewRef = {
    isTitleFocused(): boolean;
    focusTitleStart(): void;
    focusTitleEnd(): void;
    focusTitleAll(): void;
    focusTitleCoord(coord: number, side: "top" | "bottom"): void;
    focusTitleSelection(selection: Selection): void;
};

const TaskRowViewForwardRef = forwardRef(TaskRowView);
export {TaskRowViewForwardRef as TaskRowView};

function TaskRowView(
    {
        capabilities,
        query,
        cursor,
        ghostTaskId = null,
        onGhostTaskCreated,
        parents,
        titlePlaceholder,
        getNextIndentation,
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
        titlePlaceholder?: string;
        // NOCOMMIT:
        // capabilities: TaskGridViewCapabilities;
        // taskRow: TaskRow | null;
        // status: TaskStatus | null;
        // onStatusChange: (status: TaskStatus) => void;
        // assignee: TaskAssignee | null;
        // onAssigneeChange: (assignee: TaskAssignee | null) => void;
        // priority: TaskPriority | null;
        // onPriorityChange: (priority: TaskPriority | null) => void;
        // dueDate: CalendarDate | null;
        // onDueDateChange: (dueDate: CalendarDate | null) => void;
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
        // parentTaskTitle: TaskTitle | null;
        // onExpand: (() => Promise<void>) | null;
        getNextIndentation: () => number;
        areChildTasksExpandedStore: Store<boolean | undefined>;
        onAreChildTasksExpandedToggle: () => void;
        withoutPaddingLeft?: boolean;
        withPaddingBottom?: boolean;
        // NOCOMMIT:
        // createTaskAbove: () => void;
        // createTaskBelowAndFocus: () => void;
        // createTaskChildAtStartAndFocus: () => void;
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
        preserveLastTaskTitleArrowNavigationCoord: () => void;
        focusFirstVisibleTaskTitleStart: () => void;
        focusLastVisibleTaskTitleEnd: () => void;
    },
    ref: Ref<TaskRowViewRef>,
) {
    // Either `cursor` or `ghostTaskId` should be provided. This component
    // transitions from a ghost task to a regular task when the user enters data.
    assert(cursor !== null ? ghostTaskId === null : ghostTaskId !== null);

    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

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
    assert(cursor !== null ? task !== null && taskEntry?.isAuthorized : task === null);

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

    const titleInputRef = useRef<TaskRowTitleInputRef>(null);
    // NOCOMMIT:
    // const denseAssigneeAndDueDateRef = useRef<TaskRowViewDenseFieldsRef>(null);
    // const assigneeCellRef = useRef<TaskRowAssigneeCellRef>(null);
    // const priorityCellRef = useRef<TaskRowPriorityCellRef>(null);
    // const dueDateCellRef = useRef<TaskRowDueDateCellRef>(null);
    // const collectionsCellRef = useRef<TaskRowCollectionsCellRef>(null);

    const {
        isTitleFocused,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
    } = useMemo(
        () => ({
            isTitleFocused: () => {
                return assertExists(titleInputRef.current).isFocused();
            },
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
        }),
        [],
    );

    useImperativeHandle(ref, () => ({
        isTitleFocused,
        focusTitleStart,
        focusTitleEnd,
        focusTitleAll,
        focusTitleCoord,
        focusTitleSelection,
    }));

    const [isHovered, hoverRef] = useHoverWithOverlaySupport();

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

    const [isDragHandlePressed, setIsDragHandlePressed] = useState(false);

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

        // NOCOMMIT:
        // if (capabilities.hasDenseAssigneeAndDueDate) {
        //     contextMenuActions.push([
        //         {
        //             label: assignee ? "Edit assignee" : "Add assignee",
        //             onPress: () => {
        //                 assertExists(denseAssigneeAndDueDateRef.current).focusAssigneeInput();
        //             },
        //         },
        //         {
        //             label: priority ? "Edit priority" : "Add priority",
        //             onPress: () => {
        //                 assertExists(denseAssigneeAndDueDateRef.current).focusPriorityInput();
        //             },
        //         },
        //         {
        //             label: dueDate ? "Edit due date" : "Add due date",
        //             onPress: () => {
        //                 assertExists(denseAssigneeAndDueDateRef.current).focusDueDateInput();
        //             },
        //         },
        //     ]);
        // }

        if (taskId !== null) {
            contextMenuActions.push([
                {
                    label: "Delete",
                    onPress: () => deleteTaskAndAllChildren({withConfirmation: true}),
                },
            ]);
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

    return (
        <>
            <ContextMenuActions actions={contextMenuActions}>
                <Box
                    ref={hoverRef}
                    minHeight={taskRowViewMinHeight}
                    position="relative"
                    // NOTE(calebmer): Setting z-index here creates a new stacking context which
                    // means the task row drop indicator lines can't render on top of
                    // adjacent rows.
                    zIndex={undefined}
                >
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top="0"
                        bottom="0"
                        left="5"
                        right="5"
                        pointerEvents="none"
                        style={{
                            // Draw the top and bottom border with a shadow so it:
                            //
                            // 1. Doesn't add 2px to layout
                            // 2. Adjacent borders share the same space so we don't get 2px dividers
                            boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5"]}, inset 0 -1px 0 0 ${colorSchemeVars["grey-5"]}`,
                        }}
                    />
                    <Box
                        position="relative"
                        // NOTE(calebmer): Setting z-index here creates a new stacking context which
                        // means the editable collection overlay can't render on top of adjacent rows.
                        zIndex={undefined}
                        // Important not to set `overflow="hidden"` here so that the collections overlay
                        // we open in edit mode can render outside the bounds of the row.
                        overflow={undefined}
                        display="flex"
                    >
                        <Box
                            position="relative"
                            flexShrink="0"
                            style={{width: marginLeft}}
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
                            {!withoutPaddingLeft && (
                                <Box
                                    display="flex"
                                    justifyContent="flex-end"
                                    alignItems="center"
                                    height={taskRowViewMinHeight}
                                    className={tasksStyles.pointerEventsNoneNotInheritedClassName}
                                >
                                    <Box
                                        paddingRight="0.5"
                                        className={
                                            tasksStyles.pointerEventsNoneNotInheritedClassName
                                        }
                                    >
                                        {isHovered && task && (
                                            <button
                                                {...mergeProps(
                                                    draggableAttributes,
                                                    draggableListeners ?? {},
                                                    {
                                                        onPointerDown: () =>
                                                            setIsDragHandlePressed(true),
                                                        onPointerUp: () =>
                                                            setIsDragHandlePressed(false),
                                                        onPointerOut: () =>
                                                            setIsDragHandlePressed(false),
                                                    },
                                                )}
                                                ref={setDraggableNodeRef}
                                                className={sprinkles({
                                                    display: "block",
                                                    width: "4",
                                                    height: "4",
                                                    padding: "0.5",
                                                    borderRadius: "full",
                                                    // Dragging doesn't activate until the mouse moves. Set the grabbing cursor
                                                    // immediately on press.
                                                    cursor: isDragHandlePressed
                                                        ? "grabbing"
                                                        : "grab",
                                                })}
                                                // Drag handle is not tab focusable. Keyboard navigation within a task grid is
                                                // not done with tab navigation.
                                                tabIndex={-1}
                                            >
                                                <DotsSixVertical size={spacing["3"]} />
                                            </button>
                                        )}
                                    </Box>
                                    <Box
                                        width="5"
                                        paddingRight="1"
                                        className={
                                            tasksStyles.pointerEventsNoneNotInheritedClassName
                                        }
                                    >
                                        {/* NOCOMMIT: {onExpand && isHovered && (
                                        <IconButton
                                            size="xs"
                                            description="Expand"
                                            pressErrorTitle="Couldn’t expand task"
                                            onPress={onExpand}
                                        >
                                            <ArrowsOutSimple />
                                        </IconButton>
                                    )} */}
                                    </Box>
                                    <Box
                                        width="6"
                                        paddingRight="2"
                                        className={
                                            tasksStyles.pointerEventsNoneNotInheritedClassName
                                        }
                                    >
                                        {task ? (
                                            <TaskStatusButton
                                                store={query.store}
                                                task={task}
                                                // Disable the ability to focus this button. Since there are so many tasks and
                                                // the `Tab` keyboard shortcut indents a task, we don't rely on `Tab` for focus
                                                // navigation.
                                                isFocusable={false}
                                            />
                                        ) : (
                                            <Box
                                                width="4"
                                                height="4"
                                                borderRadius="full"
                                                border="grey-10"
                                                pointerEvents="none"
                                            />
                                        )}
                                    </Box>
                                </Box>
                            )}
                        </Box>
                        <Box flexGrow="1" overflow="hidden">
                            <TaskRowTitleInput
                                ref={titleInputRef}
                                capabilities={capabilities}
                                title={task?.getTitle() ?? emptyTaskTitleModel.get()}
                                onTitleChange={onTitleChange}
                                placeholder={titlePlaceholder}
                                indentation={parents.length}
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
                            />
                        </Box>
                        {/* NOCOMMIT: {capabilities.hasColumns && (
                        <>
                            <TaskRowAssigneeCell
                                ref={assigneeCellRef}
                                assignee={assignee}
                                onAssigneeChange={onAssigneeChange}
                                focusTaskPreviousCell={() => {
                                    assertExists(titleInputRef.current).focusEnd();
                                }}
                                focusTaskNextCell={() => {
                                    assertExists(priorityCellRef.current).focus();
                                }}
                            />
                            <TaskRowPriorityCell
                                ref={priorityCellRef}
                                priority={priority}
                                onPriorityChange={onPriorityChange}
                                focusTaskPreviousCell={() => {
                                    assertExists(assigneeCellRef.current).focus();
                                }}
                                focusTaskNextCell={() => {
                                    assertExists(dueDateCellRef.current).focusStart();
                                }}
                            />
                            <TaskRowDueDateCell
                                ref={dueDateCellRef}
                                dueDate={dueDate}
                                onDueDateChange={onDueDateChange}
                                focusTaskPreviousCell={() => {
                                    assertExists(priorityCellRef.current).focus();
                                }}
                                focusTaskNextCell={() => {
                                    assertExists(collectionsCellRef.current).focusStart();
                                }}
                            />
                            <TaskRowCollectionsCell
                                ref={collectionsCellRef}
                                allCollections={allCollections}
                                collections={collections}
                                createCollectionAndAddToTask={createCollectionAndAddToTask}
                                addCollectionToTask={addCollectionToTask}
                                removeCollectionFromTask={removeCollectionFromTask}
                                isEditing={isEditingCollections}
                                onEditingChange={onEditingCollectionsChange}
                                editingContainerRef={editingCollectionsContainerRef}
                                focusTaskPreviousCell={() => {
                                    assertExists(dueDateCellRef.current).focusEnd();
                                }}
                            />
                        </>
                    )} */}
                        <Box
                            flexShrink="0"
                            width="5"
                            // Create an illusion that the text editor extends into the margins by giving
                            // the margin a text cursor and making it clickable putting focus in the task.
                            // A double click selects the task text.
                            //
                            // This is an affordance for mouse users, does not need to be usable
                            // by keyboard.
                            cursor={false && capabilities.hasColumns ? undefined : "text"} // NOCOMMIT
                            pointerEvents={false && capabilities.hasColumns ? "none" : undefined} // NOCOMMIT
                            {...useOutOfBoundsClickSelection({
                                onSelect: focusTitleEnd,
                                onSelectAll: focusTitleAll,
                            })}
                        />
                    </Box>
                    {/* NOCOMMIT: {capabilities.hasDenseAssigneeAndDueDate && (
                    <TaskRowViewDenseFields
                        ref={denseAssigneeAndDueDateRef}
                        status={status}
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
                        priority={priority}
                        onPriorityChange={onPriorityChange}
                        dueDate={dueDate}
                        onDueDateChange={onDueDateChange}
                        marginLeft={marginLeft}
                        focusTitleStart={focusTitleStart}
                        focusTitleEnd={focusTitleEnd}
                        focusTitleAll={focusTitleAll}
                    />
                )} */}
                    {cursor && task && (
                        <TaskRowViewDroppableIndentations
                            query={query}
                            cursor={cursor}
                            task={task}
                            parents={parents}
                            getNextIndentation={getNextIndentation}
                            areChildTasksExpanded={areChildTasksExpanded}
                            getMoveTaskToRootQueryActions={getMoveTaskToRootQueryActions}
                        />
                    )}
                </Box>
            </ContextMenuActions>
            {/* NOCOMMIT: Test that we can click here to select */}
            {withPaddingBottom && <Box width="full" height="5" pointerEvents="none" />}
        </>
    );
}

function TaskRowViewDroppableIndentations({
    query,
    cursor,
    task,
    parents,
    getNextIndentation,
    areChildTasksExpanded,
    getMoveTaskToRootQueryActions,
}: {
    query: TaskClientQuery;
    cursor: TaskQuerySortCursor;
    task: TaskModel;
    parents: ReadonlyArray<{query: TaskClientQuery; cursor: TaskQuerySortCursor}>;
    getNextIndentation: () => number;
    areChildTasksExpanded: boolean;
    getMoveTaskToRootQueryActions: (
        taskId: TaskId,
        position: {type: "End"} | {type: "Above"; taskId: TaskId} | {type: "Below"; taskId: TaskId},
    ) => Array<TaskAction>;
}) {
    if (areChildTasksExpanded && task.getChildTaskCount() > 0) {
        return (
            <TaskRowViewDroppable
                indentation={parents.length + 1}
                nextAdjacentIndentation={null}
                previousAdjacentIndentation={null}
                isVerticallyFlipped={true}
                getDropActions={(taskId): Array<TaskAction> => {
                    const time1 = query.store.clock.now();
                    const time2 = query.store.clock.now();

                    const childrenQuery = query.store
                        .getTaskChildrenQueryStore(task.id)
                        .getSnapshot();

                    return [
                        {
                            type: "UpdateTask",
                            time: time1,
                            taskId: taskId,
                            taskAction: {
                                type: "UpdateParentTaskId",
                                parentTaskId: task.id,
                            },
                        },
                        ...(childrenQuery
                            ? cast<Array<TaskAction>>([
                                  {
                                      type: "UpdateTask",
                                      time: time2,
                                      taskId: taskId,
                                      taskAction: {
                                          type: "UpdateParentPosition",
                                          parentPosition:
                                              getNewTaskPositionForQuerySortedByPosition(
                                                  time2,
                                                  childrenQuery,
                                                  {type: "Start"},
                                              ),
                                      },
                                  },
                              ])
                            : []),
                    ];
                }}
            />
        );
    }

    const nextIndentation = getNextIndentation();
    const droppableIndentations = [parents.length];

    for (
        let droppableIndentation = parents.length - 1;
        droppableIndentation >= nextIndentation;
        droppableIndentation--
    ) {
        droppableIndentations.push(droppableIndentation);
    }

    droppableIndentations.reverse();

    return (
        <>
            {droppableIndentations.map((droppableIndentation, index) => (
                <TaskRowViewDroppable
                    key={droppableIndentation}
                    indentation={droppableIndentation}
                    nextAdjacentIndentation={droppableIndentations[index + 1] ?? null}
                    previousAdjacentIndentation={droppableIndentations[index - 1] ?? null}
                    getDropActions={taskId => {
                        const time1 = query.store.clock.now();
                        const time2 = query.store.clock.now();

                        const {query: parentQuery, cursor: parentCursor} =
                            parents.length === droppableIndentation
                                ? {query, cursor}
                                : parents[droppableIndentation]!;

                        if (droppableIndentation === 0) {
                            return getMoveTaskToRootQueryActions(taskId, {
                                type: "Below",
                                taskId: getTaskQuerySortCursorTaskId(parentCursor),
                            });
                        }

                        const {cursor: grandParentCursor} = parents[droppableIndentation - 1]!;

                        return [
                            {
                                type: "UpdateTask",
                                time: time1,
                                taskId: taskId,
                                taskAction: {
                                    type: "UpdateParentTaskId",
                                    parentTaskId: getTaskQuerySortCursorTaskId(grandParentCursor),
                                },
                            },
                            {
                                type: "UpdateTask",
                                time: time2,
                                taskId: taskId,
                                taskAction: {
                                    type: "UpdateParentPosition",
                                    parentPosition: getNewTaskPositionForQuerySortedByPosition(
                                        time2,
                                        parentQuery,
                                        {
                                            type: "Below",
                                            taskId: getTaskQuerySortCursorTaskId(parentCursor),
                                        },
                                    ),
                                },
                            },
                        ];
                    }}
                />
            ))}
        </>
    );
}

// NOCOMMIT:
// type TaskRowViewDenseFieldsRef = {
//     focusAssigneeInput(): void;
//     focusPriorityInput(): void;
//     focusDueDateInput(): void;
// };

// NOCOMMIT:
// const TaskRowViewDenseFields = forwardRef(function TaskRowViewDenseFields(
//     {
//         status,
//         assigneeAccount,
//         onAssigneeAccountChange,
//         priority,
//         onPriorityChange,
//         dueDate,
//         onDueDateChange,
//         marginLeft,
//         focusTitleStart,
//         focusTitleEnd,
//         focusTitleAll,
//     }: {
//         status: TaskStatus | null;
//         assigneeAccount: AccountModel | null;
//         onAssigneeAccountChange: (assigneeAccount: AccountModel | null) => void;
//         priority: TaskPriority | null;
//         onPriorityChange: (priority: TaskPriority | null) => void;
//         dueDate: CalendarDate | null;
//         onDueDateChange: (dueDate: CalendarDate | null) => void;
//         marginLeft: RemLength;
//         focusTitleEnd: () => void;
//         focusTitleStart: () => void;
//         focusTitleAll: () => void;
//     },
//     ref: Ref<TaskRowViewDenseFieldsRef>,
// ) {
//     const assigneeInputRef = useRef<HTMLDivElement>(null);
//     const priorityInputRef = useRef<HTMLDivElement>(null);
//     const dueDateInputRef = useRef<HTMLDivElement>(null);

//     const fieldMaxWidth = `calc(${100 / 3}% - ${
//         parseRemLengthNumber(
//             addRemLengths(
//                 marginLeft, // Margin left
//                 spacing["2"], // Gap
//                 spacing["5"], // Margin right
//             ),
//         ) / 3
//     }rem)`;

//     const [assigneeInputState, setAssigneeInputState] = useState<
//         {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
//     >(
//         assigneeAccount
//             ? {isVisible: true, shouldFocus: false, isFocused: false}
//             : {isVisible: false},
//     );

//     if (
//         assigneeInputState.isVisible &&
//         !assigneeInputState.isFocused &&
//         !assigneeInputState.shouldFocus &&
//         !assigneeAccount
//     ) {
//         setAssigneeInputState({isVisible: false});
//     }

//     if (!assigneeInputState.isVisible && assigneeAccount) {
//         setAssigneeInputState({isVisible: true, shouldFocus: false, isFocused: false});
//     }

//     useLayoutEffectWithoutServerSideWarning(() => {
//         if (assigneeInputState.isVisible && assigneeInputState.shouldFocus) {
//             assertExists(
//                 getNextFocusableElementIfExists(null, {
//                     withinElement: assertExists(assigneeInputRef.current),
//                 }),
//             ).focus({preventScroll: true});

//             setAssigneeInputState(assigneeInputState => {
//                 if (!assigneeInputState.isVisible) return assigneeInputState;
//                 return {...assigneeInputState, shouldFocus: false};
//             });
//         }
//     }, [assigneeInputState]);

//     const [priorityInputState, setPriorityInputState] = useState<
//         {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
//     >(priority ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

//     if (
//         priorityInputState.isVisible &&
//         !priorityInputState.isFocused &&
//         !priorityInputState.shouldFocus &&
//         !priority
//     ) {
//         setPriorityInputState({isVisible: false});
//     }

//     if (!priorityInputState.isVisible && priority) {
//         setPriorityInputState({isVisible: true, shouldFocus: false, isFocused: false});
//     }

//     useLayoutEffectWithoutServerSideWarning(() => {
//         if (priorityInputState.isVisible && priorityInputState.shouldFocus) {
//             assertExists(
//                 getNextFocusableElementIfExists(null, {
//                     withinElement: assertExists(priorityInputRef.current),
//                 }),
//             ).focus({preventScroll: true});

//             setPriorityInputState(priorityInputState => {
//                 if (!priorityInputState.isVisible) return priorityInputState;
//                 return {...priorityInputState, shouldFocus: false};
//             });
//         }
//     }, [priorityInputState]);

//     const [dueDateInputState, setDueDateInputState] = useState<
//         {isVisible: false} | {isVisible: true; shouldFocus: boolean; isFocused: boolean}
//     >(dueDate ? {isVisible: true, shouldFocus: false, isFocused: false} : {isVisible: false});

//     if (
//         dueDateInputState.isVisible &&
//         !dueDateInputState.isFocused &&
//         !dueDateInputState.shouldFocus &&
//         !dueDate
//     ) {
//         setDueDateInputState({isVisible: false});
//     }

//     if (!dueDateInputState.isVisible && dueDate) {
//         setDueDateInputState({isVisible: true, shouldFocus: false, isFocused: false});
//     }

//     useLayoutEffectWithoutServerSideWarning(() => {
//         if (dueDateInputState.isVisible && dueDateInputState.shouldFocus) {
//             assertExists(
//                 getNextFocusableElementIfExists(null, {
//                     withinElement: assertExists(dueDateInputRef.current),
//                 }),
//             ).focus({preventScroll: true});

//             setDueDateInputState(dueDateInputState => {
//                 if (!dueDateInputState.isVisible) return dueDateInputState;
//                 return {...dueDateInputState, shouldFocus: false};
//             });
//         }
//     }, [dueDateInputState]);

//     useImperativeHandle(
//         ref,
//         () => ({
//             focusAssigneeInput: () => {
//                 if (assigneeInputState.isVisible) {
//                     assertExists(
//                         getNextFocusableElementIfExists(null, {
//                             withinElement: assertExists(assigneeInputRef.current),
//                         }),
//                     ).focus({preventScroll: true});
//                 } else {
//                     setAssigneeInputState({
//                         isVisible: true,
//                         shouldFocus: true,
//                         isFocused: false,
//                     });
//                 }
//             },
//             focusPriorityInput: () => {
//                 if (priorityInputState.isVisible) {
//                     assertExists(
//                         getNextFocusableElementIfExists(null, {
//                             withinElement: assertExists(priorityInputRef.current),
//                         }),
//                     ).focus({preventScroll: true});
//                 } else {
//                     setPriorityInputState({
//                         isVisible: true,
//                         shouldFocus: true,
//                         isFocused: false,
//                     });
//                 }
//             },
//             focusDueDateInput: () => {
//                 if (dueDateInputState.isVisible) {
//                     assertExists(
//                         getNextFocusableElementIfExists(null, {
//                             withinElement: assertExists(dueDateInputRef.current),
//                         }),
//                     ).focus({preventScroll: true});
//                 } else {
//                     setDueDateInputState({
//                         isVisible: true,
//                         shouldFocus: true,
//                         isFocused: false,
//                     });
//                 }
//             },
//         }),
//         [assigneeInputState.isVisible, dueDateInputState.isVisible, priorityInputState.isVisible],
//     );

//     const node = (
//         <Box display="flex" alignItems="stretch">
//             <Box
//                 flexShrink="0"
//                 cursor="text"
//                 style={{width: marginLeft}}
//                 {...useOutOfBoundsClickSelection({
//                     onSelect: focusTitleStart,
//                     onSelectAll: focusTitleAll,
//                 })}
//             />
//             <Box
//                 flexGrow="1"
//                 display="flex"
//                 gap="5"
//                 // I find some negative `marginLeft` helps the fields feel optically aligned.
//                 marginLeft="-0.5"
//                 // I find some negative `marginTop` helps the fields feel optically aligned.
//                 // Since above us is text, not a divider line.
//                 marginTop="-0.5"
//                 paddingBottom="2"
//                 className={tasksStyles.textCursorNotInheritedClassName}
//                 {...useOutOfBoundsClickSelection({
//                     onSelect: focusTitleEnd,
//                     onSelectAll: focusTitleAll,
//                 })}
//             >
//                 {assigneeInputState.isVisible && (
//                     <Box
//                         ref={assigneeInputRef}
//                         flexShrink="0"
//                         style={{maxWidth: fieldMaxWidth}}
//                         className={tasksStyles.pointerEventsNoneNotInheritedClassName}
//                         onFocus={() => {
//                             setAssigneeInputState(assigneeInputState => {
//                                 if (!assigneeInputState.isVisible) return assigneeInputState;
//                                 if (assigneeInputState.isFocused) return assigneeInputState;
//                                 return {...assigneeInputState, isFocused: true};
//                             });
//                         }}
//                         onBlur={event => {
//                             // If focus is moving within the element, don't unfocus.
//                             if (event.currentTarget.contains(event.relatedTarget)) return;

//                             setAssigneeInputState(assigneeInputState => {
//                                 if (!assigneeInputState.isVisible) return assigneeInputState;
//                                 if (!assigneeInputState.isFocused) return assigneeInputState;
//                                 return {...assigneeInputState, isFocused: false};
//                             });
//                         }}
//                     >
//                         <TaskAssigneeInput
//                             aria-label="Assignee"
//                             assigneeAccount={assigneeAccount}
//                             onAssigneeAccountChange={onAssigneeAccountChange}
//                             color="grey-60"
//                             avatarSize="4"
//                             shouldDisplayShortName={true}
//                         />
//                     </Box>
//                 )}
//                 {priorityInputState.isVisible && (
//                     <Box
//                         ref={priorityInputRef}
//                         flexShrink="0"
//                         style={{maxWidth: fieldMaxWidth}}
//                         className={tasksStyles.pointerEventsNoneNotInheritedClassName}
//                         onFocus={() => {
//                             setPriorityInputState(priorityInputState => {
//                                 if (!priorityInputState.isVisible) return priorityInputState;
//                                 if (priorityInputState.isFocused) return priorityInputState;
//                                 return {...priorityInputState, isFocused: true};
//                             });
//                         }}
//                         onBlur={event => {
//                             // If focus is moving within the element, don't unfocus.
//                             if (event.currentTarget.contains(event.relatedTarget)) return;

//                             setPriorityInputState(priorityInputState => {
//                                 if (!priorityInputState.isVisible) return priorityInputState;
//                                 if (!priorityInputState.isFocused) return priorityInputState;
//                                 return {...priorityInputState, isFocused: false};
//                             });
//                         }}
//                     >
//                         <TaskPriorityInput
//                             aria-label="Priority"
//                             priority={priority}
//                             onPriorityChange={onPriorityChange}
//                             color="grey-60"
//                         />
//                     </Box>
//                 )}
//                 {dueDateInputState.isVisible && (
//                     <Box
//                         ref={dueDateInputRef}
//                         flexShrink="0"
//                         style={{maxWidth: fieldMaxWidth}}
//                         className={tasksStyles.pointerEventsNoneNotInheritedClassName}
//                         onFocus={() => {
//                             setDueDateInputState(dueDateInputState => {
//                                 if (!dueDateInputState.isVisible) return dueDateInputState;
//                                 if (dueDateInputState.isFocused) return dueDateInputState;
//                                 return {...dueDateInputState, isFocused: true};
//                             });
//                         }}
//                         onBlur={event => {
//                             // If focus is moving within the element, don't unfocus.
//                             if (event.currentTarget.contains(event.relatedTarget)) return;

//                             setDueDateInputState(dueDateInputState => {
//                                 if (!dueDateInputState.isVisible) return dueDateInputState;
//                                 if (!dueDateInputState.isFocused) return dueDateInputState;
//                                 return {...dueDateInputState, isFocused: false};
//                             });
//                         }}
//                     >
//                         <TaskDateInput
//                             aria-label="Due date"
//                             date={dueDate}
//                             onDateChange={onDueDateChange}
//                             shouldIncludeCalendarIcon={true}
//                             shouldWarnIfAfterDate={status?.type === "Open"}
//                             shouldFormatAroundToday={true}
//                             color="grey-60"
//                         />
//                     </Box>
//                 )}
//             </Box>
//         </Box>
//     );

//     if (
//         !assigneeInputState.isVisible &&
//         !priorityInputState.isVisible &&
//         !dueDateInputState.isVisible
//     ) {
//         return null;
//     }

//     return node;
// });
