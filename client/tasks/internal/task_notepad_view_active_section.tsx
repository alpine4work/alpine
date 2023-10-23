import {useDndContext, useDroppable} from "@dnd-kit/core";
import {memo, useEffect, useId, useMemo, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {usePeekStackContext} from "~/client/peek/peek_stack.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {taskCardViewMaxWidth} from "~/client/tasks/internal/task_card_view_content.js";
import {TaskDeleteConfirmationModalDialog} from "~/client/tasks/internal/task_delete_confirmation_modal_dialog.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {TaskNotepadCardView} from "~/client/tasks/internal/task_notepad_card_view.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/task_grid_view_dnd_context.js";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {colorSchemeVars, pressOpacityOverlayClassName} from "~/shared/styles/styles.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";
import {getTaskQuerySortCursorTaskId} from "~/shared/tasks/task_query_sort_cursor.js";

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
    assigneeActiveQuery,
}: {
    assigneeActiveQuery: TaskClientQuery;
}) {
    const {space} = useSpaceContext();
    const peekStackContext = usePeekStackContext();

    const loadedState = useStore(assigneeActiveQuery.loadedStateStore);
    const loadMoreTaskCount = useStore(assigneeActiveQuery.loadMoreTaskCountStore);

    const tasks = useStore(
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
        if (tasks.length >= taskNotepadAssigneeActiveMinLimit) return;

        // Load tasks so our `taskOrder` reaches the load limit. If we're already
        // loading tasks and this hook runs again we don't need to load even more.
        assigneeActiveQuery.loadMoreTasks(
            taskNotepadAssigneeActiveLoadLimit - tasks.length - loadMoreTaskCount,
        );
    }, [assigneeActiveQuery, loadMoreTaskCount, loadedState, tasks.length]);

    const cardWidthStyle = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) * (2 / 3) +
        (tasks.length > 3 || loadedState !== "FullyLoaded" ? parseRemLengthNumber(spacing["4"]) : 0)
    }rem)`;

    const dndContext = useDndContext();

    // NOCOMMIT: Loading states

    const activeDraggableData = dndContext.active?.data.current as
        | TaskGridViewDraggableData
        | undefined;

    const overDroppableData = dndContext.over?.data.current as
        | TaskGridViewDroppableData
        | undefined;

    return (
        <Box paddingTop="4" paddingBottom="10">
            <Box paddingX="5" fontSize="200" fontStyle="semi-bold">
                Active
            </Box>
            <Box
                data-scrollbar="false"
                paddingX="5"
                paddingY="2"
                overflowX="scroll"
                overflowY="hidden"
                display="flex"
                gap={taskNotepadViewActiveSectionCardGap}
                position="relative"
                zIndex="0"
            >
                {tasks.map(({id: taskId, assigneeActivePosition}) => (
                    <TaskNotepadCardView
                        key={taskId}
                        widthStyle={cardWidthStyle}
                        query={assigneeActiveQuery}
                        taskId={taskId}
                        assigneeActivePosition={assigneeActivePosition}
                        onExpand={async () => {
                            await peekStackContext.push(`/s/${space.id}/tasks/${taskId}`);
                        }}
                        deleteTaskAndAllChildrenMaybeWithConfirmation={() => {
                            // NOCOMMIT
                        }}
                    />
                ))}
                {loadedState === "FullyLoaded" && (
                    <>
                        {tasks.length === 0 && (
                            <TaskNotepadViewActiveSectionInstructionalPlaceholderCard
                                widthStyle={cardWidthStyle}
                            />
                        )}
                        {tasks.length <= 1 && (
                            <TaskNotepadViewActiveSectionPlaceholderCard
                                widthStyle={cardWidthStyle}
                                // If we are dragging a row into our active section, it will push a card into
                                // our placeholder space so hide the placeholder space.
                                shouldHide={
                                    overDroppableData?.type === "ActiveCard" &&
                                    activeDraggableData?.type === "Row" &&
                                    tasks.length >= 1
                                }
                            />
                        )}
                        {tasks.length <= 2 && (
                            <TaskNotepadViewActiveSectionPlaceholderCard
                                widthStyle={cardWidthStyle}
                                // If we are dragging a row into our active section, it will push a card into
                                // our placeholder space so hide the placeholder space.
                                shouldHide={
                                    overDroppableData?.type === "ActiveCard" &&
                                    activeDraggableData?.type === "Row" &&
                                    tasks.length >= 2
                                }
                            />
                        )}
                    </>
                )}
                <Box
                    pointerEvents="none"
                    position="absolute"
                    top="2"
                    bottom="2"
                    left="0"
                    right="0"
                    paddingX="5"
                    display="flex"
                    gap={taskNotepadViewActiveSectionCardGap}
                >
                    {tasks.length === 0 ? (
                        <TaskNotepadViewActiveSectionDroppable
                            showHintIndex={0}
                            previousAssigneeActivePosition={null}
                            assigneeActivePosition={null}
                            nextAssigneeActivePosition={null}
                            flexGrow="1"
                        />
                    ) : (
                        tasks.map(({assigneeActivePosition}, index) => (
                            <TaskNotepadViewActiveSectionDroppable
                                key={index}
                                showHintIndex={index}
                                previousAssigneeActivePosition={
                                    tasks[index - 1]?.assigneeActivePosition ?? null
                                }
                                assigneeActivePosition={assigneeActivePosition}
                                nextAssigneeActivePosition={
                                    tasks[index + 1]?.assigneeActivePosition ?? null
                                }
                                {...(index === tasks.length - 1 &&
                                tasks.length <= 3 &&
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
                    {tasks.length > 0 && activeDraggableData?.type === "Row" && (
                        <TaskNotepadViewActiveSectionDroppable
                            showHintIndex={tasks.length}
                            previousAssigneeActivePosition={
                                tasks[tasks.length - 1]?.assigneeActivePosition ?? null
                            }
                            assigneeActivePosition={null}
                            nextAssigneeActivePosition={null}
                            {...(tasks.length < 3
                                ? {
                                      flexGrow: "1",
                                  }
                                : {
                                      flexShrink: "0",
                                      maxWidthStyle: spacing[taskCardViewMaxWidth],
                                      widthStyle: cardWidthStyle,
                                  })}
                            withMarginRight={true}
                        />
                    )}
                </Box>
                {overDroppableData && overDroppableData.type === "ActiveCard" && (
                    <Box
                        pointerEvents="none"
                        position="absolute"
                        zIndex="-10"
                        top="2"
                        bottom="2"
                        left="5"
                        right="5"
                        display="flex"
                        gap={taskNotepadViewActiveSectionCardGap}
                    >
                        {createArrayWithLength(
                            Math.max(
                                1,
                                tasks.length +
                                    (tasks.length > 0 && activeDraggableData?.type === "Row"
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
        </Box>
    );
}

function F() {
    const [showDeleteConfirmationForTaskId, setShowDeleteConfirmationForTaskId] =
        useState<TaskId | null>(null);

    return (
        <>
            {showDeleteConfirmationForTaskId && (
                <TaskDeleteConfirmationModalDialog
                    state={state}
                    dispatch={dispatch}
                    taskId={showDeleteConfirmationForTaskId}
                    onClose={() => setShowDeleteConfirmationForTaskId(null)}
                />
            )}
        </>
    );
}

function TaskNotepadViewActiveSectionDroppable({
    showHintIndex,
    previousAssigneeActivePosition,
    assigneeActivePosition,
    nextAssigneeActivePosition,
    flexShrink,
    flexGrow,
    widthStyle,
    maxWidthStyle,
    withMarginRight,
}: {
    showHintIndex: number;
    previousAssigneeActivePosition: TaskPosition | null;
    assigneeActivePosition: TaskPosition | null;
    nextAssigneeActivePosition: TaskPosition | null;
    flexShrink?: "0" | "1";
    flexGrow?: "0" | "1";
    widthStyle?: number | string;
    maxWidthStyle?: number | string;
    withMarginRight?: boolean;
}) {
    // Switch this to `true` if you're in a development environment and need to see
    // the droppable area bounds. Switch back to `false` before committing!
    const shouldDebug = false;

    const {setNodeRef} = useDroppable({
        id: useId(),
        data: {
            type: "ActiveCard",
            showHintIndex,
            previousAssigneeActivePosition,
            assigneeActivePosition,
            nextAssigneeActivePosition,
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
            <Box
                style={{
                    // Height of a card with an extra field (e.g. assignee) and one line of text in
                    // the title.
                    height: "5.25rem",
                }}
            />
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
                    Mark tasks as active
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
