import {useDraggable} from "@dnd-kit/core";
import {
    Memo,
    PointerEvent as PointerSyntheticEvent,
    memo,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {MenuAction} from "~/client/design/menu.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useCanPrimaryInputHover, useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {TaskClientQuery} from "~/client/tasks/core/task_client_query.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/core/task_client_store.js";
import {createDisplayTaskCollectionsStore} from "~/client/tasks/internal/create_display_task_collections_store.js";
import {getTaskStatusMenuActions} from "~/client/tasks/internal/get_task_status_menu_actions.js";
import {TaskCardViewContent} from "~/client/tasks/internal/task_card_view_content.js";
import {TaskCloseConfirmationModalDialog} from "~/client/tasks/internal/task_close_confirmation_modal_dialog.js";
import {taskNotepadViewActiveSectionCardTranslateDurationMs} from "~/client/tasks/internal/task_notepad_view_active_section.js";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/task_grid_view_dnd_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {borderRadius, pressOpacityOverlayClassName} from "~/shared/styles/styles.js";
import {
    taskCardViewMaxWidth,
    taskCardViewMinHeight,
    taskNotepadViewActiveSectionCardGap,
} from "~/shared/styles/tasks_shared_styles.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskCollectionSet} from "~/shared/tasks/task_collection_set.js";
import {TaskPosition, compareTaskPosition} from "~/shared/tasks/task_position.js";

const TaskNotepadCardViewMemo = memo(TaskNotepadCardView);
export {TaskNotepadCardViewMemo as TaskNotepadCardView};

function TaskNotepadCardView({
    withMobileLayout,
    widthStyle,
    affinityManager,
    query,
    taskId,
    assigneeActivePosition,
    onExpand,
    deleteTaskAndAllChildren,
}: {
    withMobileLayout: boolean;
    widthStyle: string;
    affinityManager: TaskClientStoreSearchAffinityManager;
    query: TaskClientQuery;
    taskId: TaskId;
    assigneeActivePosition: TaskPosition;
    onExpand: Memo<(taskId: TaskId) => void>;
    deleteTaskAndAllChildren: Memo<(taskId: TaskId) => void>;
}) {
    const isMobile = useIsMobile();
    const canPrimaryInputHover = useCanPrimaryInputHover();
    const context = useAppContext();
    const {timeZone} = useClientInfo();
    const {currentAccount} = useSpaceContext();

    const cardRef = useRef<HTMLDivElement>(null);

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

    // Watch all parents for a scroll event. When a scroll event occurs we need to
    // cancel the press.
    //
    // This replicates the behavior in `@react-aria/interactions` where a press is
    // cancelled when a parent element scrolls. We need to reimplement the behavior
    // here since we manually implement press state. This behavior is important for
    // mobile since the user must press somewhere on the screen to scroll. Normally
    // `pointercancel` should be dispatched when the user scrolls while pressing on
    // some element but when the CSS `touch-action: manipulation` is set the press
    // is not cancelled.
    useEffect(() => {
        if (!isPressed) return;

        const cardElement = assertExists(cardRef.current);

        const handleScroll = () => {
            setIsPressed(false);
        };

        const scrollEventTargets: Array<EventTarget> = [window];

        let parentElement = cardElement.parentElement;
        while (parentElement) {
            const {overflowX, overflowY} = getComputedStyle(parentElement);

            if (
                overflowX === "auto" ||
                overflowX === "scroll" ||
                overflowY === "auto" ||
                overflowY === "scroll"
            ) {
                scrollEventTargets.push(parentElement);
            }

            parentElement =
                parentElement.parentElement !== document.body ? parentElement.parentElement : null;
        }

        for (const scrollEventTarget of scrollEventTargets) {
            scrollEventTarget.addEventListener("scroll", handleScroll, true);
        }

        return () => {
            for (const scrollEventTarget of scrollEventTargets) {
                scrollEventTarget.removeEventListener("scroll", handleScroll, true);
            }
        };
    }, [isPressed]);

    const content = (
        <TaskCardViewContent
            withMobileLayout={withMobileLayout}
            displayStatus={displayStatus}
            title={title}
            assigneeAccountData={assigneeAccountData}
            displayCollections={useStore(
                useMemo(
                    () =>
                        createDisplayTaskCollectionsStore({
                            currentAccount,
                            referencesSubscription: query,
                            collections,
                        }),
                    [collections, currentAccount, query],
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
        listeners: {
            // @ts-expect-error: Added by `TouchSensorWithManualActivation` but TypeScript
            // doesn't know about it.
            onManuallyActivateTouchSensor: onManuallyActivateTouchSensorWithoutMemo,
            ...draggableListeners
        },
        setNodeRef: setDraggableNodeRef,
        active: dndContextActive,
        over: dndContextOver,
    } = useDraggable({
        id: useId(),
        data: {
            type: "Card",
            affinityManager,
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
                    // On mobile since there are so few active cards onscreen at a time, we make the drag overlay
                    opacity={isMobile ? "80" : undefined}
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

    // Checks if a user has confirmed a task can be completed
    const [taskCloseConfirmationState, setTaskCloseConfirmationState] = useState<{
        taskId: TaskId;
        onConfirm: () => void;
    } | null>(null);

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
                // Can't undo changes from the notepad active section.
                undoManager: null,
                affinityManager,
                task,
                onCloseConfirmationDialogueOpen: ({onConfirm}) => {
                    setTaskCloseConfirmationState({taskId: task.id, onConfirm});
                },
            }),
        );

        contextMenuActions.push([
            {
                label: "Delete",
                onPress: () => deleteTaskAndAllChildren(taskId),
            },
        ]);
    }

    const isDraggableAfterLongTouch = !canPrimaryInputHover;

    const onManuallyActivateTouchSensor = useEvent(onManuallyActivateTouchSensorWithoutMemo);

    useEffect(() => {
        if (!isDraggableAfterLongTouch) return;

        const cardElement = assertExists(cardRef.current);

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

                NativeMobileBridge?.haptic.playMediumImpact();

                onManuallyActivateTouchSensor({nativeEvent: event});

                // Dispatch a `pointercancel` event so that we end up setting
                // `setIsPressed(false)` when a drag starts. We could set state directly but
                // this works more generally (say we used a `usePress()` hook).
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

        cardElement.addEventListener("touchstart", handleTouchStart);
        cardElement.addEventListener("touchend", handleTouchEnd);
        cardElement.addEventListener("touchmove", handleTouchMove, {passive: false});
        cardElement.addEventListener("touchcancel", handleTouchCancel);

        return () => {
            touchState?.longTouchTimeout?.clear();
            touchState = null;

            cardElement.removeEventListener("touchstart", handleTouchStart);
            cardElement.removeEventListener("touchend", handleTouchEnd);
            cardElement.removeEventListener("touchmove", handleTouchMove);
            cardElement.removeEventListener("touchcancel", handleTouchCancel);
        };
    }, [isDraggableAfterLongTouch, onManuallyActivateTouchSensor]);

    return (
        <>
            <ContextMenuActions actions={contextMenuActions}>
                <FocusRing offset="border">
                    <Box
                        {...mergeProps(draggableListeners ?? {}, draggableAttributes, {
                            onPointerDown: (event: PointerSyntheticEvent) => {
                                // Only count left clicks.
                                if (event.button !== 0) return;

                                setIsPressed(true);
                            },
                            onPointerUp: (event: PointerSyntheticEvent) => {
                                // Only count left clicks.
                                if (event.button !== 0) return;

                                setIsPressed(false);
                                if (isPressed) onExpand(taskId);
                            },
                            onPointerLeave: () => setIsPressed(false),
                            onPointerCancel: () => setIsPressed(false),
                        })}
                        ref={useMergedRefs<HTMLDivElement>(cardRef, setDraggableNodeRef)}
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
                            minHeight: taskCardViewMinHeight,
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
                                pointerEvents="none"
                                className={pressOpacityOverlayClassName}
                                style={{
                                    inset: 3,
                                    // Nested border radius calculated with:
                                    // https://www.30secondsofcode.org/css/s/nested-border-radius/
                                    borderRadius: `calc(${borderRadius.lg} - 3px)`,
                                }}
                            />
                        )}
                        {content}
                    </Box>
                </FocusRing>
            </ContextMenuActions>
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
