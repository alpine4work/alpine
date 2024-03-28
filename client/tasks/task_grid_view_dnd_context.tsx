import {
    CollisionDescriptor,
    CollisionDetection,
    DndContext,
    DragEndEvent,
    DragOverlay,
    MouseSensor,
    TouchSensor,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import type {
    AbstractPointerSensor as AbstractPointerSensorType,
    MouseSensorProps,
    PointerEventHandlers,
    PointerSensorProps,
} from "@dnd-kit/core/dist/sensors";
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
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {runWithImmediatePriority} from "~/client/helpers/run_with_immediate_priority.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/tasks/internal/create_get_task_action_referenced_sortable_account.js";
import {TaskDisplayStatusCircle} from "~/client/tasks/internal/task_display_status_circle.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/tasks/internal/task_grid_view_virtualized_list.js";
import {TaskClientQuery} from "~/client/tasks/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/tasks/task_client_store.js";
import {taskRowViewMinHeight} from "~/client/tasks/task_row_shared_styles.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";
import {TaskAction} from "~/shared/tasks/actions/task_action.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskTitleModel} from "~/shared/tasks/model/task_title_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskPosition, compareTaskPosition} from "~/shared/tasks/task_position.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";

const TaskGridViewHasDndContext = createContext(false);

export function useHasTaskGridViewDndContext() {
    return useContext(TaskGridViewHasDndContext);
}

