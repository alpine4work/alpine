import {DndContext, DragOverlay, closestCenter, useDndContext} from "@dnd-kit/core";
import {SortableContext, arrayMove, useSortable} from "@dnd-kit/sortable";
import {CaretDown, DotsSixVertical, Plus, X} from "phosphor-react";
import {Fragment, Key, ReactNode, useState} from "react";
import {mergeProps} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {Spacer} from "~/client/design/spacer";
import {TaskNoAccountAvatar} from "~/client/tasks/demo_2/internal/task_no_account_avatar";
import {TaskQuerySort} from "~/client/tasks/demo_2/task_query_sort";
import {spacing} from "~/shared/design/spacing";
import {assert} from "~/shared/helpers/control/assert";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {noop} from "~/shared/helpers/control/noop";
import {sprinkles} from "~/shared/styles/styles";

let nextSortId = 1;

export function TaskQuerySortsEditor({defaultOrderSentence}: {defaultOrderSentence: string}) {
    const [sortsWithId, setSortsWithId] = useState<
        Array<{readonly id: Key; readonly sort: TaskQuerySort}>
    >([]);

    const addSort = (sort: TaskQuerySort) => {
        setSortsWithId(sortsWithId => [...sortsWithId, {id: nextSortId++, sort}]);
    };

    return (
        <Box width="96" padding="4" overflow="hidden">
            {sortsWithId.length === 0 ? (
                <Box color="grey-50" height="4">
                    No sorts. {defaultOrderSentence}
                </Box>
            ) : (
                <DndContext
                    collisionDetection={closestCenter}
                    onDragEnd={event => {
                        const {active, over} = event;

                        if (over && active.id !== over.id) {
                            setSortsWithId(sortsWithId => {
                                const oldIndex = sortsWithId.findIndex(
                                    sortWithId => sortWithId.id === active.id,
                                );
                                const newIndex = sortsWithId.findIndex(
                                    sortWithId => sortWithId.id === over.id,
                                );

                                assert(oldIndex >= 0);
                                assert(newIndex >= 0);

                                return arrayMove(sortsWithId, oldIndex, newIndex);
                            });
                        }
                    }}
                >
                    <SortableContext items={sortsWithId}>
                        <TaskQuerySortsEditorDragPortals sortsWithId={sortsWithId} />
                        <Box position="relative" zIndex="0" marginY="-2" marginX="-2.5">
                            {sortsWithId.map(({sort, id}, index) => (
                                <Fragment key={id}>
                                    {index !== 0 && (
                                        <Box
                                            position="relative"
                                            zIndex="10" // Renders under rows
                                            borderTop="grey-5"
                                            marginX="2.5"
                                        />
                                    )}
                                    <TaskQuerySortsEditorRow
                                        id={id}
                                        sort={sort}
                                        isDragOverlay={false}
                                        onSortChange={newSort => {
                                            const newSortsWithKey = [...sortsWithId];
                                            newSortsWithKey[index] = {id, sort: newSort};
                                            setSortsWithId(newSortsWithKey);
                                        }}
                                        onSortDelete={() => {
                                            const newSortsWithKey = [...sortsWithId];
                                            newSortsWithKey.splice(index, 1);
                                            setSortsWithId(newSortsWithKey);
                                        }}
                                    />
                                </Fragment>
                            ))}
                        </Box>
                    </SortableContext>
                </DndContext>
            )}
            <Spacer space="4" />
            <MenuButton
                actions={[
                    [
                        {
                            label: "Status",
                            onPress: () => {
                                addSort({
                                    type: "Status",
                                    direction: "Ascending",
                                });
                            },
                        },
                    ],
                    [
                        {
                            label: "Assignee",
                            onPress: () => {
                                addSort({
                                    type: "Assignee",
                                    // If you are sorting by assignee you probably want to see assigned tasks.
                                    noAccountSide: "End",
                                });
                            },
                        },
                        {
                            label: "Creator",
                            onPress: () => {
                                addSort({type: "Creator"});
                            },
                        },
                        {
                            label: "Assigner",
                            onPress: () => {
                                addSort({
                                    type: "Assigner",
                                    // If you are sorting by assigner you probably want to see assigned tasks.
                                    noAccountSide: "End",
                                });
                            },
                        },
                    ],
                    [
                        {
                            label: "Due date",
                            onPress: () => {
                                addSort({
                                    type: "DueDate",
                                    // You probably care about overdue tasks or tasks due soon more than tasks due
                                    // far in the future.
                                    direction: "Ascending",
                                });
                            },
                        },
                        {
                            label: "Created date",
                            onPress: () => {
                                addSort({
                                    type: "CreatedDate",
                                    // You probably care about new tasks more than older tasks.
                                    direction: "Descending",
                                });
                            },
                        },
                        {
                            label: "Assigned date",
                            onPress: () => {
                                addSort({
                                    type: "AssignedDate",
                                    // You probably care about new tasks more than older tasks.
                                    direction: "Descending",
                                });
                            },
                        },
                        {
                            label: "Closed date",
                            onPress: () => {
                                addSort({
                                    type: "ClosedDate",
                                    // You probably care about new tasks more than older tasks.
                                    direction: "Descending",
                                });
                            },
                        },
                        {
                            label: "Active date",
                            onPress: () => {
                                addSort({
                                    type: "ActivatedDate",
                                    // You probably care about new tasks more than older tasks.
                                    direction: "Descending",
                                });
                            },
                        },
                    ],
                ]}
            >
                <Button
                    variant="outline"
                    icon={<Plus />}
                    height="6"
                    paddingX="2"
                    isDisabled={sortsWithId.length >= 5}
                >
                    Add sort
                </Button>
            </MenuButton>
        </Box>
    );
}

