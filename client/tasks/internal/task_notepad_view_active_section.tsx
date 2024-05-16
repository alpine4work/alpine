import {useDroppable} from "@dnd-kit/core";
import {CaretRight} from "phosphor-react";
import {memo, useCallback, useEffect, useId, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {mobileNavigationBarHeight} from "~/client/design/navigation_bar.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {getNewTaskPositionForQuerySortedByPosition} from "~/client/tasks/internal/get_new_task_position_for_query_sorted_by_position.js";
import {
    taskCardViewMaxWidth,
    taskCardViewMinHeight,
} from "~/client/tasks/internal/task_card_view_content.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {TaskNotepadCardView} from "~/client/tasks/internal/task_notepad_card_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {TaskClientStoreSearchAffinityManager} from "~/client/tasks/task_client_store.js";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/task_grid_view_dnd_context.js";
import {
    Spacing,
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {
    colorSchemeVars,
    fontSizes,
    pressOpacityOverlayClassName,
    pulseAnimationClassName,
} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskFilterableTime} from "~/shared/tasks/task_filterable_time.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

const taskNotepadViewActiveSectionMarginTop = {desktop: "4", mobile: "2"} as const;
const taskNotepadViewActiveSectionMarginBottom = "8";
const taskNotepadViewActiveSectionPaddingY = "2";
const taskNotepadViewActiveSectionTitleFontSize = {desktop: "200", mobile: "100"} as const;

export const taskNotepadViewActiveSectionMinHeight = {
    desktop: addRemLengths(
        spacing[taskNotepadViewActiveSectionMarginTop.desktop],
        fontSizes[taskNotepadViewActiveSectionTitleFontSize.desktop].lineHeight,
        spacing[taskNotepadViewActiveSectionPaddingY],
        taskCardViewMinHeight,
        spacing[taskNotepadViewActiveSectionPaddingY],
        spacing[taskNotepadViewActiveSectionMarginBottom],
    ),
    mobile: addRemLengths(
        spacing[taskNotepadViewActiveSectionMarginTop.mobile],
        fontSizes[taskNotepadViewActiveSectionTitleFontSize.mobile].lineHeight,
        spacing[taskNotepadViewActiveSectionPaddingY],
        taskCardViewMinHeight,
        spacing[taskNotepadViewActiveSectionPaddingY],
        spacing[taskNotepadViewActiveSectionMarginBottom],
    ),
};

/**
 * The maximum number of cards to render before rendering a card saying you
 * have too many active tasks.
 */
const maxTaskNotepadActiveCardCount = 7;

/**
 * The minimum number of tasks we expect in our `assigneeActiveQuery`. If the
 * task count dips below this number we'll load more tasks.
 */
export const taskNotepadAssigneeActiveMinLimit = 25;

/**
 * When loading more tasks in `assigneeActiveQuery` we use this limit. It
 * includes more tasks than the min limit so we have some buffer room so in
 * case active tasks are removed we don't immediately need to load more tasks.
 */
export const taskNotepadAssigneeActiveLoadLimit = taskNotepadAssigneeActiveMinLimit + 10;

export const taskNotepadViewActiveSectionCardGap: Spacing = "3";
export const taskNotepadViewActiveSectionCardTranslateDurationMs = 200;

const TaskNotepadViewActiveSectionMemo = memo(TaskNotepadViewActiveSection);
export {TaskNotepadViewActiveSectionMemo as TaskNotepadViewActiveSection};

function TaskNotepadViewActiveSection({
    withMobileLayout,
    affinityManager,
    assigneeActiveQuery,
    activeDraggableData,
    overDroppableData,
}: {
    withMobileLayout: boolean;
    affinityManager: TaskClientStoreSearchAffinityManager;
    assigneeActiveQuery: TaskClientQuery;
    activeDraggableData: TaskGridViewDraggableData | undefined;
    overDroppableData: TaskGridViewDroppableData | undefined;
}) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const loadedState = useStore(assigneeActiveQuery.loadedStateStore);
    const loadMoreTaskCount = useStore(assigneeActiveQuery.loadMoreTaskCountStore);

    const allTasks = useStore(
        useMemo(
            () =>
                assigneeActiveQuery.taskOrderStore.flatMap(taskOrder => {
                    const taskStores: Array<
                        Store<{id: TaskId; assigneeActivePosition: TaskPosition}>
                    > = [];

                    taskOrder.forEach(cursor => {
                        const taskId = getTaskQuerySortCursorTaskId(cursor);

                        taskStores.push(
                            assigneeActiveQuery
                                .getLoadedTaskEntryStore(taskId)
                                // We do this intermediate `map()` that returns the `TaskPosition` so if
                                // something in the task other than the active position changes we don't need
                                // to recompute the entire array.
                                .map(task => assertExists(task.task?.getAssigneeActivePosition()))
                                .map(assigneeActivePosition => ({
                                    id: taskId,
                                    assigneeActivePosition,
                                })),
                        );
                    });

                    return Store.many(taskStores);
                }),
            [assigneeActiveQuery],
        ),
    );

    useEffect(() => {
        // If we're fully loaded, hooray! We don't need to load more tasks.
        if (loadedState === "FullyLoaded") return;

        // We have enough tasks, no need to load more.
        if (allTasks.length >= taskNotepadAssigneeActiveMinLimit) return;

        // Load tasks so our `taskOrder` reaches the load limit. If we're already
        // loading tasks and this hook runs again we don't need to load even more.
        assigneeActiveQuery.loadMoreTasks(
            taskNotepadAssigneeActiveLoadLimit - allTasks.length - loadMoreTaskCount,
        );
    }, [assigneeActiveQuery, loadMoreTaskCount, loadedState, allTasks.length]);

    const [taskDeleteConfirmationState, setTaskDeleteConfirmationState] = useState<{
        taskId: TaskId;
        onAfterDelete?: () => void;
    } | null>(null);

    const expand = useCallback(
        async (taskId: TaskId) => {
            await navigate(`/s/${space.id}/tasks/${taskId}`);
        },
        [navigate, space.id],
    );

    const deleteTaskAndAllChildren = useCallback((taskId: TaskId) => {
        setTaskDeleteConfirmationState({taskId});
    }, []);

    const shouldRenderCardShimmer =
        loadedState !== "FullyLoaded" && allTasks.length < taskNotepadAssigneeActiveMinLimit;

    const shouldRenderTruncatedExplainerCard =
        !shouldRenderCardShimmer && allTasks.length > maxTaskNotepadActiveCardCount;

    const taskCardCount = Math.min(allTasks.length, maxTaskNotepadActiveCardCount);

    // Count of cards excluding placeholder cards.
    const cardCount =
        taskCardCount +
        (shouldRenderCardShimmer ? 1 : 0) +
        (shouldRenderTruncatedExplainerCard ? 1 : 0);

    // There's less horizontal space on mobile for cards than in peeks on desktop.
    const taskCountAboveTheFold = isMobile ? 1 : withMobileLayout ? 2 : 3;

    const cardWidthStyle = `calc(${(1 / taskCountAboveTheFold) * 100}% - ${
        parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) *
            ((taskCountAboveTheFold - 1) / taskCountAboveTheFold) +
        (Math.max(cardCount, taskCountAboveTheFold) > taskCountAboveTheFold
            ? parseRemLengthNumber(spacing[taskCountAboveTheFold <= 1 ? "16" : "4"])
            : 0)
    }rem)`;

    return (
        <Box
            style={{
                minHeight: taskNotepadViewActiveSectionMinHeight[isMobile ? "mobile" : "desktop"],
                paddingTop: `calc(${addRemLengths(
                    spacing[taskNotepadViewActiveSectionMarginTop[isMobile ? "mobile" : "desktop"]],
                    // Make room for the navigation bar on mobile.
                    isMobile ? spacing[mobileNavigationBarHeight] : "0rem",
                )} + var(--safe-area-inset-top, 0px))`,
                // `columnHeaderControls` rendered for the notepad task grid view adds safe
                // area inset top as margin for when it acts as a sticky header, remove a
                // corresponding amount of space from our active section padding bottom.
                paddingBottom: !isMobile
                    ? `max(${spacing[taskNotepadViewActiveSectionMarginBottom]} - var(--safe-area-inset-top, 0px), 0px)`
                    : spacing[taskNotepadViewActiveSectionMarginBottom],
            }}
        >
            <Box
                paddingX={screenPaddingX}
                fontSize={taskNotepadViewActiveSectionTitleFontSize}
                fontStyle="semi-bold"
            >
                Active
            </Box>
            <Box
                data-scrollbar="false"
                paddingX={screenPaddingX}
                paddingY={taskNotepadViewActiveSectionPaddingY}
                overflowX="scroll"
                overflowY="hidden"
                display="flex"
                gap={taskNotepadViewActiveSectionCardGap}
                position="relative"
                zIndex="0"
            >
                {allTasks.slice(0, taskCardCount).map(({id: taskId, assigneeActivePosition}) => (
                    <TaskNotepadCardView
                        key={taskId}
                        withMobileLayout={withMobileLayout}
                        widthStyle={cardWidthStyle}
                        affinityManager={affinityManager}
                        query={assigneeActiveQuery}
                        taskId={taskId}
                        assigneeActivePosition={assigneeActivePosition}
                        onExpand={expand}
                        deleteTaskAndAllChildren={deleteTaskAndAllChildren}
                    />
                ))}
                {shouldRenderCardShimmer && (
                    <TaskNotepadViewActiveSectionCardShimmer
                        widthStyle={cardWidthStyle}
                        activeDraggableData={activeDraggableData}
                        overDroppableData={overDroppableData}
                    />
                )}
                {shouldRenderTruncatedExplainerCard && (
                    <TaskNotepadViewActiveSectionTruncatedExplainerCard
                        taskCardCount={taskCardCount}
                        allTaskCount={allTasks.length}
                        loadedState={loadedState}
                        widthStyle={cardWidthStyle}
                        activeDraggableData={activeDraggableData}
                        overDroppableData={overDroppableData}
                    />
                )}
                {cardCount === 0 && (
                    <TaskNotepadViewActiveSectionInstructionalPlaceholderCard
                        widthStyle={cardWidthStyle}
                    />
                )}
                {cardCount <= 1 && (
                    <TaskNotepadViewActiveSectionPlaceholderCard
                        widthStyle={cardWidthStyle}
                        // If we are dragging a row into our active section, it will push a card into
                        // our placeholder space so hide the placeholder space.
                        shouldHide={
                            overDroppableData?.type === "ActiveCard" &&
                            activeDraggableData?.type === "Row" &&
                            cardCount >= 1
                        }
                    />
                )}
                {cardCount <= 2 && (
                    <TaskNotepadViewActiveSectionPlaceholderCard
                        widthStyle={cardWidthStyle}
                        // If we are dragging a row into our active section, it will push a card into
                        // our placeholder space so hide the placeholder space.
                        shouldHide={
                            overDroppableData?.type === "ActiveCard" &&
                            activeDraggableData?.type === "Row" &&
                            cardCount >= 2
                        }
                    />
                )}
                <Box
                    pointerEvents="none"
                    position="absolute"
                    top="2"
                    bottom="2"
                    left="0"
                    right="0"
                    paddingX={screenPaddingX}
                    display="flex"
                    gap={taskNotepadViewActiveSectionCardGap}
                >
                    {taskCardCount === 0 ? (
                        <TaskNotepadViewActiveSectionDroppable
                            query={assigneeActiveQuery}
                            taskId={null}
                            showHintIndex={0}
                            previousAssigneeActivePosition={null}
                            assigneeActivePosition={null}
                            nextAssigneeActivePosition={null}
                            flexGrow="1"
                        />
                    ) : (
                        allTasks
                            .slice(0, taskCardCount)
                            .map(({id: taskId, assigneeActivePosition}, index) => (
                                <TaskNotepadViewActiveSectionDroppable
                                    key={index}
                                    query={assigneeActiveQuery}
                                    taskId={taskId}
                                    showHintIndex={index}
                                    previousAssigneeActivePosition={
                                        allTasks[index - 1]?.assigneeActivePosition ?? null
                                    }
                                    assigneeActivePosition={assigneeActivePosition}
                                    nextAssigneeActivePosition={
                                        index < allTasks.length - 1
                                            ? allTasks[index + 1]?.assigneeActivePosition ?? null
                                            : null
                                    }
                                    {...(index === taskCardCount - 1 &&
                                    taskCardCount <= 3 &&
                                    activeDraggableData?.type !== "Row"
                                        ? {
                                              flexGrow: "1",
                                          }
                                        : {
                                              flexShrink: "0",
                                              maxWidthStyle: spacing[taskCardViewMaxWidth],
                                              widthStyle: cardWidthStyle,
                                          })}
                                />
                            ))
                    )}
                    {taskCardCount > 0 &&
                        activeDraggableData?.type === "Row" &&
                        createArrayWithLength(
                            cardCount < taskCountAboveTheFold ? 1 : cardCount - taskCardCount + 1,
                            (index, length) => (
                                <TaskNotepadViewActiveSectionDroppable
                                    key={index}
                                    query={assigneeActiveQuery}
                                    taskId={allTasks[taskCardCount]?.id ?? null}
                                    showHintIndex={taskCardCount}
                                    previousAssigneeActivePosition={
                                        allTasks[taskCardCount - 1]?.assigneeActivePosition ?? null
                                    }
                                    assigneeActivePosition={
                                        allTasks[taskCardCount]?.assigneeActivePosition ?? null
                                    }
                                    nextAssigneeActivePosition={
                                        allTasks[taskCardCount + 1]?.assigneeActivePosition ?? null
                                    }
                                    {...(cardCount < taskCountAboveTheFold && index === length - 1
                                        ? {
                                              flexGrow: "1",
                                          }
                                        : {
                                              flexShrink: "0",
                                              maxWidthStyle: spacing[taskCardViewMaxWidth],
                                              widthStyle: cardWidthStyle,
                                              withMarginRight: index === length - 1,
                                          })}
                                />
                            ),
                        )}
                </Box>
                {overDroppableData && overDroppableData.type === "ActiveCard" && (
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        zIndex="-10"
                        top="2"
                        bottom="2"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        display="flex"
                        gap={taskNotepadViewActiveSectionCardGap}
                    >
                        {createArrayWithLength(
                            Math.max(
                                1,
                                taskCardCount +
                                    (taskCardCount > 0 && activeDraggableData?.type === "Row"
                                        ? 1
                                        : 0),
                            ),
                            index => (
                                <Box
                                    key={index}
                                    height="full"
                                    maxWidth={taskCardViewMaxWidth}
                                    flexShrink="0"
                                    borderRadius="lg"
                                    className={pressOpacityOverlayClassName}
                                    style={{
                                        width: cardWidthStyle,
                                        opacity: overDroppableData.showHintIndex === index ? 1 : 0,
                                        transition:
                                            overDroppableData.showHintIndex === index
                                                ? undefined
                                                : // Delay hiding the old hint. This helps the user's eye focus on the
                                                  // card horizontal motion.
                                                  `opacity 0ms ${taskNotepadViewActiveSectionCardTranslateDurationMs}ms`,
                                    }}
                                />
                            ),
                        )}
                    </Box>
                )}
            </Box>
            {taskDeleteConfirmationState && (
                <TaskDeleteConfirmationModalDialog
                    store={assigneeActiveQuery.store}
                    // Can't undo changes from the notepad active section.
                    undoManager={null}
                    taskId={taskDeleteConfirmationState.taskId}
                    onAfterDelete={taskDeleteConfirmationState.onAfterDelete}
                    onClose={() => setTaskDeleteConfirmationState(null)}
                />
            )}
        </Box>
    );
}