export type TaskGridViewDraggableData =
    | {
          readonly type: "Row";
          readonly undoManager: TaskClientStoreUndoManager;
          readonly affinityManager: TaskClientStoreSearchAffinityManager;
          readonly parents: ReadonlyArray<{
              readonly query: TaskClientQuery;
              readonly cursor: TaskQuerySortCursor;
          }>;
          readonly cursor: TaskQuerySortCursor;
          readonly taskId: TaskId;
          readonly displayStatus: TaskDisplayStatus;
          readonly title: TaskTitleModel;
          readonly assigneeAccountId: AccountId | null;
          readonly getDropOnRowActions: (taskId: TaskId) => Array<TaskAction>;
          readonly overlayPlacement: "ActivatorNode" | "ActivatorTouch";
      }
    | {
          readonly type: "Card";
          readonly undoManager?: undefined;
          readonly affinityManager: TaskClientStoreSearchAffinityManager;
          readonly taskId: TaskId;
          readonly displayStatus: TaskDisplayStatus;
          readonly assigneeAccountId: AccountId | null;
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
          readonly taskId: TaskId | null;
          readonly showHintIndex: number;
          readonly previousAssigneeActivePosition: TaskPosition | null;
          readonly assigneeActivePosition: TaskPosition | null;
          readonly nextAssigneeActivePosition: TaskPosition | null;
          readonly getDropActions: (
              task: {
                  taskId: TaskId;
                  displayStatus: TaskDisplayStatus;
                  assigneeAccountId: AccountId | null;
              },
              position:
                  | {type: "Start"}
                  | {type: "End"}
                  | {type: "Above"; taskId: TaskId}
                  | {type: "Below"; taskId: TaskId},
          ) => Array<TaskAction>;
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

// `@dnd-kit/core` doesn't export `AbstractPointerSensor` so get it through
// `TouchSensor`'s prototype chain.
const AbstractPointerSensor: typeof AbstractPointerSensorType = Object.getPrototypeOf(
    TouchSensor.prototype,
).constructor;

// Fork of [`TouchSensor`][1] with a custom activator function we call after a
// long press.
//
// [1]: https://github.com/clauderic/dnd-kit/blob/694dcc2f62e5269541fc941fa6c9af46ccd682ad/packages/core/src/sensors/touch/TouchSensor.ts#L20
class TouchSensorWithManualActivation extends AbstractPointerSensor {
    constructor(props: PointerSensorProps) {
        super(props, TouchSensorWithManualActivation._events);
    }

    private static _events: PointerEventHandlers = {
        move: {name: "touchmove"},
        end: {name: "touchend"},
    };

    public static activators = [
        {
            eventName: "onManuallyActivateTouchSensor" as any,
            handler: () => true,
        },
    ];

    static setup() {
        // Adding a non-capture and non-passive `touchmove` listener in order
        // to force `event.preventDefault()` calls to work in dynamically added
        // touchmove event handlers. This is required for iOS Safari.
        window.addEventListener(TouchSensorWithManualActivation._events.move.name, noop, {
            capture: false,
            passive: false,
        });

        return function teardown() {
            window.removeEventListener(TouchSensorWithManualActivation._events.move.name, noop);
        };

        // We create a new handler because the teardown function of another sensor
        // could remove our event listener if we use a referentially equal listener.
        function noop() {}
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

    const touchSensor = useSensor(TouchSensorWithManualActivation);

    // No keyboard sensor. To move task rows and cards with the keyboard we should
    // have other keyboard shortcuts.
    const sensors = useSensors(mouseSensor, touchSensor);

    const onDragEnd = useEvent(({active, over}: DragEndEvent) => {
        if (!over) return;

        const activeData = assertExists(active.data.current) as TaskGridViewDraggableData;
        assert(typeof activeData.type === "string");

        const overData = assertExists(over.data.current) as TaskGridViewDroppableData;
        assert(typeof overData.type === "string");

        onActuallyDragEnd(activeData, overData);
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

                        const dropOnRowActions = activeData.getDropOnRowActions(activeData.taskId);

                        const actions = [
                            ...overData.getDropActions(activeData.taskId),

                            // The order here is important! `overData.getDropActions()` will place our
                            // task in its new position. `activeData.getDropOnRowActions()` will remove our
                            // task from its old position. We have to add the task to its new position
                            // before we can remove it since removing the task from its old position may
                            // cause us to lose access causing an authorization failure when we try to add
                            // the task to its new position.
                            //
                            // But we also want `overData.getDropActions()` actions to win in case of
                            // conflict (e.g. if we both remove the task from a collection and add it back
                            // in one transaction). So we call `activeData.getDropOnRowActions()` first
                            // (to get earlier timestamps) but apply it second.
                            //
                            // The final result of an action transaction is determined by timestamps but
                            // authorization is evaluated serially as individual actions are committed.
                            ...dropOnRowActions,
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
                            store.commitTaskActionTransaction(context, actions, {
                                undoManager: activeData.undoManager,
                                affinityManager: activeData.affinityManager,
                            });
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
                let position:
                    | {type: "Start"}
                    | {type: "End"}
                    | {type: "Above"; taskId: TaskId}
                    | {type: "Below"; taskId: TaskId};

                // Rows always push cards to the right.
                if (activeData.type === "Row" || !overData.assigneeActivePosition) {
                    position = !overData.previousAssigneeActivePosition
                        ? {type: "Start"}
                        : overData.taskId
                        ? {type: "Above", taskId: overData.taskId}
                        : {type: "End"};
                }
                // Cards push to the right when moved to an earlier position and push to the
                // left when moved to a later position.
                else {
                    if (
                        compareTaskPosition(
                            activeData.assigneeActivePosition,
                            overData.assigneeActivePosition,
                        ) > 0
                    ) {
                        position = !overData.nextAssigneeActivePosition
                            ? {type: "End"}
                            : overData.taskId
                            ? {type: "Below", taskId: overData.taskId}
                            : {type: "Start"};
                    } else {
                        position = !overData.previousAssigneeActivePosition
                            ? {type: "Start"}
                            : overData.taskId
                            ? {type: "Above", taskId: overData.taskId}
                            : {type: "End"};
                    }
                }

                const actions = overData.getDropActions(activeData, position);

                store.commitTaskActionTransaction(context, actions, {
                    // Dragging/dropping a row can be undone but we don't currently support undoing
                    // a drag/drop for a card.
                    undoManager: activeData.undoManager ?? null,
                    affinityManager: activeData.affinityManager,
                });
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
    const {active, activatorEvent, activeNodeRect} = useDndContext();

    const isPointerDragging =
        active &&
        (activatorEvent instanceof PointerEvent ||
            activatorEvent instanceof MouseEvent ||
            activatorEvent instanceof TouchEvent);

    const getActivatorTouchOffset = () => {
        if (!activeNodeRect) return null;
        if (!activatorEvent) return null;
        if (!(activatorEvent instanceof TouchEvent)) return null;
        if (!activatorEvent.touches[0]) return null;

        const activatorTouch = activatorEvent.touches[0];

        return {
            top: activatorTouch.clientY - activeNodeRect.top,
            left: activatorTouch.clientX - activeNodeRect.left,
        };
    };

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
                            getActivatorTouchOffset={getActivatorTouchOffset}
                        />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function TaskRowViewDragOverlay({
    dataRef,
    getActivatorTouchOffset,
}: {
    dataRef: RefObject<TaskGridViewDraggableData>;
    getActivatorTouchOffset: () => {top: number; left: number} | null;
}) {
    const [data] = useState(assertExists(dataRef.current));
    const [activatorTouchOffset] = useState(getActivatorTouchOffset);

    return useMemo(() => {
        switch (data.type) {
            case "Row": {
                return (
                    <Box
                        display="inline-block"
                        minWidth="48"
                        maxWidth={{desktop: "128", mobile: "64"}}
                        paddingX="3"
                        borderRadius="md"
                        boxShadow="elevation-30"
                        backgroundColor="grey-0"
                        position="relative"
                        opacity="80"
                        style={{
                            height: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                            paddingTop: 1,
                            left:
                                data.overlayPlacement === "ActivatorTouch" && activatorTouchOffset
                                    ? `calc(${activatorTouchOffset.left}px - ${spacing["4"]})`
                                    : spacing["2"],
                            top:
                                data.overlayPlacement === "ActivatorTouch" && activatorTouchOffset
                                    ? `calc(${activatorTouchOffset.top - 1}px - ${
                                          parseRemLengthNumber(spacing[taskRowViewMinHeight]) / 2
                                      }rem)`
                                    : -1,
                            transform: "scale(75%)",
                            transformOrigin: "center left",
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
                                <TaskDisplayStatusCircle
                                    size="4"
                                    displayStatus={data.displayStatus}
                                />
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
    }, [activatorTouchOffset, data]);
}
