import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/design/box";
import {FocusRing} from "~/client/design/focus_ring";
import {MenuButton} from "~/client/design/menu_button";
import {TaskCheckbox} from "~/client/tasks/demo_2/internal/task_checkbox";
import {TaskQueryFilterOperatorEditor} from "~/client/tasks/demo_2/internal/task_query_filter_operator_editor";
import {TaskStatusCircle} from "~/client/tasks/demo_2/internal/task_status_circle";
import {addRemLengths, spacing} from "~/shared/design/spacing";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false";
import {inputPlaceholderStyles, sprinkles} from "~/shared/styles/styles";
import {TaskQueryStatusFilter} from "~/shared/tasks/task_query_filter";

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
        filter.operation.statuses.has("OpenInactive") &&
            (filter.operation.statuses.has("OpenActive") ? (
                <>
                    <TaskStatusCircle status="OpenInactive" size="3" />
                    <Box paddingLeft="1">open</Box>
                </>
            ) : (
                <>
                    <TaskStatusCircle status="OpenInactive" size="3" />
                    <Box paddingLeft="1">inactive</Box>
                </>
            )),
        filter.operation.statuses.has("OpenActive") &&
            !filter.operation.statuses.has("OpenInactive") && (
                <>
                    <TaskStatusCircle status="OpenActive" size="3" />
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
                shouldNotCloseAfterActionPress={true}
                actions={[
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            const hasOpenInactive = newStatuses.delete("OpenInactive");
                            const hasOpenActive = newStatuses.delete("OpenActive");
                            if (!hasOpenInactive || !hasOpenActive) {
                                newStatuses.add("OpenInactive");
                                newStatuses.add("OpenActive");
                            }

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: ({isHovered, isPressed}) => (
                            <Box
                                position="relative"
                                padding="1.5"
                                display="flex"
                                alignItems="center"
                                gap="1.5"
                            >
                                <TaskCheckbox
                                    isChecked={
                                        filter.operation.statuses.has("OpenInactive") &&
                                        filter.operation.statuses.has("OpenActive")
                                    }
                                />
                                <TaskStatusCircle status="OpenInactive" size="4" />
                                <Box>Open</Box>
                                <Box
                                    position="absolute"
                                    bottom="0"
                                    height="1"
                                    borderLeft={
                                        isPressed ? "grey-20" : isHovered ? "grey-10" : "grey-5"
                                    }
                                    style={{
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            if (!newStatuses.delete("OpenInactive"))
                                newStatuses.add("OpenInactive");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: ({isHovered, isPressed}) => (
                            <Box
                                position="relative"
                                padding="1.5"
                                paddingLeft="6"
                                display="flex"
                                alignItems="center"
                                gap="1.5"
                            >
                                <TaskCheckbox
                                    isChecked={filter.operation.statuses.has("OpenInactive")}
                                />
                                <TaskStatusCircle status="OpenInactive" size="4" />
                                <Box>Inactive</Box>
                                <Box
                                    position="absolute"
                                    top="0"
                                    bottom="0"
                                    borderLeft={
                                        isPressed ? "grey-20" : isHovered ? "grey-10" : "grey-5"
                                    }
                                    style={{
                                        top: 0,
                                        bottom: 0,
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                                <Box
                                    position="absolute"
                                    width="2"
                                    borderTop={
                                        isPressed ? "grey-20" : isHovered ? "grey-10" : "grey-5"
                                    }
                                    style={{
                                        top: addRemLengths(spacing["3"], spacing["0.5"]),
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.statuses);
                            if (!newStatuses.delete("OpenActive")) newStatuses.add("OpenActive");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, statuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: ({isHovered, isPressed}) => (
                            <Box
                                position="relative"
                                padding="1.5"
                                paddingLeft="6"
                                display="flex"
                                alignItems="center"
                                gap="1.5"
                            >
                                <TaskCheckbox
                                    isChecked={filter.operation.statuses.has("OpenActive")}
                                />
                                <TaskStatusCircle status="OpenActive" size="4" />
                                <Box>Active</Box>
                                <Box
                                    position="absolute"
                                    top="0"
                                    bottom="0"
                                    left="3"
                                    borderLeft={
                                        isPressed ? "grey-20" : isHovered ? "grey-10" : "grey-5"
                                    }
                                    style={{
                                        top: 0,
                                        bottom: addRemLengths(spacing["3"], spacing["0.5"]),
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                                <Box
                                    position="absolute"
                                    width="2"
                                    borderTop={
                                        isPressed ? "grey-20" : isHovered ? "grey-10" : "grey-5"
                                    }
                                    style={{
                                        top: addRemLengths(spacing["3"], spacing["0.5"]),
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
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
                                    {filter.operation.type === "OneOf" ? "open" : "closed"}
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
