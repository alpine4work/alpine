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
} from "@dnd-kit/core/dist/sensors/index.d.ts";
import {ReactNode, RefObject, useContext, useMemo, useRef, useState} from "react";
import {createPortal, flushSync} from "react-dom";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {isTouchEvent} from "~/client/web/helpers/events/is_touch_event.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {taskRowViewMinHeight} from "~/client/web/styles/tasks_shared_styles.js";
import {createGetTaskActionReferencedSortableAccount} from "~/client/web/tasks/core/create_get_task_action_referenced_sortable_account.js";
import {disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint} from "~/client/web/tasks/core/disable_task_grid_view_animations_until_next_browser_paint.js";
import {TaskClientQuery} from "~/client/web/tasks/core/task_client_query.js";
import {
    TaskClientStore,
    TaskClientStoreSearchAffinityManager,
    TaskClientStoreUndoManager,
} from "~/client/web/tasks/core/task_client_store.js";
import {TaskGridViewHasDndContext} from "~/client/web/tasks/internal/task_grid_view_has_dnd_context.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {AccountId, TaskId} from "~/shared/id/types/id_types.js";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html.js";
import {TaskActionModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskModel} from "~/shared/tasks/model/task_model.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";
import {TaskQuerySortCursor} from "~/shared/tasks/task_query_sort_cursor.js";
import {TaskTitleModel} from "~/shared/tasks/title/task_title.js";

export type TaskGridViewDraggableData = {
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
    readonly getDropOnRowActions: (taskId: TaskId) => Array<TaskActionModel>;
    readonly overlayPlacement: "ActivatorNode" | "ActivatorTouch";
};

export type TaskGridViewDroppableData = {
    readonly type: "Row";
    readonly getDropActions: (taskId: TaskId) => Array<TaskActionModel>;
};