function TaskQuerySortsEditorDragPortals({
    sortsWithId,
}: {
    sortsWithId: Array<{id: Key; sort: TaskQuerySort}>;
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
                        <TaskQuerySortsEditorRow
                            id={active.id}
                            sort={
                                assertExists(
                                    sortsWithId.find(sortWithId => sortWithId.id === active.id),
                                ).sort
                            }
                            isDragOverlay={true}
                            onSortChange={noop}
                            onSortDelete={noop}
                        />
                    </DragOverlay>,
                    document.body,
                )}
        </>
    );
}

function TaskQuerySortsEditorRow({
    id,
    sort,
    isDragOverlay,
    onSortChange,
    onSortDelete,
}: {
    id: Key;
    sort: TaskQuerySort;
    isDragOverlay: boolean;
    onSortChange: (sort: TaskQuerySort) => void;
    onSortDelete: () => void;
}) {
    switch (sort.type) {
        case "Status": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Status"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowStatusDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "Assignee": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Assignee"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowAccountNoAccountSide
                        noAccountSide={sort.noAccountSide}
                        onNoAccountSideChange={noAccountSide =>
                            onSortChange({...sort, noAccountSide})
                        }
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "Creator": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Creator"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                />
            );
        }
        case "Assigner": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Assigner"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowAccountNoAccountSide
                        noAccountSide={sort.noAccountSide}
                        onNoAccountSideChange={noAccountSide =>
                            onSortChange({...sort, noAccountSide})
                        }
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "DueDate": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Due date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "CreatedDate": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Created date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "AssignedDate": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Assigned date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "ClosedDate": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Closed date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "ActivatedDate": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Active date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        default:
            throw exhaustive(sort);
    }
}

