import {
    CollisionDescriptor,
    CollisionDetection,
    DndContext,
    DragOverlay,
    MouseSensor,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {MouseSensorProps} from "@dnd-kit/core/dist/sensors";
import {CalendarDate} from "@internationalized/date";
import {ReactNode, RefObject, createContext, useContext, useState} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority";
import {useSpaceContext} from "~/client/spaces/space_context";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";
import {TaskCardPresentationalView} from "~/client/tasks/demo_2/task_card_presentational_view";
import {taskRowViewHeight} from "~/client/tasks/demo_2/task_row_presentational_view";
import {
    TaskAssignee,
    TaskAssigneeActiveStatus,
    TaskStatus,
    TaskStatusButton,
} from "~/client/tasks/demo_2/task_status_button";
import {spacing} from "~/shared/design/spacing";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {noop} from "~/shared/helpers/control/noop";
import {generateOrderKeyBetween, initialOrderKey} from "~/shared/helpers/sort/order_key";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {contentSchemaStyles} from "~/shared/styles/styles";
import {TaskTitle} from "~/shared/tasks/task_title_schema";

const TaskGridViewHasDndContext = createContext(false);

export type TaskGridViewDraggableData<TaskRow> =
    | {
          readonly type: "Row";
          readonly taskRow: TaskRow;
      }
    | {
          readonly type: "Card";
          readonly status: TaskStatus;
          readonly title: TaskTitle;
          readonly assignee: TaskAssignee | null;
          readonly dueDate: CalendarDate | null;
          readonly collections: ReadonlyArray<LocalTaskCollection>;
      };

export type TaskGridViewDroppableData<TaskRow> =
    | {
          readonly type: "Row";
          readonly taskRow: TaskRow | null;
          readonly indentation: number;
      }
    | {
          readonly type: "ActiveCard";
          readonly showHintIndex: number;
          readonly nextAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
          readonly previousAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
      };

class MouseSensorWithImmediatePriorityEnd extends MouseSensor {
    constructor(props: MouseSensorProps) {
        super({
            ...props,
            onEnd: () => {
                // Run the `onEnd` handler with immediate priority. This means React will batch
                // any `useSyncExternalStore()` updates with any state updates at the end of
                // the drag. So we won't have weird flashes where an external store has updated
                // but not our drag state.
                runWithImmediatePriority(() => {
                    props.onEnd();
                });
            },
        });
    }
}

export function TaskGridViewDndContext<TaskRow>({
    children,
    getTaskStatus,
    getTaskAssignee,
    onTaskAssigneeChange,
    getTaskTitle,
    getTaskAreChildTasksCollapsed,
    getTaskRowIndentation,
    moveTaskBelow,
    moveTaskToParentTop,
}: {
    children?: ReactNode;
    getTaskStatus: (taskRow: TaskRow) => TaskStatus;
    getTaskAssignee: (taskRow: TaskRow) => TaskAssignee | null;
    onTaskAssigneeChange: (taskRow: TaskRow, assignee: TaskAssignee) => void;
    getTaskTitle: (taskRow: TaskRow) => TaskTitle;
    getTaskAreChildTasksCollapsed: (taskRow: TaskRow) => boolean;
    getTaskRowIndentation: (taskRow: TaskRow) => number;
    moveTaskBelow: (belowTaskRow: TaskRow | null, unnest: number, taskRow: TaskRow) => void;
    moveTaskToParentTop: (parentTaskRow: TaskRow, taskRow: TaskRow) => void;
}) {
    const {currentAccount} = useSpaceContext();

    const mouseSensor = useSensor(MouseSensorWithImmediatePriorityEnd, {
        activationConstraint: {
            // The mouse must move to activate dragging. This is required for cards which
            // when clicked expand the task and when dragged can be reordered.
            distance: 1,
        },
    });

    // No keyboard sensor. To move task rows and cards with the keyboard we should
    // have other keyboard shortcuts.
    const sensors = useSensors(mouseSensor);

    // If we already have a parent `<TaskGridViewDndContext>` then don't render
    // another one. This allows us to "hoist" up drag-and-drop functionality.
    if (useContext(TaskGridViewHasDndContext)) return <>{children}</>;

    return (
        <TaskGridViewHasDndContext.Provider value={true}>
            <DndContext
                sensors={sensors}
                collisionDetection={taskGridViewDndCollisionDetection}
                onDragEnd={({active, over}) => {
                    if (!over) return;

                    const activeData = assertExists(
                        active.data.current,
                    ) as TaskGridViewDraggableData<TaskRow>;
                    const overData = assertExists(
                        over.data.current,
                    ) as TaskGridViewDroppableData<TaskRow>;

                    // NOCOMMIT: Implement!
                    if (activeData.type === "Card") return;

                    switch (overData.type) {
                        case "Row": {
                            const unnest = Math.max(
                                0,
                                (overData.taskRow ? getTaskRowIndentation(overData.taskRow) : 0) -
                                    overData.indentation,
                            );

                            if (
                                overData.taskRow &&
                                unnest === 0 &&
                                !getTaskAreChildTasksCollapsed(overData.taskRow)
                            ) {
                                moveTaskToParentTop(overData.taskRow, activeData.taskRow);
                            } else {
                                moveTaskBelow(overData.taskRow, unnest, activeData.taskRow);
                            }
                            break;
                        }
                        case "ActiveCard": {
                            if (
                                overData.nextAssigneeActiveStatus &&
                                overData.previousAssigneeActiveStatus
                            ) {
                                if (
                                    overData.nextAssigneeActiveStatus.orderTime.toString() ===
                                    overData.previousAssigneeActiveStatus.orderTime.toString()
                                ) {
                                    onTaskAssigneeChange(activeData.taskRow, {
                                        account: currentAccount,
                                        status: {
                                            type: "Active",
                                            orderTime: overData.nextAssigneeActiveStatus.orderTime,
                                            orderKey: generateOrderKeyBetween(
                                                overData.previousAssigneeActiveStatus.orderKey,
                                                overData.nextAssigneeActiveStatus.orderKey,
                                            ),
                                        },
                                    });
                                } else {
                                    onTaskAssigneeChange(activeData.taskRow, {
                                        account: currentAccount,
                                        status: {
                                            type: "Active",
                                            orderTime:
                                                overData.previousAssigneeActiveStatus.orderTime,
                                            orderKey: generateOrderKeyBetween(
                                                overData.previousAssigneeActiveStatus.orderKey,
                                                null,
                                            ),
                                        },
                                    });
                                }
                            } else if (overData.previousAssigneeActiveStatus) {
                                onTaskAssigneeChange(activeData.taskRow, {
                                    account: currentAccount,
                                    status: {
                                        type: "Active",
                                        orderTime: overData.previousAssigneeActiveStatus.orderTime,
                                        orderKey: generateOrderKeyBetween(
                                            overData.previousAssigneeActiveStatus.orderKey,
                                            null,
                                        ),
                                    },
                                });
                            } else if (overData.nextAssigneeActiveStatus) {
                                onTaskAssigneeChange(activeData.taskRow, {
                                    account: currentAccount,
                                    status: {
                                        type: "Active",
                                        orderTime: overData.nextAssigneeActiveStatus.orderTime,
                                        orderKey: generateOrderKeyBetween(
                                            null,
                                            overData.nextAssigneeActiveStatus.orderKey,
                                        ),
                                    },
                                });
                            } else {
                                onTaskAssigneeChange(activeData.taskRow, {
                                    account: currentAccount,
                                    status: {
                                        type: "Active",
                                        orderTime: new Date(),
                                        orderKey: initialOrderKey,
                                    },
                                });
                            }
                            break;
                        }
                        default:
                            throw exhaustive(overData);
                    }
                }}
            >
                {children}
                <TaskRowViewDragPortals
                    getTaskStatus={getTaskStatus}
                    getTaskAssignee={getTaskAssignee}
                    getTaskTitle={getTaskTitle}
                />
            </DndContext>
        </TaskGridViewHasDndContext.Provider>
    );
}

/**
 * Custom collision detection algorithm that picks the droppable container the
 * pointer collides with. If the pointer doesn't collide with any droppable
 * container then we look for the closest droppable container to the pointer.
 */
const taskGridViewDndCollisionDetection: CollisionDetection = ({
    active,
    pointerCoordinates,
    droppableContainers,
    droppableRects,
}) => {
    if (!pointerCoordinates) return [];

    const activeData = assertExists(active.data.current) as TaskGridViewDraggableData<unknown>;

    const collisions: Array<CollisionDescriptor> = [];
    let nearestFallbackCollision: CollisionDescriptor | null = null;

    for (const droppableContainer of droppableContainers) {
        const droppableData = assertExists(
            droppableContainer.data.current,
        ) as TaskGridViewDroppableData<unknown>;

        // Can't drag cards onto rows.
        if (activeData.type === "Card" && droppableData.type === "Row") {
            continue;
        }

        const {id} = droppableContainer;
        const rect = droppableRects.get(id);

        if (!rect) continue;

        // Calculate the distance between the pointer and the droppable bounding box.
        // https://stackoverflow.com/a/18157551/1568890
        const dx = Math.max(rect.left - pointerCoordinates.x, 0, pointerCoordinates.x - rect.right);
        const dy = Math.max(rect.top - pointerCoordinates.y, 0, pointerCoordinates.y - rect.bottom);
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (
            distance > 0 &&
            (!nearestFallbackCollision || nearestFallbackCollision.data.value > distance)
        ) {
            nearestFallbackCollision = {id, data: {droppableContainer, value: distance}};
        } else if (distance === 0) {
            // There may be more than a single rectangle intersecting with the pointer
            // coordinates. In order to sort the colliding rectangles, we measure the
            // distance between the pointer and the corners of the intersecting rectangle.
            //
            // This logic is adapted from `@dnd-kit/core`:
            // https://github.com/clauderic/dnd-kit/blob/5c58f0fe5d19b5aaa5cf93572f3435f4a0a6e54f/packages/core/src/utilities/algorithms/pointerWithin.ts#L36-L52
            const corners = [
                {x: rect.left, y: rect.top},
                {x: rect.left + rect.width, y: rect.top},
                {x: rect.left, y: rect.top + rect.height},
                {x: rect.left + rect.width, y: rect.top + rect.height},
            ];

            const distances = corners.reduce(
                (accumulator, corner) =>
                    accumulator +
                    Math.sqrt(
                        Math.pow(pointerCoordinates.x - corner.x, 2) +
                            Math.pow(pointerCoordinates.y - corner.y, 2),
                    ),
                0,
            );
            const effectiveDistance = Number((distances / 4).toFixed(4));

            collisions.push({id, data: {droppableContainer, value: effectiveDistance}});
        }
    }

    if (collisions.length > 0) {
        return collisions.sort((a, b) => a.data.value - b.data.value);
    }

    return nearestFallbackCollision ? [nearestFallbackCollision] : [];
};

function TaskRowViewDragPortals<TaskRow>({
    getTaskStatus,
    getTaskAssignee,
    getTaskTitle,
}: {
    getTaskStatus: (taskRow: TaskRow) => TaskStatus;
    getTaskAssignee: (taskRow: TaskRow) => TaskAssignee | null;
    getTaskTitle: (taskRow: TaskRow) => TaskTitle;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="70" cursor="grabbing" />,
                    document.body,
                )}
            {active &&
                createPortal(
                    <DragOverlay zIndex={60}>
                        <TaskRowViewDragOverlay
                            dataRef={active.data as any}
                            getTaskStatus={getTaskStatus}
                            getTaskAssignee={getTaskAssignee}
                            getTaskTitle={getTaskTitle}
                        />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function TaskRowViewDragOverlay<TaskRow>({
    dataRef,
    getTaskStatus,
    getTaskAssignee,
    getTaskTitle,
}: {
    dataRef: RefObject<TaskGridViewDraggableData<TaskRow>>;
    getTaskStatus: (taskRow: TaskRow) => TaskStatus;
    getTaskAssignee: (taskRow: TaskRow) => TaskAssignee | null;
    getTaskTitle: (taskRow: TaskRow) => TaskTitle;
}) {
    const [data] = useState(assertExists(dataRef.current));

    switch (data.type) {
        case "Row": {
            return (
                <Box
                    display="inline-block"
                    minWidth="48"
                    maxWidth="128"
                    paddingX="3"
                    borderRadius="md"
                    boxShadow="elevation-30"
                    backgroundColor="grey-0"
                    position="relative"
                    left="2"
                    style={{
                        height: `calc(${spacing[taskRowViewHeight]} + 1px)`,
                        paddingTop: 1,
                        top: -1,
                        transform: "scale(75%)",
                        transformOrigin: "center left",
                        opacity: 0.75,
                    }}
                >
                    <Box
                        height="full"
                        display="flex"
                        alignItems="center"
                        gap="2"
                        style={{opacity: 0.5}}
                    >
                        <Box flexShrink="0">
                            <TaskStatusButton
                                status={getTaskStatus(data.taskRow)}
                                onStatusChange={noop}
                                assignee={getTaskAssignee(data.taskRow)}
                            />
                        </Box>
                        <Box
                            fontStyle="truncate"
                            style={contentSchemaStyles.paragraphFontSize}
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    getTaskTitle(data.taskRow).content,
                                ),
                            }}
                        />
                    </Box>
                </Box>
            );
        }
        case "Card": {
            return (
                <TaskCardPresentationalView
                    isDragOverlay={true}
                    status={data.status}
                    onStatusChange={noop}
                    title={data.title}
                    assignee={data.assignee}
                    dueDate={data.dueDate}
                    collections={data.collections}
                    onExpand={async () => {}}
                />
            );
        }
        default:
            throw exhaustive(data);
    }
}
