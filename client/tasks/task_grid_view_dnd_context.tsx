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
import {
    ReactElement,
    ReactNode,
    RefObject,
    createContext,
    useContext,
    useMemo,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/internal/create_get_task_action_referenced_sortable_account.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskClientStore} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskPosition} from "~/shared/tasks/task_position.js";

const TaskGridViewHasDndContext = createContext(false);

export function useHasTaskGridViewDndContext() {
    return useContext(TaskGridViewHasDndContext);
}

export type TaskGridViewDraggableData =
    | {
          readonly type: "Row";
          readonly taskId: TaskId;
          readonly displayStatus: TaskDisplayStatus;
          readonly title: TaskTitleModel;
          readonly getDropActions: (taskId: TaskId) => Array<TaskAction>;
      }
    | {
          readonly type: "Card";
          readonly assigneeActivePosition: TaskPosition;
          readonly overlayNode: ReactElement;
      };

export type TaskGridViewDroppableData =
    | {
          readonly type: "Row";
          readonly getDropActions: (taskId: TaskId) => Array<TaskAction>;
      }
    | {
          readonly type: "ActiveCard";
          readonly showHintIndex: number;
          readonly previousAssigneeActivePosition: TaskPosition | null;
          readonly assigneeActivePosition: TaskPosition | null;
          readonly nextAssigneeActivePosition: TaskPosition | null;
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

    const {onDragStart, onDragEnd, onDragCancel} = useEvents({
        onDragStart: ({active}: DragEndEvent) => {},
        onDragCancel: ({active, over}: DragEndEvent) => {},
        onDragEnd: ({active, over}: DragEndEvent) => {
            if (!over) return;

            const activeData = assertExists(active.data.current) as TaskGridViewDraggableData;
            assert(typeof activeData.type === "string");

            const overData = assertExists(over.data.current) as TaskGridViewDroppableData;
            assert(typeof overData.type === "string");

            onActuallyDragEnd(activeData, overData);
        },
    });

    // If we already have a parent `<TaskGridViewDndContext>` then don't render
    // another one. This allows us to "hoist" up drag-and-drop functionality.
    if (useContext(TaskGridViewHasDndContext)) return <>{children}</>;

    const onActuallyDragEnd = (
        activeData: TaskGridViewDraggableData,
        overData: TaskGridViewDroppableData,
    ) => {
        switch (overData.type) {
            case "Row": {
                switch (activeData.type) {
                    case "Row": {
                        disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(
                            activeData.taskId,
                        );

                        const actions = [
                            ...activeData.getDropActions(activeData.taskId),
                            ...overData.getDropActions(activeData.taskId),
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
                onDragStart={onDragStart}
                onDragCancel={onDragCancel}
                onDragEnd={onDragEnd}
                // NOTE(calebmer): We patch `@dnd-kit/core` to add this property. If the node
                // we're dragging unmounts, we still want `active.data.current` to return the
                // last data object we saw.
                unstableShouldPreserveDataAfterDraggableUnmounts={true}
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
    assert(typeof activeData.type === "string");

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
                        <TaskRowViewDragOverlay dataRef={active.data as any} />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function TaskRowViewDragOverlay({dataRef}: {dataRef: RefObject<TaskGridViewDraggableData>}) {
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
                            <TaskDisplayStatusCircle size="4" displayStatus={data.displayStatus} />
                        </Box>
                        <Box
                            fontStyle="truncate"
                            style={contentSchemaStyles.paragraphFontSize}
                            dangerouslySetInnerHTML={{
                                __html: serializeProsemirrorFragmentToHtml(
                                    data.title.getProsemirrorNode().content,
                                ),
                            }}
                        />
                    </Box>
                </Box>
            );
        }
        case "Card": {
            return data.overlayNode;
        }
        default:
            throw exhaustive(data);
    }
}