function TaskQuerySortsEditorRowBase({
    id,
    name,
    onDelete,
    isDragOverlay,
    children,
}: {
    id: Key;
    name: string;
    onDelete: () => void;
    isDragOverlay: boolean;
    children?: ReactNode;
}) {
    const {
        attributes: sortableAttributes,
        listeners: sortableListeners,
        setNodeRef: setSortableNodeRef,
        transform: sortableTransform,
        transition: sortableTransition,
        isDragging,
    } = useSortable({id, disabled: isDragOverlay});

    return (
        <Box
            ref={setSortableNodeRef}
            position="relative"
            zIndex="20" // Renders over dividers
            height="8"
            paddingX="2.5"
            display="flex"
            gap="3"
            backgroundColor={isDragOverlay ? "grey-0" : undefined}
            boxShadow={isDragOverlay ? "elevation-30" : undefined}
            borderRadius={isDragOverlay ? "base" : undefined}
            style={{
                transform: sortableTransform
                    ? `translate(${sortableTransform.x}px, ${sortableTransform.y}px)`
                    : undefined,
                transition: sortableTransition,
                opacity: isDragging ? 0 : undefined,

                // Add 2px of height when this is a drag overlay so it covers the dividers.
                height: isDragOverlay ? `calc(${spacing["8"]} + 2px)` : spacing["8"],
                paddingTop: isDragOverlay ? `calc(${spacing["2"]} + 1px)` : spacing["2"],
                paddingBottom: isDragOverlay ? `calc(${spacing["2"]} + 1px)` : spacing["2"],
                marginTop: isDragOverlay ? -1 : 0,
            }}
        >
            <Box flexShrink="0">{name}</Box>
            <Box flexGrow="1" />
            {children && <Box flexShrink="0">{children}</Box>}
            <Box flexShrink="0" display="flex" alignItems="center" gap="0.5">
                <button
                    {...mergeProps(sortableAttributes, sortableListeners ?? {})}
                    className={sprinkles({
                        width: "4",
                        height: "4",
                        padding: "0.5",
                        borderRadius: "full",
                        cursor: "grab",
                    })}
                    // Drag handle is not tab focusable. Keyboard navigation within a task grid is
                    // not done with tab navigation.
                    tabIndex={-1}
                >
                    <DotsSixVertical size={spacing["3"]} />
                </button>
                <IconButton size="xs" description="Delete" withoutTooltip={true} onPress={onDelete}>
                    <X />
                </IconButton>
            </Box>
        </Box>
    );
}

function TaskQuerySortsEditorRowStatusDirection({
    direction,
    onDirectionChange,
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
}) {
    const ascendingLabel = "Open → Closed";
    const descendingLabel = "Closed → Open";

    return (
        <Box marginTop="-0.5">
            <MenuButton
                actions={[
                    {
                        label: ascendingLabel,
                        isSelected: direction === "Ascending",
                        onPress: () => onDirectionChange("Ascending"),
                    },
                    {
                        label: descendingLabel,
                        isSelected: direction === "Descending",
                        onPress: () => onDirectionChange("Descending"),
                    },
                ]}
            >
                <Button
                    variant="quieter"
                    height="5"
                    paddingX="1.5"
                    icon={<CaretDown />}
                    iconPlacement="end"
                >
                    {direction === "Ascending" ? ascendingLabel : descendingLabel}
                </Button>
            </MenuButton>
        </Box>
    );
}

function TaskQuerySortsEditorRowAccountNoAccountSide({
    noAccountSide,
    onNoAccountSideChange,
}: {
    noAccountSide: "Start" | "End";
    onNoAccountSideChange: (noAccountSide: "Start" | "End") => void;
}) {
    return (
        <Box marginTop="-0.5">
            <MenuButton
                actions={[
                    {
                        label: "Nobody last",
                        isSelected: noAccountSide === "End",
                        onPress: () => onNoAccountSideChange("End"),
                    },
                    {
                        label: "Nobody first",
                        isSelected: noAccountSide === "Start",
                        onPress: () => onNoAccountSideChange("Start"),
                    },
                ]}
            >
                <Button
                    variant="quieter"
                    height="5"
                    paddingX="1.5"
                    icon={<CaretDown />}
                    iconPlacement="end"
                >
                    <Box display="flex" alignItems="center" gap="1">
                        <TaskNoAccountAvatar size="3" />
                        <Box>Nobody {noAccountSide === "Start" ? "first" : "last"}</Box>
                    </Box>
                </Button>
            </MenuButton>
        </Box>
    );
}

function TaskQuerySortsEditorRowDateDirection({
    direction,
    onDirectionChange,
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
}) {
    const ascendingLabel = "Jan 1 → Dec 31";
    const descendingLabel = "Dec 31 → Jan 1";

    return (
        <Box marginTop="-0.5">
            <MenuButton
                actions={[
                    {
                        label: ascendingLabel,
                        isSelected: direction === "Ascending",
                        onPress: () => onDirectionChange("Ascending"),
                    },
                    {
                        label: descendingLabel,
                        isSelected: direction === "Descending",
                        onPress: () => onDirectionChange("Descending"),
                    },
                ]}
            >
                <Button
                    variant="quieter"
                    height="5"
                    paddingX="1.5"
                    icon={<CaretDown />}
                    iconPlacement="end"
                >
                    {direction === "Ascending" ? ascendingLabel : descendingLabel}
                </Button>
            </MenuButton>
        </Box>
    );
}
