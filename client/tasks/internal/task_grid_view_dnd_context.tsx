import {
    CollisionDescriptor,
    CollisionDetection,
    DndContext,
    DragEndEvent,
    DragOverlay,
    MouseSensor,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {MouseSensorProps} from "@dnd-kit/core/dist/sensors";
import {ReactNode, RefObject, createContext, useContext, useMemo, useState} from "react";
import {createPortal} from "react-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/internal/create_get_task_action_referenced_sortable_account.js";
import {TaskStatusButton} from "~/client/tasks/internal/task_status_button.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {getTaskTitleProsemirrorNode} from "~/shared/tasks/task_title.js";

const TaskGridViewHasDndContext = createContext(false);

export type TaskGridViewDraggableData =
    | {
          readonly type: "Row";
          readonly task: TaskModel;
          readonly getDropActions: (taskId: TaskId) => Array<TaskAction>;
      }
    | {
          readonly type: "Card";
          // readonly id: LocalTaskId;
          // readonly status: TaskStatus;
          // readonly title: TaskTitle;
          // readonly assignee: TaskAssignee | null;
          // readonly priority: TaskPriority | null;
          // readonly dueDate: CalendarDate | null;
          // readonly collections: ReadonlyArray<LocalTaskCollection>;
          // readonly childTaskCount: number;
          // readonly closedChildTaskCount: number;
      };

export type TaskGridViewDroppableData =
    | {
          readonly type: "Row";
          readonly getDropActions: (taskId: TaskId) => Array<TaskAction>;
      }
    | {
          readonly type: "ActiveCard";
          // NOCOMMIT:
          // readonly showHintIndex: number;
          // readonly previousAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
          // readonly assigneeActiveStatus: TaskAssigneeActiveStatus | null;
          // readonly nextAssigneeActiveStatus: TaskAssigneeActiveStatus | null;
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

export function TaskGridViewDndContext({
    store,
    children,
}: {
    store: TaskClientStore;
    children?: ReactNode;
}) {
    const context = useAppContext();

    const mouseSensor = useSensor(
        MouseSensorWithImmediatePriorityEnd,
        // Needs to be `useMemo()`d to avoid unnecessary re-renders.
        // https://github.com/clauderic/dnd-kit/blob/00f749bc0cc3e6582f4f887f64c1f1de65ee0081/packages/core/src/sensors/useSensor.ts#L15
        useMemo(
            () => ({
                activationConstraint: {
                    // The mouse must move to activate dragging. This is required for cards which
                    // when clicked expand the task and when dragged can be reordered.
                    distance: 1,
                },
            }),
            [],
        ),
    );

    // No keyboard sensor. To move task rows and cards with the keyboard we should
    // have other keyboard shortcuts.
    const sensors = useSensors(mouseSensor);

    const onActuallyDragEnd = useEvent(({active, over}: DragEndEvent) => {
        if (!over) return;

        const activeData = assertExists(active.data.current) as TaskGridViewDraggableData;
        const overData = assertExists(over.data.current) as TaskGridViewDroppableData;

        onDragEnd(activeData, overData);
    });

    // If we already have a parent `<TaskGridViewDndContext>` then don't render
    // another one. This allows us to "hoist" up drag-and-drop functionality.
    if (useContext(TaskGridViewHasDndContext)) return <>{children}</>;

    const onDragEnd = (
        activeData: TaskGridViewDraggableData,
        overData: TaskGridViewDroppableData,
    ) => {
        switch (overData.type) {
            case "Row": {
                switch (activeData.type) {
                    case "Row": {
                        const actions = [
                            ...activeData.getDropActions(activeData.task.id),
                            ...overData.getDropActions(activeData.task.id),
                        ];

                        // Some drag operations may introduce a circular dependency. For example
                        // dragging a task inside itself. We want to ignore these drops entirely!
                        // So look at the tasks in our store after `actions` are applied and if we
                        // find out that the action would introduce a circular dependency we don't
                        // commit the actions.
                        //
                        // We may not have all the parent tasks loaded. In that case it's up to the
                        // server to reject a drag that would create a circular dependency.
                        let wouldCreateCircularDependency = false;
                        {
                            const newTaskById = new Map<TaskId, TaskModel>();

                            for (const action of actions) {
                                if (action.type !== "UpdateTask") continue;

                                const task =
                                    newTaskById.get(action.taskId) ??
                                    store.getTaskEntryStoreIfExists(action.taskId)?.getSnapshot()
                                        .task;
                                if (!task) continue;

                                newTaskById.set(
                                    task.id,
                                    task.applyAction(
                                        action,
                                        createGetTaskActionReferencedSortableAccount(
                                            store.accountStore,
                                            action,
                                        ),
                                    ),
                                );
                            }

                            for (const task of newTaskById.values()) {
                                const seenTaskIds = new Set<TaskId>([task.id]);

                                let parentTaskId = task.getParent()?.taskId;
                                while (parentTaskId) {
                                    if (seenTaskIds.has(parentTaskId)) {
                                        wouldCreateCircularDependency = true;
                                        break;
                                    }
                                    seenTaskIds.add(parentTaskId);

                                    const parentTask =
                                        newTaskById.get(parentTaskId) ??
                                        store.getTaskEntryStoreIfExists(parentTaskId)?.getSnapshot()
                                            .task;
                                    if (!parentTask) break;

                                    parentTaskId = parentTask.getParent()?.taskId;
                                }

                                if (wouldCreateCircularDependency) break;
                            }
                        }

                        if (!wouldCreateCircularDependency) {
                            store.commitTaskActionTransaction(context, actions);
                        }
                        break;
                    }
                    case "Card": {
                        // Can not drop cards into row positions...
                        break;
                    }
                    default:
                        throw exhaustive(activeData);
                }
                break;
            }
            case "ActiveCard": {
                // NOCOMMIT:
                // let taskRow: TaskRow;
                // let beforeAssigneeActiveStatus: TaskAssigneeActiveStatus | null = null;
                // let afterAssigneeActiveStatus: TaskAssigneeActiveStatus | null = null;
                // switch (activeData.type) {
                //     case "Row": {
                //         taskRow = activeData.taskRow;
                //         beforeAssigneeActiveStatus =
                //             overData.previousAssigneeActiveStatus;
                //         afterAssigneeActiveStatus = overData.assigneeActiveStatus;
                //         break;
                //     }
                //     case "Card": {
                //         // @ts-expect-error: Hack. This should get cleaned up in a production
                //         // implementation.
                //         taskRow = {task: {id: activeData.id}};
                //         if (
                //             activeData.assignee?.status.type === "Active" &&
                //             overData.assigneeActiveStatus &&
                //             compareTaskAssigneeActiveStatus(
                //                 activeData.assignee.status,
                //                 overData.assigneeActiveStatus,
                //             ) < 0
                //         ) {
                //             beforeAssigneeActiveStatus = overData.assigneeActiveStatus;
                //             afterAssigneeActiveStatus =
                //                 overData.nextAssigneeActiveStatus;
                //         } else {
                //             beforeAssigneeActiveStatus =
                //                 overData.previousAssigneeActiveStatus;
                //             afterAssigneeActiveStatus = overData.assigneeActiveStatus;
                //         }
                //         break;
                //     }
                //     default:
                //         throw exhaustive(activeData);
                // }
                // const assignedTime = new Date();
                // const assignedDate = toCalendarDate(
                //     parseAbsolute(assignedTime.toISOString(), timeZone),
                // );
                // if (afterAssigneeActiveStatus && beforeAssigneeActiveStatus) {
                //     if (
                //         afterAssigneeActiveStatus.orderTime.toString() ===
                //         beforeAssigneeActiveStatus.orderTime.toString()
                //     ) {
                //         onTaskAssigneeChange(taskRow, {
                //             account: currentAccount,
                //             // TODO(calebmer): This probably should be a new assigned time...
                //             assignerId: currentAccount.id,
                //             assignedTime,
                //             assignerTimeZone: timeZone,
                //             assignedDate,
                //             status: {
                //                 type: "Active",
                //                 orderTime: afterAssigneeActiveStatus.orderTime,
                //                 orderKey: generateOrderKeyBetween(
                //                     beforeAssigneeActiveStatus.orderKey,
                //                     afterAssigneeActiveStatus.orderKey,
                //                 ),
                //                 activatorId: currentAccount.id,
                //                 activatedTime: assignedTime,
                //                 activatorTimeZone: timeZone,
                //                 activatedDate: assignedDate,
                //             },
                //         });
                //     } else {
                //         onTaskAssigneeChange(taskRow, {
                //             account: currentAccount,
                //             // TODO(calebmer): This probably should be a new assigned time...
                //             assignerId: currentAccount.id,
                //             assignedTime,
                //             assignerTimeZone: timeZone,
                //             assignedDate,
                //             status: {
                //                 type: "Active",
                //                 orderTime: beforeAssigneeActiveStatus.orderTime,
                //                 orderKey: generateOrderKeyBetween(
                //                     beforeAssigneeActiveStatus.orderKey,
                //                     null,
                //                 ),
                //                 activatorId: currentAccount.id,
                //                 activatedTime: assignedTime,
                //                 activatorTimeZone: timeZone,
                //                 activatedDate: assignedDate,
                //             },
                //         });
                //     }
                // } else if (beforeAssigneeActiveStatus) {
                //     onTaskAssigneeChange(taskRow, {
                //         account: currentAccount,
                //         // TODO(calebmer): This probably should be a new assigned time...
                //         assignerId: currentAccount.id,
                //         assignedTime,
                //         assignerTimeZone: timeZone,
                //         assignedDate,
                //         status: {
                //             type: "Active",
                //             orderTime: beforeAssigneeActiveStatus.orderTime,
                //             orderKey: generateOrderKeyBetween(
                //                 beforeAssigneeActiveStatus.orderKey,
                //                 null,
                //             ),
                //             activatorId: currentAccount.id,
                //             activatedTime: assignedTime,
                //             activatorTimeZone: timeZone,
                //             activatedDate: assignedDate,
                //         },
                //     });
                // } else if (afterAssigneeActiveStatus) {
                //     onTaskAssigneeChange(taskRow, {
                //         account: currentAccount,
                //         // TODO(calebmer): This probably should be a new assigned time...
                //         assignerId: currentAccount.id,
                //         assignedTime,
                //         assignerTimeZone: timeZone,
                //         assignedDate,
                //         status: {
                //             type: "Active",
                //             orderTime: afterAssigneeActiveStatus.orderTime,
                //             orderKey: generateOrderKeyBetween(
                //                 null,
                //                 afterAssigneeActiveStatus.orderKey,
                //             ),
                //             activatorId: currentAccount.id,
                //             activatedTime: assignedTime,
                //             activatorTimeZone: timeZone,
                //             activatedDate: assignedDate,
                //         },
                //     });
                // } else {
                //     onTaskAssigneeChange(taskRow, {
                //         account: currentAccount,
                //         // TODO(calebmer): This probably should be a new assigned time...
                //         assignerId: currentAccount.id,
                //         assignedTime,
                //         assignerTimeZone: timeZone,
                //         assignedDate,
                //         status: {
                //             type: "Active",
                //             orderTime: new Date(),
                //             orderKey: initialOrderKey,
                //             activatorId: currentAccount.id,
                //             activatedTime: assignedTime,
                //             activatorTimeZone: timeZone,
                //             activatedDate: assignedDate,
                //         },
                //     });
                // }
                break;
            }
            default:
                throw exhaustive(overData);
        }
    };

    return (
        <TaskGridViewHasDndContext.Provider value={true}>
            <DndContext
                sensors={sensors}
                collisionDetection={taskGridViewDndCollisionDetection}
                onDragEnd={onActuallyDragEnd}
            >
                {children}
                <TaskRowViewDragPortals store={store} />
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

    const activeData = assertExists(active.data.current) as TaskGridViewDraggableData;

    const collisions: Array<CollisionDescriptor> = [];
    let nearestFallbackCollision: CollisionDescriptor | null = null;

    for (const droppableContainer of droppableContainers) {
        const droppableData = assertExists(
            droppableContainer.data.current,
        ) as TaskGridViewDroppableData;

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

function TaskRowViewDragPortals({store}: {store: TaskClientStore}) {
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
                        <TaskRowViewDragOverlay store={store} dataRef={active.data as any} />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function TaskRowViewDragOverlay({
    store,
    dataRef,
}: {
    store: TaskClientStore;
    dataRef: RefObject<TaskGridViewDraggableData>;
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
                        height: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
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
                                store={store}
                                task={data.task}
                                isDisabled={true}
                                isFocusable={false}
                            />
                        </Box>
                        <Box
                            fontStyle="truncate"
                            style={contentSchemaStyles.paragraphFontSize}
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    getTaskTitleProsemirrorNode(data.task.getTitle().raw).content,
                                ),
                            }}
                        />
                    </Box>
                </Box>
            );
        }
        case "Card": {
            throw new UnimplementedError("TODO");
            // return (
            //     <TaskCardPresentationalView
            //         isDragOverlay={true}
            //         id={data.id}
            //         status={data.status}
            //         onStatusChange={noop}
            //         title={data.title}
            //         assignee={data.assignee}
            //         onAssigneeChange={noop}
            //         priority={data.priority}
            //         dueDate={data.dueDate}
            //         collections={data.collections}
            //         childTaskCount={data.childTaskCount}
            //         closedChildTaskCount={data.closedChildTaskCount}
            //         onExpand={async () => {}}
            //         deleteTaskAndAllChildrenMaybeWithConfirmation={noop}
            //     />
            // );
        }
        default:
            throw exhaustive(data);
    }
}
