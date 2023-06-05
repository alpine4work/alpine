import {useDndContext, useDroppable} from "@dnd-kit/core";
import {useId} from "react";
import {Box} from "~/client/design/box";
import {usePeekStackContext} from "~/client/peek/peek_stack";
import {useSpaceContext} from "~/client/spaces/space_context";
import {LocalTasksAction, LocalTasksState} from "~/client/tasks/demo_2/internal/local_tasks_state";
import {
    TaskGridViewDraggableData,
    TaskGridViewDroppableData,
} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {
    TaskCardPresentationalView,
    taskCardViewMaxWidth,
} from "~/client/tasks/demo_2/task_card_presentational_view";
import {
    TaskAssigneeActiveStatus,
    compareTaskAssigneeActiveStatus,
} from "~/client/tasks/demo_2/task_status_button";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {
    colorSchemeVars,
    hideScrollbarClassName,
    pressOpacityOverlayClassName,
    sprinkles,
} from "~/shared/styles/styles";

const taskNotepadViewActiveSectionCardTranslateDurationMs = 200;

export function TaskNotepadViewActiveSection({
    state,
    dispatch,
}: {
    state: LocalTasksState;
    dispatch: (action: LocalTasksAction) => void;
}) {
    const {space, currentAccount} = useSpaceContext();
    const peekStackContext = usePeekStackContext();
    const dndContext = useDndContext();

    const activeDraggableData = dndContext.active?.data.current as
        | TaskGridViewDraggableData<never>
        | undefined;

    const overDroppableData = dndContext.over?.data.current as
        | TaskGridViewDroppableData<never>
        | undefined;

    const tasks = state.database.getActiveTasksForAccount(currentAccount.id);

    const cardWidth = `calc(${(1 / 3) * 100}% - ${
        parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) * (2 / 3) +
        (tasks.length > 3 ? parseRemLengthNumber(spacing["4"]) : 0)
    }rem)`;

    const cardDroppableWidth = `calc(${(1 / 3) * 100}% - ${
        tasks.length > 3 ? parseRemLengthNumber(spacing["4"]) : 0
    }rem)`;

    return (
        <Box marginBottom="-2">
            <Box paddingX="5" fontSize="100" fontStyle="semi-bold">
                Active
            </Box>
            <Box
                paddingX="5"
                paddingY="2"
                overflowX="scroll"
                overflowY="hidden"
                className={hideScrollbarClassName}
                display="flex"
                gap={taskNotepadViewActiveSectionCardGap}
                position="relative"
                zIndex="0"
            >
                {tasks.map(({task, assigneeActiveStatus}) => {
                    const shouldPushRight =
                        overDroppableData?.type === "ActiveCard" &&
                        overDroppableData.assigneeActiveStatus &&
                        compareTaskAssigneeActiveStatus(
                            overDroppableData.assigneeActiveStatus,
                            assigneeActiveStatus,
                        ) <= 0 &&
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
                            (activeDraggableData.assignee?.status.type === "Active" &&
                                compareTaskAssigneeActiveStatus(
                                    activeDraggableData.assignee.status,
                                    assigneeActiveStatus,
                                ) > 0));

                    const shouldPushLeft =
                        overDroppableData?.type === "ActiveCard" &&
                        overDroppableData.assigneeActiveStatus &&
                        compareTaskAssigneeActiveStatus(
                            overDroppableData.assigneeActiveStatus,
                            assigneeActiveStatus,
                        ) >= 0 &&
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
                        activeDraggableData.assignee?.status.type === "Active" &&
                        compareTaskAssigneeActiveStatus(
                            activeDraggableData.assignee.status,
                            assigneeActiveStatus,
                        ) < 0;

                    return (
                        <Box
                            key={task.id}
                            flexShrink="0"
                            maxWidth={taskCardViewMaxWidth}
                            style={{
                                width: cardWidth,
                                transform: shouldPushRight
                                    ? `translateX(100%) translateX(${spacing[taskNotepadViewActiveSectionCardGap]})`
                                    : shouldPushLeft
                                    ? `translateX(-100%) translateX(-${spacing[taskNotepadViewActiveSectionCardGap]})`
                                    : undefined,
                                transition: dndContext.active
                                    ? `transform ${taskNotepadViewActiveSectionCardTranslateDurationMs}ms ease`
                                    : undefined,
                            }}
                        >
                            <TaskCardPresentationalView
                                shouldFillHeight={true}
                                id={task.id}
                                status={task.status}
                                onStatusChange={status =>
                                    dispatch({
                                        type: "UpdateTaskStatus",
                                        taskId: task.id,
                                        status,
                                    })
                                }
                                title={task.title}
                                assignee={task.assignee}
                                dueDate={task.dueDate}
                                collections={Array.from(task.collectionIds, collectionId =>
                                    state.database.getTaskCollection(collectionId),
                                )}
                                onExpand={async () => {
                                    await peekStackContext.push(
                                        `/s/${space.id}/tasks/demo-2/${task.id}`,
                                    );
                                }}
                            />
                        </Box>
                    );
                })}
                {tasks.length === 0 && (
                    <TaskNotepadViewActiveSectionInstructionalPlaceholderCard
                        cardWidth={cardWidth}
                    />
                )}
                {tasks.length <= 1 && (
                    <TaskNotepadViewActiveSectionPlaceholderCard
                        cardWidth={cardWidth}
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
                        cardWidth={cardWidth}
                        // If we are dragging a row into our active section, it will push a card into
                        // our placeholder space so hide the placeholder space.
                        shouldHide={
                            overDroppableData?.type === "ActiveCard" &&
                            activeDraggableData?.type === "Row" &&
                            tasks.length >= 2
                        }
                    />
                )}
                <Box
                    pointerEvents="none"
                    position="absolute"
                    top="2"
                    bottom="2"
                    display="flex"
                    style={{
                        left: `${
                            parseRemLengthNumber(spacing["5"]) -
                            parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) / 2
                        }rem`,
                        right: `${
                            parseRemLengthNumber(spacing["5"]) -
                            parseRemLengthNumber(spacing[taskNotepadViewActiveSectionCardGap]) / 2
                        }rem`,
                    }}
                >
                    {tasks.length === 0 ? (
                        <TaskNotepadViewActiveSectionDroppable
                            showHintIndex={0}
                            previousAssigneeActiveStatus={null}
                            assigneeActiveStatus={null}
                            nextAssigneeActiveStatus={null}
                            flexGrow="1"
                        />
                    ) : (
                        tasks.map(({assigneeActiveStatus}, index) => (
                            <TaskNotepadViewActiveSectionDroppable
                                key={index}
                                showHintIndex={index}
                                previousAssigneeActiveStatus={
                                    tasks[index - 1]?.assigneeActiveStatus ?? null
                                }
                                assigneeActiveStatus={assigneeActiveStatus}
                                nextAssigneeActiveStatus={
                                    tasks[index + 1]?.assigneeActiveStatus ?? null
                                }
                                {...(index === tasks.length - 1 &&
                                tasks.length < 3 &&
                                activeDraggableData?.type !== "Row"
                                    ? {
                                          flexGrow: "1",
                                      }
                                    : {
                                          flexShrink: "0",
                                          widthStyle: cardDroppableWidth,
                                      })}
                            />
                        ))
                    )}
                    {tasks.length > 0 && activeDraggableData?.type === "Row" && (
                        <TaskNotepadViewActiveSectionDroppable
                            showHintIndex={tasks.length}
                            previousAssigneeActiveStatus={
                                tasks[tasks.length - 1]?.assigneeActiveStatus ?? null
                            }
                            assigneeActiveStatus={null}
                            nextAssigneeActiveStatus={null}
                            {...(tasks.length < 3
                                ? {
                                      flexGrow: "1",
                                  }
                                : {
                                      flexShrink: "0",
                                      widthStyle: cardDroppableWidth,
                                  })}
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
                                        width: cardWidth,
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

function TaskNotepadViewActiveSectionDroppable({
    showHintIndex,
    previousAssigneeActiveStatus,
    assigneeActiveStatus,
    nextAssigneeActiveStatus,
    flexShrink,
    flexGrow,
    widthStyle,
}: {
    showHintIndex: number;
    previousAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
    assigneeActiveStatus: TaskAssigneeActiveStatus | null;
    nextAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
    flexShrink?: "0" | "1";
    flexGrow?: "0" | "1";
    widthStyle?: number | string;
}) {
    // Switch this to `true` if you're in a development environment and need to see
    // the droppable area bounds. Switch back to `false` before committing!
    const shouldDebug = false;

    const {setNodeRef} = useDroppable({
        id: useId(),
        data: {
            type: "ActiveCard",
            showHintIndex,
            previousAssigneeActiveStatus,
            assigneeActiveStatus,
            nextAssigneeActiveStatus,
        } satisfies TaskGridViewDroppableData<never>,
    });

    return (
        <Box
            ref={setNodeRef}
            flexShrink={flexShrink}
            flexGrow={flexGrow}
            height="full"
            style={{
                width: widthStyle,
                // Debug with a box-shadow to not affect layout.
                boxShadow: shouldDebug ? `0 0 0 1px ${colorSchemeVars["red-10"]}` : undefined,
            }}
            position="relative"
        />
    );
}

const taskNotepadViewActiveSectionCardGap: Spacing = "3";

function TaskNotepadViewActiveSectionPlaceholderCard({
    cardWidth,
    shouldHide,
}: {
    cardWidth: string;
    shouldHide: boolean;
}) {
    return (
        <Box
            flexShrink="0"
            maxWidth={taskCardViewMaxWidth}
            minHeight="full"
            borderRadius="lg"
            style={{
                width: cardWidth,
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
    cardWidth,
}: {
    cardWidth: string;
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
                width: cardWidth,
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
                    <svg
                        // `cursor-arrow-rays` icon from Heroicons
                        // https://heroicons.com
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className={sprinkles({
                            position: "absolute",
                            zIndex: "10",
                            width: "5",
                            height: "5",
                        })}
                        style={{
                            transform: "rotate(-2deg)",
                            left: "5.75rem",
                            top: "1.625rem",
                            fill: colorSchemeVars["grey-text"],
                        }}
                    >
                        <path
                            fillRule="evenodd"
                            d="M12 1.5a.75.75 0 01.75.75V4.5a.75.75 0 01-1.5 0V2.25A.75.75 0 0112 1.5zM5.636 4.136a.75.75 0 011.06 0l1.592 1.591a.75.75 0 01-1.061 1.06l-1.591-1.59a.75.75 0 010-1.061zm12.728 0a.75.75 0 010 1.06l-1.591 1.592a.75.75 0 01-1.06-1.061l1.59-1.591a.75.75 0 011.061 0zm-6.816 4.496a.75.75 0 01.82.311l5.228 7.917a.75.75 0 01-.777 1.148l-2.097-.43 1.045 3.9a.75.75 0 01-1.45.388l-1.044-3.899-1.601 1.42a.75.75 0 01-1.247-.606l.569-9.47a.75.75 0 01.554-.68zM3 10.5a.75.75 0 01.75-.75H6a.75.75 0 010 1.5H3.75A.75.75 0 013 10.5zm14.25 0a.75.75 0 01.75-.75h2.25a.75.75 0 010 1.5H18a.75.75 0 01-.75-.75zm-8.962 3.712a.75.75 0 010 1.061l-1.591 1.591a.75.75 0 11-1.061-1.06l1.591-1.592a.75.75 0 011.06 0z"
                            clipRule="evenodd"
                        />
                    </svg>
                    <Box display="flex" alignItems="center" gap="2.5">
                        <Box
                            position="relative"
                            width="6"
                            height="6"
                            borderRadius="full"
                            border="grey-40"
                        >
                            <Box
                                position="absolute"
                                top="0"
                                left="0"
                                height="6"
                                overflow="hidden"
                                style={{
                                    width: `${parseRemLengthNumber(spacing["6"]) / 2}rem`,
                                    transform: `translate(-1px, -1px) translateX(${
                                        parseRemLengthNumber(spacing["6"]) / 2
                                    }rem) scale(${(16 - 5) / 16})`,
                                    transformOrigin: "center left",
                                }}
                            >
                                <Box
                                    position="absolute"
                                    top="0"
                                    right="0"
                                    width="6"
                                    height="6"
                                    borderRadius="full"
                                    backgroundColor={{
                                        light: "theme-20-const",
                                        dark: "theme-30-const",
                                    }}
                                />
                            </Box>
                        </Box>
                        <Box fontSize="100" color="grey-70" display="flex" alignItems="center">
                            Active
                        </Box>
                    </Box>
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