function TaskNotepadViewActiveSectionDroppable({
    query,
    taskId,
    showHintIndex,
    previousAssigneeActivePosition,
    assigneeActivePosition,
    nextAssigneeActivePosition,
    flexShrink,
    flexGrow,
    widthStyle,
    maxWidthStyle,
    withMarginRight,
    shouldDebug = false,
}: {
    query: TaskClientQuery;
    taskId: TaskId | null;
    showHintIndex: number;
    previousAssigneeActivePosition: TaskPosition | null;
    assigneeActivePosition: TaskPosition | null;
    nextAssigneeActivePosition: TaskPosition | null;
    flexShrink?: "0" | "1";
    flexGrow?: "0" | "1";
    widthStyle?: number | string;
    maxWidthStyle?: number | string;
    withMarginRight?: boolean;
    // Switch this to `true` if you're in a development environment and need to see
    // the droppable area bounds. Switch back to `false` before committing!
    shouldDebug?: boolean;
}) {
    if (shouldDebug) {
        assert(process.env.NODE_ENV === "development");
    }

    const {currentAccount} = useSpaceContext();
    const {timeZone} = useClientInfo();

    const {setNodeRef} = useDroppable({
        id: useId(),
        data: {
            type: "ActiveCard",
            taskId,
            showHintIndex,
            previousAssigneeActivePosition,
            assigneeActivePosition,
            nextAssigneeActivePosition,
            getDropActions: (task, position) => {
                const actions: Array<TaskAction> = [];

                const updateTime = new TaskFilterableTime({
                    absoluteTime: query.store.clock.now(),
                    setterTimeZone: timeZone,
                });

                // Moving to our active task section means we need to assign ourselves to
                // the task if we aren't already.
                if (task.assigneeAccountId !== currentAccount.id) {
                    actions.push({
                        type: "UpdateTask",
                        time: query.store.clock.now(),
                        taskId: task.taskId,
                        taskAction: {
                            type: "UpdateAssignee",
                            assignee: {
                                assigneeId: currentAccount.id,
                                assignerId: currentAccount.id,
                                assignedTime: updateTime,
                            },
                        },
                    });
                }

                // Moving to our active task section means we need to mark the task as active
                // if it's not active already.
                if (task.displayStatus !== "OpenActive") {
                    if (task.displayStatus === "Closed") {
                        actions.push({
                            type: "UpdateTask",
                            time: query.store.clock.now(),
                            taskId: task.taskId,
                            taskAction: {
                                type: "UpdateStatus",
                                status: {type: "Open"},
                            },
                        });
                    }

                    actions.push({
                        type: "UpdateTask",
                        time: query.store.clock.now(),
                        taskId: task.taskId,
                        taskAction: {
                            type: "UpdateAssigneeStatus",
                            assigneeStatus: {
                                type: "Active",
                                activatedTime: updateTime,
                            },
                        },
                    });
                }

                const moveTime = query.store.clock.now();

                actions.push({
                    type: "UpdateTask",
                    time: moveTime,
                    taskId: task.taskId,
                    taskAction: {
                        type: "UpdateAssigneeActivePosition",
                        accountId: currentAccount.id,
                        position: getNewTaskPositionForQuerySortedByPosition(
                            moveTime,
                            query,
                            position,
                        ),
                    },
                });

                return actions;
            },
        } satisfies TaskGridViewDroppableData,
    });

    return withMarginRight ? (
        <Box
            flexShrink={flexShrink}
            flexGrow={flexGrow}
            height="full"
            style={{
                width: widthStyle,
                maxWidth: maxWidthStyle,
                boxSizing: "content-box",
            }}
            paddingRight="3"
        >
            <Box
                ref={setNodeRef}
                width="full"
                height="full"
                style={{
                    // Debug with a box-shadow to not affect layout.
                    boxShadow: shouldDebug ? `0 0 0 1px ${colorSchemeVars["red-10"]}` : undefined,
                }}
                position="relative"
            />
        </Box>
    ) : (
        <Box
            ref={setNodeRef}
            flexShrink={flexShrink}
            flexGrow={flexGrow}
            height="full"
            style={{
                width: widthStyle,
                maxWidth: maxWidthStyle,
                // Debug with a box-shadow to not affect layout.
                boxShadow: shouldDebug ? `0 0 0 1px ${colorSchemeVars["red-10"]}` : undefined,
            }}
            position="relative"
        />
    );
}

