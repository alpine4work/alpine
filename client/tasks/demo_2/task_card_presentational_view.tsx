import {useDraggable} from "@dnd-kit/core";
import {CalendarDate} from "@internationalized/date";
import {CalendarBlank} from "phosphor-react";
import {PointerEvent, cloneElement, useId, useMemo, useState} from "react";
import {mergeProps} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {ContextMenuActions} from "~/client/design/context_menu";
import {FocusRing} from "~/client/design/focus_ring";
import {useClientInfo} from "~/client/remix/client_info_context";
import {useCurrentDate} from "~/client/remix/use_current_time_rounded_to_hour";
import {useSpaceContext} from "~/client/spaces/space_context";
import {formatTaskDate} from "~/client/tasks/demo_2/internal/format_task_date";
import {getTaskPriorityName} from "~/client/tasks/demo_2/internal/get_task_priority_name";
import {getTaskStatusMenuActions} from "~/client/tasks/demo_2/internal/get_task_status_menu_actions";
import {TaskChildTasksProgressWheel} from "~/client/tasks/demo_2/internal/task_child_tasks_progress_wheel";
import {
    TaskCollectionChip,
    taskCollectionChipContainerMaxWidth,
} from "~/client/tasks/demo_2/internal/task_collection_chip";
import {TaskGridViewDraggableData} from "~/client/tasks/demo_2/internal/task_grid_view_dnd_context";
import {TaskPriorityIcon} from "~/client/tasks/demo_2/internal/task_priority_icon";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {TaskAssignee, TaskStatus, TaskStatusButton} from "~/client/tasks/demo_2/task_status_button";
import {addRemLengths, parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {LocalTaskId} from "~/shared/id/types/id_types";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles, pressOpacityOverlayClassName} from "~/shared/styles/styles";
import {TaskPriority} from "~/shared/tasks/task_priority";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

export const taskCardViewMaxWidth = "96";

/**
 * The card is a dense non-editable presentation of a task for easy
 * reading/skimming. By removing the need to edit on this surface we can
 * optimize for reading.
 */
