import {useDraggable} from "@dnd-kit/core";
import {Memo, PointerEvent, memo, useId, useMemo, useState} from "react";
import {mergeProps} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {
    TaskCardViewContent,
    taskCardViewMaxWidth,
} from "~/client/tasks/internal/task_card_view_content.js";
import {
    taskNotepadViewActiveSectionCardGap,
    taskNotepadViewActiveSectionCardTranslateDurationMs,
} from "~/client/tasks/internal/task_notepad_view_active_section.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/task_grid_view_dnd_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {pressOpacityOverlayClassName} from "~/shared/styles/styles.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskPosition, compareTaskPosition} from "~/shared/tasks/task_position.js";

const TaskNotepadCardViewMemo = memo(TaskNotepadCardView);
export {TaskNotepadCardViewMemo as TaskNotepadCardView};

function TaskNotepadCardView({
    widthStyle,
    query,
    taskId,
    assigneeActivePosition,
    onExpand,
    deleteTaskAndAllChildren,
}: {
    widthStyle: string;
    query: TaskClientQuery;
    taskId: TaskId;
    assigneeActivePosition: TaskPosition;
    onExpand: Memo<(taskId: TaskId) => Promise<void>>;
    deleteTaskAndAllChildren: Memo<(taskId: TaskId) => void>;
}) {
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const {store} = query;
    const {task} = useStore(query.getLoadedTaskEntryStore(taskId));
    const displayStatus = task?.getDisplayStatus() ?? "OpenInactive";
    const title = task?.getTitle() ?? TaskTitleModel.empty.get();
    const assigneeAccountData = useStore(task ? store.getTaskAssigneeAccountStore(task) : null);
    const collections = task?.getCollections() ?? TaskCollectionSet.empty;
    const dueDate = task?.getDueDate() ?? null;
    const priority = task?.getPriority() ?? null;
    const childTaskCount = task?.getChildTaskCount() ?? 0;
    const closedChildTaskCount = task?.getClosedChildTaskCount() ?? 0;

    // We manually implement `usePress()` so to play nice with drag-and-drop.
    const [isPressed, setIsPressed] = useState(false);

    const onPress = () => {
        const promise = onExpand(taskId);

        // TODO(calebmer, #global-loading-indicator): Some kind of global loading
        // indicator for navigation?
        void promise;
    };

    const content = (
        <TaskCardViewContent
            displayStatus={displayStatus}
            title={title}
            assigneeAccountData={assigneeAccountData}
            collectionEntries={useStore(
                useMemo(
                    () =>
                        Store.many(
                            collections
                                .getArray()
                                .map(({collectionId}) =>
                                    query.getReferencedCollectionEntryStore(collectionId),
                                ),
                        ),
                    [collections, query],
                ),
            )}
            dueDate={dueDate}
            priority={priority}
            childTaskCount={childTaskCount}
            closedChildTaskCount={closedChildTaskCount}
        />
    );

    const {
        isDragging,
        attributes: draggableAttributes,
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
        active: dndContextActive,
        over: dndContextOver,
    } = useDraggable({
        id: useId(),
        data: {
            type: "Card",
            taskId,
            displayStatus,
            assigneeAccountId: task?.getAssignee()?.assignee.accountId ?? null,
            assigneeActivePosition,
            // We render a `<TaskCardPresentationalViewContent>` in the overlay since it
            // doesn't depend on any store state. So if the task is removed from the query
            // in realtime we can still render the drag overlay.
            overlayNode: (
                <Box
                    overflow="hidden"
                    backgroundColor="grey-0"
                    boxShadow="elevation-30-with-grey-10-border"
                    borderRadius="lg"
                    pointerEvents="none"
                >
                    {content}
                </Box>
            ),
        } satisfies TaskGridViewDraggableData,
    });

    const activeDraggableData = dndContextActive?.data.current as
        | TaskGridViewDraggableData
        | undefined;

    const overDroppableData = dndContextOver?.data.current as TaskGridViewDroppableData | undefined;

    const shouldPushRight =
        overDroppableData?.type === "ActiveCard" &&
        overDroppableData.assigneeActivePosition &&
        compareTaskPosition(overDroppableData.assigneeActivePosition, assigneeActivePosition) >=
            0 &&
        // There are two kinds of drag into this list:
        //
        // 1. Inserting a row
        // 2. Moving a card
        //
        // For 1 we only want to push cards to the right. For 2 if we drag to an
        // earlier position we need to push left and if we drag to a later position
        // we need to push right.
        //
        // Here we need to handle case 1 and 2.
        (activeDraggableData?.type !== "Card" ||
            compareTaskPosition(
                activeDraggableData.assigneeActivePosition,
                assigneeActivePosition,
            ) < 0);

    const shouldPushLeft =
        overDroppableData?.type === "ActiveCard" &&
        overDroppableData.assigneeActivePosition &&
        compareTaskPosition(overDroppableData.assigneeActivePosition, assigneeActivePosition) <=
            0 &&
        // There are two kinds of drag into this list:
        //
        // 1. Inserting a row
        // 2. Moving a card
        //
        // For 1 we only want to push cards to the right. For 2 if we drag to an
        // earlier position we need to push left and if we drag to a later position
        // we need to push right.
        //
        // Here we only need to handle case 2.
        activeDraggableData?.type === "Card" &&
        compareTaskPosition(activeDraggableData.assigneeActivePosition, assigneeActivePosition) > 0;

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
                store,
                task,
            }),
        );

        contextMenuActions.push([
            {
                label: "Delete",
                onPress: () => deleteTaskAndAllChildren(taskId),
            },
        ]);
    }

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <FocusRing offset="0">
                <Box
                    {...mergeProps(draggableListeners ?? {}, draggableAttributes, {
                        onPointerDown: (event: PointerEvent) => {
                            // Only count left clicks.
                            if (event.button !== 0) return;

                            setIsPressed(true);
                        },
                        onPointerUp: (event: PointerEvent) => {
                            // Only count left clicks.
                            if (event.button !== 0) return;

                            setIsPressed(false);
                            if (isPressed) onPress();
                        },
                        onPointerOut: () => setIsPressed(false),
                    })}
                    ref={setDraggableNodeRef}
                    tabIndex={0}
                    flexShrink="0"
                    alignSelf="stretch"
                    maxWidth={taskCardViewMaxWidth}
                    position="relative"
                    overflow="hidden"
                    backgroundColor="grey-0"
                    boxShadow="elevation-5-with-grey-10-border"
                    borderRadius="lg"
                    opacity={isDragging ? "0" : undefined}
                    pointerEvents={isDragging ? "none" : undefined}
                    style={{
                        width: widthStyle,
                        transform: shouldPushRight
                            ? `translateX(100%) translateX(${spacing[taskNotepadViewActiveSectionCardGap]})`
                            : shouldPushLeft
                            ? `translateX(-100%) translateX(-${spacing[taskNotepadViewActiveSectionCardGap]})`
                            : undefined,
                        transition: dndContextActive
                            ? `transform ${taskNotepadViewActiveSectionCardTranslateDurationMs}ms ease`
                            : undefined,
                    }}
                >
                    {isPressed && (
                        <Box
                            position="absolute"
                            zIndex="10"
                            inset="0"
                            pointerEvents="none"
                            borderWidth="thick"
                            border="grey-0"
                            borderRadius="lg"
                            className={pressOpacityOverlayClassName}
                        />
                    )}
                    {content}
                </Box>
            </FocusRing>
        </ContextMenuActions>
    );
}
