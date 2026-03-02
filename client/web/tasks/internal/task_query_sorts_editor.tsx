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
import {Fragment, ReactNode, useMemo} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {TaskMissingAccountAvatar} from "~/client/web/tasks/task_missing_account_avatar.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {TaskQuerySort} from "~/shared/tasks/task_query_sort.js";

export function TaskQuerySortsEditor({
    sortsWithId,
    onSortsWithIdChange,
    defaultOrderSentence,
}: {
    sortsWithId: ReadonlyArray<{id: number; sort: TaskQuerySort}>;
    onSortsWithIdChange: (sorts: ReadonlyArray<{id: number; sort: TaskQuerySort}>) => void;
    defaultOrderSentence: string;
}) {
    const platform = usePlatform();

    // By default `<DndContext>` uses `PointerSensor` and `KeyboardSensor` but
    // `PointerSensor` can't stop scroll when dragging with touch. So instead we
    // want to directly use `MouseSensor` and `TouchSensor`.
    const sensors = useSensors(
        useSensor(MouseSensor),
        useSensor(TouchSensor),
        useSensor(KeyboardSensor),
    );

    return sortsWithId.length === 0 ? (
        platform !== "mobile" ? (
            <Box color="grey-50">No sorts. {defaultOrderSentence}</Box>
        ) : (
            <Box
                height="9"
                paddingX="3"
                display="flex"
                alignItems="center"
                borderRadius="1"
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
                if (!over || active.id === over.id) return;

                const oldIndex = sortsWithId.findIndex(sortWithId => sortWithId.id === active.id);
                const newIndex = sortsWithId.findIndex(sortWithId => sortWithId.id === over.id);

                assert(oldIndex >= 0);
                assert(newIndex >= 0);

                onSortsWithIdChange(arrayMove(sortsWithId, oldIndex, newIndex));
            }}
        >
            <SortableContext items={sortsWithId}>
                <TaskQuerySortsEditorDragPortals sortsWithId={sortsWithId} />
                <Box
                    position="relative"
                    zIndex="0"
                    marginY={platform !== "mobile" ? "-2" : undefined}
                    marginX={platform !== "mobile" ? "-2.5" : undefined}
                >
                    {sortsWithId.map(({sort, id}, index) => (
                        <Fragment key={id}>
                            {index !== 0 &&
                                (platform === "mobile" ? (
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
}: {
    sortsWithId: ReadonlyArray<{id: number; sort: TaskQuerySort}>;
}) {
    const {active, activatorEvent} = useDndContext();

    const isPointerDragging =
        active && (activatorEvent instanceof PointerEvent || activatorEvent instanceof MouseEvent);

    const activeSortWithId = useMemo(
        () =>
            active
                ? assertExists(sortsWithId.find(sortWithId => sortWithId.id === active.id))
                : null,
        [active, sortsWithId],
    );

    return (
        <>
            {isPointerDragging &&
                createPortal(
                    <Box position="absolute" inset="0" zIndex="80" cursor="grabbing" />,
                    document.body,
                )}
            {activeSortWithId &&
                createPortal(
                    <DragOverlay zIndex={70}>
                        <TaskQuerySortsEditorRow
                            id={activeSortWithId.id}
                            sort={activeSortWithId.sort}
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
    id: number;
    sort: TaskQuerySort;
    isDragOverlay: boolean;
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
                >
                    <TaskQuerySortsEditorRowStatusDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
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
                >
                    <TaskQuerySortsEditorRowPriorityDirection
                        direction={sort.direction}
                        onDirectionChange={direction => onSortChange({...sort, direction})}
                    />
                </TaskQuerySortsEditorRowBase>
            );
        }
        case "Layout": {
            return (
                <TaskQuerySortsEditorRowBase
                    id={id}
                    name="Project"
                    onDelete={onSortDelete}
                    isDragOverlay={isDragOverlay}
                >
                    <TaskQuerySortsEditorRowLayoutDirection
                        missing={sort.missing}
                        onMissingChange={missing => onSortChange({...sort, missing})}
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
                    <TaskQuerySortsEditorRowAccountMissing
                        missing={sort.missing}
                        onMissingChange={missing => onSortChange({...sort, missing})}
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
                    <TaskQuerySortsEditorRowAccountMissing
                        missing={sort.missing}
                        onMissingChange={missing => onSortChange({...sort, missing})}
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
        case "CreatedTime": {
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
        case "AssignedTime": {
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
        case "ClosedTime": {
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
        case "ActivatedTime": {
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
    id: number;
    name: string;
    onDelete: () => void;
    isDragOverlay: boolean;
    children?: ReactNode;
}) {
    const platform = usePlatform();

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
            paddingLeft={platform === "mobile" ? "3" : "2.5"}
            paddingRight={platform === "mobile" ? "1.5" : "2.5"}
            display="flex"
            alignItems="center"
            backgroundColor={isDragOverlay ? "grey-0" : undefined}
            boxShadow={
                isDragOverlay
                    ? platform === "mobile"
                        ? "elevation-20-with-grey-10-border"
                        : "elevation-30"
                    : undefined
            }
            borderRadius={platform === "mobile" || isDragOverlay ? "1" : undefined}
            style={{
                transform: sortableTransform
                    ? `translate(${sortableTransform.x}px, ${sortableTransform.y}px)`
                    : undefined,
                transition: sortableTransition,
                opacity: isDragging ? 0 : undefined,

                height:
                    platform === "mobile"
                        ? spacing["9"]
                        : // Add 2px of height when this is a drag overlay so it covers the dividers.
                          isDragOverlay
                          ? `calc(${spacing["8"]} + 2px)`
                          : spacing["8"],
                marginTop: isDragOverlay && platform !== "mobile" ? -1 : 0,

                boxShadow:
                    platform === "mobile" && !isDragOverlay
                        ? `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`
                        : undefined,
            }}
        >
            <Box flexShrink="0">{name}</Box>
            {platform !== "mobile" && <Box flexGrow="1" />}
            {children && (
                <Box
                    flexShrink="0"
                    paddingLeft={platform === "mobile" ? "1" : "2"}
                    style={{
                        height: platform === "mobile" ? `calc(${spacing["9"]} - 4px)` : undefined,
                    }}
                >
                    {children}
                </Box>
            )}
            {platform === "mobile" && <Box flexGrow="1" />}
            <Box
                flexShrink="0"
                display="flex"
                alignItems="center"
                gap={platform === "mobile" ? "1" : "0.5"}
                paddingLeft="3"
            >
                <button
                    {...sortableAttributes}
                    {...sortableListeners}
                    className={sprinkles({
                        width: platform === "mobile" ? "9" : "4",
                        height: platform === "mobile" ? "9" : "4",
                        margin: platform === "mobile" ? "-1.5" : undefined,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        borderRadius: "full",
                        cursor: "grab",
                        color: "grey-70",
                    })}
                    // Drag handle is not tab focusable. Keyboard navigation within a task grid is
                    // not done with tab navigation.
                    tabIndex={-1}
                >
                    <DotsSixVertical size={spacing[platform === "mobile" ? "4" : "3"]} />
                </button>
                <IconButton
                    size={platform === "mobile" ? "md" : "xs"}
                    borderRadius={platform === "mobile" ? "0.5" : undefined}
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
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
}) {
    const platform = usePlatform();

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
                height={platform === "mobile" ? "full" : "5"}
                paddingX={platform === "mobile" ? "2" : "1.5"}
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
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
}) {
    const platform = usePlatform();

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
                height={platform === "mobile" ? "full" : "5"}
                paddingX={platform === "mobile" ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {direction === "Ascending" ? ascendingLabel : descendingLabel}
            </Button>
        </MenuButton>
    );
}

function TaskQuerySortsEditorRowLayoutDirection({
    missing,
    onMissingChange,
}: {
    missing: "First" | "Last";
    onMissingChange: (missing: "First" | "Last") => void;
}) {
    const platform = usePlatform();

    const firstLabel = "Task → Project";
    const lastLabel = "Project → Task";

    return (
        <MenuButton
            actions={[
                {
                    label: lastLabel,
                    isSelected: missing === "Last",
                    onPress: () => onMissingChange("Last"),
                },
                {
                    label: firstLabel,
                    isSelected: missing === "First",
                    onPress: () => onMissingChange("First"),
                },
            ]}
        >
            <Button
                variant="quieter"
                height={platform === "mobile" ? "full" : "5"}
                paddingX={platform === "mobile" ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {missing === "First" ? firstLabel : lastLabel}
            </Button>
        </MenuButton>
    );
}

function TaskQuerySortsEditorRowAccountMissing({
    missing,
    onMissingChange,
}: {
    missing: "First" | "Last";
    onMissingChange: (missing: "First" | "Last") => void;
}) {
    const platform = usePlatform();

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
                height={platform === "mobile" ? "full" : "5"}
                paddingX={platform === "mobile" ? "2" : "1.5"}
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
}: {
    direction: "Ascending" | "Descending";
    onDirectionChange: (direction: "Ascending" | "Descending") => void;
}) {
    const platform = usePlatform();

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
                height={platform === "mobile" ? "full" : "5"}
                paddingX={platform === "mobile" ? "2" : "1.5"}
                icon={<CaretDown />}
                iconPlacement="end"
            >
                {direction === "Ascending" ? ascendingLabel : descendingLabel}
            </Button>
        </MenuButton>
    );
}