class MouseSensorWithFlushSyncEnd extends MouseSensor {
    constructor(props: MouseSensorProps) {
        super({
            ...props,
            onEnd: () => {
                // Run the `onEnd` handler synchronously. This means React will batch
                // any `useSyncExternalStore()` updates with any state updates at the end of
                // the drag. So we won't have weird flashes where an external store has updated
                // but not our drag state.
                flushSync(() => {
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
class TouchSensorWithManualActivationAndFlushSyncEnd extends AbstractPointerSensor {
    constructor(props: PointerSensorProps) {
        super(
            {
                ...props,
                onEnd: () => {
                    // Run the `onEnd` handler synchronously. This means React will batch
                    // any `useSyncExternalStore()` updates with any state updates at the end of
                    // the drag. So we won't have weird flashes where an external store has updated
                    // but not our drag state.
                    flushSync(() => {
                        props.onEnd();
                    });
                },
            },
            TouchSensorWithManualActivationAndFlushSyncEnd._events,
        );
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
        window.addEventListener(this._events.move.name, noop, {
            capture: false,
            passive: false,
        });

        return () => {
            window.removeEventListener(this._events.move.name, noop);
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
        MouseSensorWithFlushSyncEnd,
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

    const touchSensor = useSensor(TouchSensorWithManualActivationAndFlushSyncEnd);

    // No keyboard sensor. To move task rows and cards with the keyboard we should
    // have other keyboard shortcuts.
    const sensors = useSensors(mouseSensor, touchSensor);

    const lastDragOverIdRef = useRef<string | number | null>(null);

    const {onDragEnd, onDragStart, onDragMove} = useEvents({
        onDragEnd: ({active, over}: DragEndEvent) => {
            if (!over) return;

            const activeData = assertExists(active.data.current) as TaskGridViewDraggableData;
            assert(typeof activeData.type === "string");

            const overData = assertExists(over.data.current) as TaskGridViewDroppableData;
            assert(typeof overData.type === "string");

            onActuallyDragEnd(activeData, overData);
        },
        onDragStart: () => {
            lastDragOverIdRef.current = null;
        },
        onDragMove: ({over}: DragEndEvent) => {
            if (over !== null) {
                if (lastDragOverIdRef.current === null) {
                    lastDragOverIdRef.current = over.id;
                } else if (lastDragOverIdRef.current !== over.id) {
                    lastDragOverIdRef.current = over.id;

                    // Whenever we're dragging over something new, play the selection changed
                    // haptic feedback.
                    NativeMobileBridge?.haptic.playSelectionChanged();
                }
            }
        },
    });

    // If we already have a parent `<TaskGridViewDndContext>` then don't render
    // another one. This allows us to "hoist" up drag-and-drop functionality.
    if (useContext(TaskGridViewHasDndContext)) return <>{children}</>;

    const onActuallyDragEnd = (
        activeData: TaskGridViewDraggableData,
        overData: TaskGridViewDroppableData,
    ) => {
        disableTaskGridViewAnimationsForTaskIdUntilNextBrowserPaint(activeData.taskId);

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
                    store.getTaskEntrySnapshot(action.taskId)?.task;
                if (!task) continue;

                newTaskById.set(
                    task.id,
                    task.applyAction(
                        action,
                        createGetTaskActionReferencedSortableAccount(store.accountRegistry, action),
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
                        store.getTaskEntrySnapshot(parentTaskId)?.task;
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
    };

    return (
        <TaskGridViewHasDndContext.Provider value={true}>
            <DndContext
                sensors={sensors}
                collisionDetection={taskGridViewDndCollisionDetection}
                onDragEnd={onDragEnd}
                onDragStart={onDragStart}
                onDragMove={onDragMove}
                // NOTE(calebmer): We patch `@dnd-kit/core` to add this property. If the node
                // we're dragging unmounts, we still want `active.data.current` to return the
                // last data object we saw.
                unstableShouldPreserveDataAfterDraggableUnmounts={true}
            >
                {children}
                <TaskRowViewDragPortals />
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

    const intersectingCollisions: Array<CollisionDescriptor> = [];
    let nearestNonIntersectingCollision: CollisionDescriptor | null = null;

    for (const droppableContainer of droppableContainers) {
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
            (!nearestNonIntersectingCollision ||
                nearestNonIntersectingCollision.data.value > distance)
        ) {
            nearestNonIntersectingCollision = {id, data: {droppableContainer, value: distance}};
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
            const effectiveDistance = distances / 4;

            intersectingCollisions.push({id, data: {droppableContainer, value: effectiveDistance}});
        }
    }

    if (intersectingCollisions.length > 0) {
        return intersectingCollisions.sort((a, b) => a.data.value - b.data.value);
    }

    return nearestNonIntersectingCollision ? [nearestNonIntersectingCollision] : [];
};

function TaskRowViewDragPortals() {
    const {active, activatorEvent, activeNodeRect} = useDndContext();

    const isPointerDragging =
        active &&
        (activatorEvent instanceof PointerEvent ||
            activatorEvent instanceof MouseEvent ||
            (activatorEvent && isTouchEvent(activatorEvent)));

    const getActivatorTouchOffset = () => {
        if (!activeNodeRect) return null;
        if (!activatorEvent) return null;
        if (!isTouchEvent(activatorEvent)) return null;
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

const taskRowViewDragOverlayScale =
    fontSizesBySpacingScale["50"].small.fontSize / fontSizesBySpacingScale["100"].small.fontSize;

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
        return (
            <Box
                display="inline-block"
                minWidth="48"
                maxWidth={{desktop: "128", mobile: "64"}}
                paddingX="3"
                borderRadius="1.5"
                boxShadow="elevation-30"
                backgroundColor="grey-0"
                position="relative"
                opacity="80"
                style={{
                    height: `calc(${spacing[taskRowViewMinHeight]} + 1px)`,
                    paddingTop: 1,
                    left:
                        data.overlayPlacement === "ActivatorTouch" && activatorTouchOffset
                            ? activatorTouchOffset.left
                            : spacing["2"],
                    top:
                        data.overlayPlacement === "ActivatorTouch" && activatorTouchOffset
                            ? `calc(${activatorTouchOffset.top - 1}px - ${
                                  parseRemLength(taskRowViewMinHeight) / 2
                              }rem)`
                            : -1,
                    transform: [
                        `scale(${taskRowViewDragOverlayScale})`,
                        ...(data.overlayPlacement === "ActivatorTouch" && activatorTouchOffset
                            ? ["translateX(-50%)"]
                            : []),
                    ].join(" "),
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
                        <TaskDisplayStatusCircle size="4" displayStatus={data.displayStatus} />
                    </Box>
                    <Box
                        fontStyle="truncate"
                        style={{
                            ...contentStyles.paragraphFontSize,
                            // Render contextual alternate glyphs. User text may be rendered here. Helpful
                            // for consistency if the user types anything like 2x2 or an @ mention.
                            // eslint-disable-next-line string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                        dangerouslySetInnerHTML={{
                            __html: serializeProsemirrorFragmentToHtml(
                                data.title.getProsemirrorNode().content,
                            ),
                        }}
                    />
                </Box>
            </Box>
        );
    }, [activatorTouchOffset, data]);
}