function TaskNotepadViewActiveSectionPlaceholderCard({
    widthStyle,
    shouldHide,
}: {
    widthStyle: string;
    shouldHide: boolean;
}) {
    return (
        <Box
            flexShrink="0"
            maxWidth={taskCardViewMaxWidth}
            minHeight="full"
            borderRadius="lg"
            style={{
                width: widthStyle,
                // Use a box shadow for the border since cards use elevation for their border
                // which uses a box shadow. So this means our placeholders have
                // consistent layout.
                boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
                opacity: shouldHide ? 0 : undefined,
            }}
        >
            <Box style={{height: taskCardViewMinHeight}} />
        </Box>
    );
}

function TaskNotepadViewActiveSectionInstructionalPlaceholderCard({
    widthStyle,
}: {
    widthStyle: string;
}) {
    const illustrationWidth = "10rem";
    const minTextWidth = "9.75rem";

    return (
        <Box
            flexShrink="0"
            position="relative"
            // Render under the grey overlay from our droppable area hints which uses a
            // -10 z-index.
            zIndex="-20"
            maxWidth={taskCardViewMaxWidth}
            minHeight="full"
            borderRadius="lg"
            overflow="hidden"
            style={{
                width: widthStyle,
                // Use a box shadow for the border since cards use elevation for their border
                // which uses a box shadow. So this means our placeholders have
                // consistent layout.
                boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box
                style={{
                    // Height of a card with an extra field (e.g. assignee) and two lines of text
                    // in the title.
                    height: "6.5rem",
                }}
            />
            <Box
                position="absolute"
                left="0"
                bottom="0"
                padding="4"
                style={{width: `calc(100% - ${illustrationWidth})`, minWidth: minTextWidth}}
            >
                <Box fontSize="75" fontStyle="semi-bold" color="grey-70" paddingBottom="1">
                    Mark active
                </Box>
                <Box fontSize="50" color="grey-50">
                    Active tasks help you track what you’re currently working on
                </Box>
            </Box>
            <Box
                position="absolute"
                right="0"
                top="4"
                bottom="0"
                style={{width: illustrationWidth, maxWidth: `calc(100% - ${minTextWidth})`}}
            >
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    width="64"
                    height="64"
                    borderRadius="xl"
                    boxShadow="elevation-20"
                    padding="4"
                    display="flex"
                    flexDirection="column"
                    gap="4"
                    style={{
                        transformOrigin: "top left",
                        // Just a little bit of rotation so it's clear this is an illustration, not
                        // application UI.
                        transform: `rotate(2deg) translateX(${spacing["1"]})`,
                    }}
                >
                    <TaskDisplayStatusCircle displayStatus="OpenActive" size="6" />
                    <Box
                        width="full"
                        height="5"
                        borderRadius="full"
                        backgroundColor="grey-5"
                        style={{opacity: 0.5}}
                    />
                </Box>
            </Box>
        </Box>
    );
}

function TaskNotepadViewActiveSectionCardShimmer({
    widthStyle,
    activeDraggableData,
    overDroppableData,
}: {
    widthStyle: string;
    activeDraggableData: TaskGridViewDraggableData | undefined;
    overDroppableData: TaskGridViewDroppableData | undefined;
}) {
    const shouldPushRight =
        overDroppableData?.type === "ActiveCard" && activeDraggableData?.type !== "Card";

    return (
        <Box
            className={pulseAnimationClassName}
            flexShrink="0"
            maxWidth={taskCardViewMaxWidth}
            minHeight="full"
            borderRadius="lg"
            backgroundColor="grey-5"
            style={{
                width: widthStyle,
                transform: shouldPushRight
                    ? `translateX(100%) translateX(${spacing[taskNotepadViewActiveSectionCardGap]})`
                    : undefined,
                transition: activeDraggableData
                    ? `transform ${taskNotepadViewActiveSectionCardTranslateDurationMs}ms ease`
                    : undefined,
            }}
        >
            <Box style={{height: taskCardViewMinHeight}} />
        </Box>
    );
}

// TODO(calebmer): I feel like we may be missing two important pieces of
// functionality:
//
// 1. The ability to reorder all active tasks. Not just the first 5 or so.
// 2. The ability to mark all active tasks other than the first 5 as inactive.
//
// We want users to have a small number of active tasks so their co-workers
// actually know what they're working on. 2 helps right-size a user's active
// tasks.
//
// For 1 right now we open a view where the tasks are sorted by activated date.
// Ideally we'd open a view where the tasks are manually sortable.
function TaskNotepadViewActiveSectionTruncatedExplainerCard({
    taskCardCount,
    allTaskCount,
    loadedState,
    widthStyle,
    activeDraggableData,
    overDroppableData,
}: {
    taskCardCount: number;
    allTaskCount: number;
    loadedState: "Unloaded" | "PartiallyLoaded" | "FullyLoaded";
    widthStyle: string;
    activeDraggableData: TaskGridViewDraggableData | undefined;
    overDroppableData: TaskGridViewDroppableData | undefined;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const moreTaskCount = allTaskCount - taskCardCount;

    const shouldPushRight =
        overDroppableData?.type === "ActiveCard" && activeDraggableData?.type !== "Card";

    return (
        <Box
            flexShrink="0"
            maxWidth={taskCardViewMaxWidth}
            minHeight="full"
            borderRadius="lg"
            padding="4"
            display="flex"
            flexDirection="column"
            justifyContent="space-between"
            style={{
                width: widthStyle,
                transform: shouldPushRight
                    ? `translateX(100%) translateX(${spacing[taskNotepadViewActiveSectionCardGap]})`
                    : undefined,
                transition: activeDraggableData
                    ? `transform ${taskNotepadViewActiveSectionCardTranslateDurationMs}ms ease`
                    : undefined,
                // Use a box shadow for the border since cards use elevation for their border
                // which uses a box shadow. So this means our placeholders have
                // consistent layout.
                boxShadow: `0 0 0 1px ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <Box display="flex" gap="2">
                <Box
                    style={{height: fontSizes["100"].lineHeight}}
                    display="flex"
                    alignItems="center"
                >
                    <Box width="4" height="4" borderRadius="full" border="grey-10" />
                </Box>
                <Box fontSize="100">
                    {`${moreTaskCount}${loadedState !== "FullyLoaded" ? "+" : ""}`} more{" "}
                    {moreTaskCount !== 1 ? "tasks" : "task"}
                </Box>
            </Box>
            <Box marginX="-2" marginBottom="-2" alignSelf="flex-end">
                <Button
                    variant="quieter"
                    icon={<CaretRight />}
                    iconPlacement="end"
                    height="6"
                    paddingX="2"
                    pressErrorTitle="Couldn’t open view"
                    onPress={async () => {
                        const nameSearchParam = encodeURIComponent("Active tasks assigned to me");

                        const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                            {
                                type: "Assignee",
                                operation: {
                                    type: "OneOf",
                                    accounts: [{type: "CurrentAccount"}],
                                },
                            },
                            {
                                type: "DisplayStatus",
                                operation: {
                                    type: "OneOf",
                                    displayStatuses: new Set(["OpenActive"]),
                                },
                            },
                        ]);

                        const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                            {
                                type: "ActivatedTime",
                                direction: "Descending",
                            },
                        ]);

                        await navigate(
                            `/s/${space.id}/tasks/view?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`,
                        );
                    }}
                >
                    See all active tasks
                </Button>
            </Box>
        </Box>
    );
}