export function TaskCardPresentationalView({
    id,
    status,
    onStatusChange,
    title,
    assignee,
    onAssigneeChange,
    priority,
    dueDate,
    collections,
    childTaskCount,
    closedChildTaskCount,
    onExpand,
    shouldFillHeight,
    isDragOverlay,
    deleteTaskAndAllChildrenMaybeWithConfirmation,
}: {
    id: LocalTaskId;
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    assignee: TaskAssignee | null;
    onAssigneeChange: (assignee: TaskAssignee | null) => void;
    priority: TaskPriority | null;
    dueDate: CalendarDate | null;
    collections: ReadonlyArray<LocalTaskCollection>;
    childTaskCount: number;
    closedChildTaskCount: number;
    onExpand: () => Promise<void>;
    shouldFillHeight?: boolean;
    isDragOverlay?: boolean;
    deleteTaskAndAllChildrenMaybeWithConfirmation: () => void;
}) {
    const {timeZone, locale} = useClientInfo();
    const currentDate = useCurrentDate();
    const {currentAccount} = useSpaceContext();

    // We manually implement `usePress()` so to play nice with drag-and-drop.
    const [isPressed, setIsPressed] = useState(false);

    const onPress = () => {
        const promise = onExpand();

        // TODO(calebmer, #global-loading-indicator): Some kind of global loading
        // indicator for navigation?
        void promise;
    };

    const {
        isDragging,
        attributes: draggableAttributes,
        listeners: draggableListeners,
        setNodeRef: setDraggableNodeRef,
    } = useDraggable({
        id: useId(),
        disabled: isDragOverlay,
        data: {
            type: "Card",
            id,
            status,
            title,
            assignee,
            priority,
            dueDate,
            collections,
            childTaskCount,
            closedChildTaskCount,
        } satisfies TaskGridViewDraggableData<never>,
    });

    const fieldElements = useMemo(() => {
        const fieldElements = [];

        if (childTaskCount > 0) {
            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1"
                    style={{
                        paddingRight:
                            fieldElements.length === 0
                                ? addRemLengths(
                                      spacing["2"],
                                      // A little extra padding to offset the negative margin of collection chips.
                                      spacing["1"],
                                  )
                                : spacing["2"],
                    }}
                >
                    <TaskChildTasksProgressWheel
                        childTaskCount={childTaskCount}
                        closedChildTaskCount={closedChildTaskCount}
                    />
                    <Box color="grey-70">
                        {closedChildTaskCount}/{childTaskCount}
                    </Box>
                </Box>,
            );
        }

        if (dueDate) {
            const {isAfterDate: isAfterDueDate, dateString: dueDateString} = formatTaskDate({
                timeZone,
                locale,
                currentDate,
                date: dueDate,
                shouldFormatAroundToday: true,
            });

            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1"
                    color={status.type === "Open" && isAfterDueDate ? "red-60" : "grey-60"}
                    style={{
                        paddingRight:
                            fieldElements.length === 0
                                ? addRemLengths(
                                      spacing["2"],
                                      // A little extra padding to offset the negative margin of collection chips.
                                      spacing["1"],
                                  )
                                : spacing["2"],
                    }}
                >
                    <CalendarBlank size={spacing["4"]} />
                    <Box fontStyle="truncate">{dueDateString}</Box>
                </Box>,
            );
        }

        if (priority) {
            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="1"
                    style={{
                        paddingRight:
                            fieldElements.length === 0
                                ? addRemLengths(
                                      spacing["2"],
                                      // A little extra padding to offset the negative margin of collection chips.
                                      spacing["1"],
                                  )
                                : spacing["2"],
                    }}
                >
                    <TaskPriorityIcon size="4" priority={priority} shouldHighlightUrgent={true} />
                    <Box fontStyle="truncate">{getTaskPriorityName(priority)}</Box>
                </Box>,
            );
        }

        if (assignee) {
            fieldElements.push(
                <Box
                    display="flex"
                    alignItems="center"
                    gap="2"
                    maxWidth="32"
                    style={{
                        paddingRight:
                            fieldElements.length === 0
                                ? addRemLengths(
                                      spacing["2"],
                                      // A little extra padding to offset the negative margin of collection chips.
                                      spacing["1"],
                                  )
                                : spacing["2"],
                    }}
                >
                    <Box position="relative" width="4" height="4">
                        <Box position="absolute" top="-0.5" left="-0.5">
                            <AccountAvatar size="5" account={assignee.account} />
                        </Box>
                    </Box>
                    <Box fontStyle="truncate" color="grey-60">
                        <AccountShortName account={assignee.account} tooltipPlacement="bottom" />
                    </Box>
                </Box>,
            );
        }

        // We add fields in reverse so that we can check `fieldElements.length === 0`
        // to tell if we are the last field before collections.
        fieldElements.reverse();

        for (const collection of collections) {
            fieldElements.push(
                <Box
                    overflow="hidden"
                    marginY="-0.5"
                    marginLeft="-1"
                    style={{maxWidth: taskCollectionChipContainerMaxWidth}}
                >
                    <TaskCollectionChip collection={collection} />
                </Box>,
            );
        }

        return fieldElements;
    }, [
        assignee,
        childTaskCount,
        closedChildTaskCount,
        collections,
        currentDate,
        dueDate,
        locale,
        priority,
        status.type,
        timeZone,
    ]);

    return (
        <ContextMenuActions
            actions={[
                [
                    {
                        label: "Copy link",
                        onPress: () => {
                            // NOCOMMIT: Needs production implementation
                        },
                    },
                ],
                getTaskStatusMenuActions({
                    timeZone,
                    currentAccount,
                    status,
                    onStatusChange,
                    assignee,
                    onAssigneeChange,
                }),
                [
                    {
                        label: "Delete",
                        onPress: deleteTaskAndAllChildrenMaybeWithConfirmation,
                    },
                ],
            ]}
        >
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
                    width="full"
                    maxWidth={taskCardViewMaxWidth}
                    minHeight={shouldFillHeight ? "full" : undefined}
                    overflow="hidden"
                    backgroundColor="grey-0"
                    boxShadow={isDragOverlay ? "elevation-30" : "elevation-5"}
                    borderRadius="lg"
                    padding="4"
                    display="flex"
                    flexDirection="column"
                    justifyContent="space-between"
                    gap="4"
                    position="relative"
                    zIndex="0"
                    opacity={isDragging ? "0" : undefined}
                    pointerEvents={isDragging || isDragOverlay ? "none" : undefined}
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
                    <Box
                        display="flex"
                        gap="2"
                        // Extra margin on the right to balance margin on the left from status button.
                        paddingRight="3"
                    >
                        <Box
                            flexShrink="0"
                            display="flex"
                            alignItems="center"
                            style={{height: contentSchemaStyles.paragraphFontSize.lineHeight}}
                            // Render status button on top of the press overlay to try and communicate that
                            // it is independently clickable from the rest of the card.
                            position="relative"
                            zIndex="20"
                        >
                            <TaskStatusButton
                                status={status}
                                onStatusChange={onStatusChange}
                                assignee={assignee}
                                isDisabled={isDragging || isDragOverlay}
                            />
                        </Box>
                        <Box
                            flexGrow="1"
                            color="grey-text"
                            style={{
                                overflow: "hidden",
                                ...contentSchemaStyles.paragraphFontSize,
                                maxHeight: `${
                                    parseRemLengthNumber(
                                        contentSchemaStyles.paragraphFontSize.lineHeight,
                                    ) * 3
                                }rem`,
                                // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                                // except IE.
                                // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                                display: "-webkit-box",
                                WebkitLineClamp: 3,
                                lineClamp: 3,
                                WebkitBoxOrient: "vertical",
                                textOverflow: "ellipsis",
                            }}
                            dangerouslySetInnerHTML={useMemo(
                                () => ({
                                    __html: serializeProsemirrorFragmentToHtml(title.content),
                                }),
                                [title],
                            )}
                        />
                    </Box>
                    {fieldElements.length > 0 && (
                        <Box display="flex" flexWrap="wrap" gap="3">
                            {fieldElements.map((node, index) => cloneElement(node, {key: index}))}
                        </Box>
                    )}
                </Box>
            </FocusRing>
        </ContextMenuActions>
    );
}
