import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuButton} from "~/client/design/menu_button";
import {TaskCheckbox} from "~/client/tasks/demo_2/internal/task_checkbox";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle";
import {TaskQueryStatusFilter} from "~/client/tasks/demo_2/task_query_filter";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";

export function TaskQueryStatusFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryStatusFilter;
    onFilterChange: (filter: TaskQueryStatusFilter) => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    const statuses = [
        filter.operation.statuses.has("Open") && (
            <>
                <TaskStatusCircle status="Open" size="3" />
                <Box paddingLeft="1">open</Box>
            </>
        ),
        filter.operation.statuses.has("Active") && (
            <>
                <TaskStatusCircle status="Active" size="3" />
                <Box paddingLeft="1">active</Box>
            </>
        ),
        filter.operation.statuses.has("Closed") && (
            <>
                <TaskStatusCircle status="Closed" size="3" />
                <Box paddingLeft="1">closed</Box>
            </>
        ),
    ].filter(isNonNullableOrFalse);

    return (
        <>
            <TaskQueryFilterOperatorEditor
                operatorLabel={filter.operation.type === "OneOf" ? "is" : "is not"}
                allOperators={[
                    {
                        label: "is",
                        isSelected: filter.operation.type === "OneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Status",
                                operation: {type: "OneOf", statuses: filter.operation.statuses},
                            });
                        },
                    },
                    {
                        label: "is not",
                        isSelected: filter.operation.type === "NoneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Status",
                                operation: {type: "NoneOf", statuses: filter.operation.statuses},
                            });
                        },
                    },
                ]}
            />
            <MenuButton
                actions={[
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            if (!newStatuses.delete("Open")) newStatuses.add("Open");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <TaskCheckbox isChecked={filter.operation.statuses.has("Open")} />
                                <TaskStatusCircle status="Open" size="4" />
                                <Box>Open</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            if (!newStatuses.delete("Active")) newStatuses.add("Active");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <TaskCheckbox isChecked={filter.operation.statuses.has("Active")} />
                                <TaskStatusCircle status="Active" size="4" />
                                <Box>Active</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            if (!newStatuses.delete("Closed")) newStatuses.add("Closed");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <TaskCheckbox isChecked={filter.operation.statuses.has("Closed")} />
                                <TaskStatusCircle status="Closed" size="4" />
                                <Box>Closed</Box>
                            </Box>
                        ),
                    },
                ]}
            >
                <FocusRing offset="0">
                    <button
                        {...mergeProps(buttonProps, hoverProps)}
                        ref={buttonRef}
                        className={sprinkles({
                            height: "full",
                        })}
                        style={{
                            paddingTop: 1,
                            paddingBottom: 1,
                        }}
                    >
                        <span
                            className={sprinkles({
                                height: "full",
                                minWidth: "4",
                                paddingX: "1",
                                display: "flex",
                                alignItems: "center",
                                // The hit radius for this button extends within the entire filter editor but
                                // the background color style has some inset.
                                backgroundColor: isPressed
                                    ? "grey-10"
                                    : isHovered
                                    ? "grey-5"
                                    : undefined,
                                borderRadius: "sm",
                            })}
                        >
                            {statuses.length === 0 ? (
                                <Box style={inputPlaceholderStyles}>
                                    {filter.operation.type === "OneOf"
                                        ? "open or active"
                                        : "closed"}
                                </Box>
                            ) : statuses.length === 1 ? (
                                statuses[0]
                            ) : statuses.length === 2 ? (
                                <>
                                    {statuses[0]}
                                    <Box paddingLeft="1" paddingRight="1.5" color="grey-60">
                                        or
                                    </Box>
                                    {statuses[1]}
                                </>
                            ) : statuses.length === 3 ? (
                                <>
                                    {statuses[0]}
                                    <Box color="grey-60" paddingRight="1">
                                        ,
                                    </Box>
                                    {statuses[1]}
                                    <Box paddingRight="1.5" color="grey-60">
                                        , or
                                    </Box>
                                    {statuses[2]}
                                </>
                            ) : null}
                        </span>
                    </button>
                </FocusRing>
            </MenuButton>
        </>
    );
}
