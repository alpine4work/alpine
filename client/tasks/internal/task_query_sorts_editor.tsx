import {
    DndContext,
    DragOverlay,
    KeyboardSensor,
    MouseSensor,
    TouchSensor,
    closestCenter,
    useDndContext,
    useSensor,
    useSensors,
} from "@dnd-kit/core";
import {SortableContext, arrayMove, useSortable} from "@dnd-kit/sortable";
import {CaretDown, DotsSixVertical, X} from "phosphor-react";
import {Fragment, Key, ReactNode} from "react";
import {mergeProps} from "react-aria";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {TaskMissingAccountAvatar} from "~/client/tasks/internal/task_missing_account_avatar.js";
import {spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {colorSchemeVars, greyElevated2ClassName, sprinkles} from "~/shared/styles/styles.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function TaskQuerySortsEditor({
    withMobileLayout,
    sortsWithId,
    onSortsWithIdChange,
    defaultOrderSentence,
}: {
    withMobileLayout: boolean;
    sortsWithId: Array<{id: number; sort: TaskQuerySort}>;
    onSortsWithIdChange: (sorts: Array<{id: number; sort: TaskQuerySort}>) => void;
    defaultOrderSentence: string;
}) {
    // By default `<DndContext>` uses `PointerSensor` and `KeyboardSensor` but
    // `PointerSensor` can't stop scroll when dragging with touch. So instead we
    // want to directly use `MouseSensor` and `TouchSensor`.
    const sensors = useSensors(
        useSensor(MouseSensor),
        useSensor(TouchSensor),
        useSensor(KeyboardSensor),
    );

    return sortsWithId.length === 0 ? (
        !withMobileLayout ? (
            <Box color="grey-50">No sorts. {defaultOrderSentence}</Box>
        ) : (
            <Box
                height="9"
                paddingX="3"
                display="flex"
                alignItems="center"
                borderRadius="base"
                color="grey-40"
                fontSize="50"
                style={{boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-5"]}`}}
            >
                No sorts. {defaultOrderSentence}
            </Box>
        )
    ) : (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={event => {
                const {active, over} = event;

                if (over && active.id !== over.id) {
                    const oldIndex = sortsWithId.findIndex(
                        sortWithId => sortWithId.id === active.id,
                    );
                    const newIndex = sortsWithId.findIndex(sortWithId => sortWithId.id === over.id);

                    assert(oldIndex >= 0);
                    assert(newIndex >= 0);

                    onSortsWithIdChange(arrayMove(sortsWithId, oldIndex, newIndex));
                }
            }}
        >
            <SortableContext items={sortsWithId}>
                <TaskQuerySortsEditorDragPortals
                    sortsWithId={sortsWithId}
                    withMobileLayout={withMobileLayout}
                />
                <Box
                    position="relative"
                    zIndex="0"
                    marginY={!withMobileLayout ? "-2" : undefined}
                    marginX={!withMobileLayout ? "-2.5" : undefined}
                >
                    {sortsWithId.map(({sort, id}, index) => (
                        <Fragment key={id}>
                            {index !== 0 &&
                                (withMobileLayout ? (
                                    <Box
                                        position="relative"
                                        zIndex="10" // Renders under rows
                                        height="2"
                                    />
                                ) : (
                                    <Box
                                        position="relative"
                                        zIndex="10" // Renders under rows
                                        borderTop="grey-5"
                                        marginX="2.5"
                                    />
                                ))}
                            <TaskQuerySortsEditorRow
                                id={id}
                                sort={sort}
                                isDragOverlay={false}
                                withMobileLayout={withMobileLayout}
                                onSortChange={newSort => {
                                    const newSortsWithKey = [...sortsWithId];
                                    newSortsWithKey[index] = {id, sort: newSort};
                                    onSortsWithIdChange(newSortsWithKey);
                                }}
                                onSortDelete={() => {
                                    const newSortsWithKey = [...sortsWithId];
                                    newSortsWithKey.splice(index, 1);
                                    onSortsWithIdChange(newSortsWithKey);
                                }}
                            />
                        </Fragment>
                    ))}
                </Box>
            </SortableContext>
        </DndContext>
    );
}

function TaskQuerySortsEditorDragPortals({
    sortsWithId,
    withMobileLayout,
}: {
    sortsWithId: Array<{id: Key; sort: TaskQuerySort}>;
    withMobileLayout: boolean;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="80" cursor="grabbing" />,
                    document.body,
                )}
            {active &&
                createPortal(
                    <DragOverlay zIndex={70}>
                        <TaskQuerySortsEditorRow
                            id={active.id}
                            sort={
                                assertExists(
                                    sortsWithId.find(sortWithId => sortWithId.id === active.id),
                                ).sort
                            }
                            isDragOverlay={true}
                            withMobileLayout={withMobileLayout}
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
    withMobileLayout,
    onSortChange,
    onSortDelete,
}: {
    id: Key;
    sort: TaskQuerySort;
    isDragOverlay: boolean;
    withMobileLayout: boolean;
    onSortChange: (sort: TaskQuerySort) => void;
    onSortDelete: () => void;
}) {
    switch (sort.type) {
        case "DisplayStatus": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Status"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowStatusDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "Priority": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Priority"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowPriorityDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowAccountMissing
                        missing={sort.missing}
                        onMissingChange={missing => onSortChange({...sort, missing})}
                        withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowAccountMissing
                        missing={sort.missing}
                        onMissingChange={missing => onSortChange({...sort, missing})}
                        withMobileLayout={withMobileLayout}
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
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "CreatedTime": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Created date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "AssignedTime": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Assigned date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "ClosedTime": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Closed date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "ActivatedTime": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Active date"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                    withMobileLayout={withMobileLayout}
                >
                    <TaskQuerySortsEditorRowDateDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                        withMobileLayout={withMobileLayout}
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
    withMobileLayout,
    children,
}: {
    id: Key;
    name: string;
    onDelete: () => void;
    isDragOverlay: boolean;
    withMobileLayout: boolean;
    children?: ReactNode;
}) {
    const isMobile = useIsMobile();

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
            className={greyElevated2ClassName}
            position="relative"
            zIndex="20" // Renders over dividers
            paddingLeft={withMobileLayout ? "3" : "2.5"}
            paddingRight={withMobileLayout ? (isMobile ? "1.5" : "2.5") : "2.5"}
            display="flex"
            alignItems="center"
            backgroundColor={isDragOverlay ? "grey-0" : undefined}
            boxShadow={
                isDragOverlay
                    ? withMobileLayout
                        ? "elevation-20-with-grey-10-border"
                        : "elevation-30"
                    : undefined
            }
            borderRadius={withMobileLayout || isDragOverlay ? "base" : undefined}
            style={{
                transform: sortableTransform
                    ? `translate(${sortableTransform.x}px, ${sortableTransform.y}px)`
                    : undefined,
                transition: sortableTransition,
                opacity: isDragging ? 0 : undefined,

                height: withMobileLayout
                    ? spacing["9"]
                    : // Add 2px of height when this is a drag overlay so it covers the dividers.
                    isDragOverlay
                    ? `calc(${spacing["8"]} + 2px)`
                    : spacing["8"],
                marginTop: isDragOverlay && !withMobileLayout ? -1 : 0,

                boxShadow:
                    withMobileLayout && !isDragOverlay
                        ? `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`
                        : undefined,
            }}
        >
            <Box flexShrink="0">{name}</Box>
            {!withMobileLayout && <Box flexGrow="1" />}
            {children && (
                <Box
                    flexShrink="0"
                    paddingLeft={withMobileLayout ? "1" : "2"}
                    style={{height: withMobileLayout ? `calc(${spacing["9"]} - 4px)` : undefined}}
                >
                    {children}
                </Box>
            )}
            {withMobileLayout && <Box flexGrow="1" />}
            <Box
                flexShrink="0"
                display="flex"
                alignItems="center"
                gap={isMobile ? "1" : "0.5"}
                paddingLeft="3"
            >
                <button
                    {...mergeProps(sortableAttributes, sortableListeners ?? {})}
                    className={sprinkles({
                        width: isMobile ? "9" : "4",
                        height: isMobile ? "9" : "4",
                        margin: isMobile ? "-1.5" : undefined,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        borderRadius: "full",
                        cursor: "grab",
                    })}
                    // Drag handle is not tab focusable. Keyboard navigation within a task grid is
                    // not done with tab navigation.
                    tabIndex={-1}
                >
                    <DotsSixVertical size={spacing[isMobile ? "4" : "3"]} />
                </button>
                <IconButton
                    size={isMobile ? "md" : "xs"}
                    borderRadius={withMobileLayout ? "sm" : undefined}
                    description="Delete"
                    withoutTooltip={true}
                    onPress={onDelete}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );
}

function TaskQuerySortsEditorRowStatusDirection({
    direction,
    onDirectionChange,
    withMobileLayout,
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
    withMobileLayout: boolean;
}) {
    const isMobile = useIsMobile();

    const ascendingLabel = "Open → Closed";
    const descendingLabel = "Closed → Open";

    return (
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
                height={withMobileLayout ? "full" : "5"}
                paddingX={isMobile ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {direction === "Ascending" ? ascendingLabel : descendingLabel}
            </Button>
        </MenuButton>
    );
}

function TaskQuerySortsEditorRowPriorityDirection({
    direction,
    onDirectionChange,
    withMobileLayout,
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
    withMobileLayout: boolean;
}) {
    const isMobile = useIsMobile();

    const ascendingLabel = "Low → High";
    const descendingLabel = "High → Low";

    return (
        <MenuButton
            actions={[
                {
                    label: descendingLabel,
                    isSelected: direction === "Descending",
                    onPress: () => onDirectionChange("Descending"),
                },
                {
                    label: ascendingLabel,
                    isSelected: direction === "Ascending",
                    onPress: () => onDirectionChange("Ascending"),
                },
            ]}
        >
            <Button
                variant="quieter"
                height={withMobileLayout ? "full" : "5"}
                paddingX={isMobile ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {direction === "Ascending" ? ascendingLabel : descendingLabel}
            </Button>
        </MenuButton>
    );
}

function TaskQuerySortsEditorRowAccountMissing({
    missing,
    onMissingChange,
    withMobileLayout,
}: {
    missing: "First" | "Last";
    onMissingChange: (missing: "First" | "Last") => void;
    withMobileLayout: boolean;
}) {
    const isMobile = useIsMobile();

    return (
        <MenuButton
            actions={[
                {
                    label: "Nobody last",
                    isSelected: missing === "Last",
                    onPress: () => onMissingChange("Last"),
                },
                {
                    label: "Nobody first",
                    isSelected: missing === "First",
                    onPress: () => onMissingChange("First"),
                },
            ]}
        >
            <Button
                variant="quieter"
                height={withMobileLayout ? "full" : "5"}
                paddingX={isMobile ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                <Box display="flex" alignItems="center" gap="1">
                    <TaskMissingAccountAvatar size="3" />
                    <Box>Nobody {missing === "First" ? "first" : "last"}</Box>
                </Box>
            </Button>
        </MenuButton>
    );
}

function TaskQuerySortsEditorRowDateDirection({
    direction,
    onDirectionChange,
    withMobileLayout,
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
    withMobileLayout: boolean;
}) {
    const isMobile = useIsMobile();

    const ascendingLabel = "Jan 1 → Dec 31";
    const descendingLabel = "Dec 31 → Jan 1";

    return (
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
                height={withMobileLayout ? "full" : "5"}
                paddingX={isMobile ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {direction === "Ascending" ? ascendingLabel : descendingLabel}
            </Button>
        </MenuButton>
    );
}
