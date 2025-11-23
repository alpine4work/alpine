import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {TaskQueryDisplayStatusFilter} from "~/shared/tasks/task_query_filter.js";

export function TaskQueryDisplayStatusFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryDisplayStatusFilter;
    onFilterChange: (filter: TaskQueryDisplayStatusFilter) => void;
}) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton({}, buttonRef);
    const {hoverProps, isHovered} = useHover({});

    const statuses = [
        filter.operation.displayStatuses.has("OpenInactive") &&
            (filter.operation.displayStatuses.has("OpenActive") ? (
                <>
                    <TaskDisplayStatusCircle displayStatus="OpenInactive" size="3" />
                    <Box paddingLeft="1">open</Box>
                </>
            ) : (
                <>
                    <TaskDisplayStatusCircle displayStatus="OpenInactive" size="3" />
                    <Box paddingLeft="1">inactive</Box>
                </>
            )),
        filter.operation.displayStatuses.has("OpenActive") &&
            !filter.operation.displayStatuses.has("OpenInactive") && (
                <>
                    <TaskDisplayStatusCircle displayStatus="OpenActive" size="3" />
                    <Box paddingLeft="1">active</Box>
                </>
            ),
        filter.operation.displayStatuses.has("Closed") && (
            <>
                <TaskDisplayStatusCircle displayStatus="Closed" size="3" />
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
                                type: "DisplayStatus",
                                operation: {
                                    type: "OneOf",
                                    displayStatuses: filter.operation.displayStatuses,
                                },
                            });
                        },
                    },
                    {
                        label: "is not",
                        isSelected: filter.operation.type === "NoneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "DisplayStatus",
                                operation: {
                                    type: "NoneOf",
                                    displayStatuses: filter.operation.displayStatuses,
                                },
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
                            const newStatuses = new Set(filter.operation.displayStatuses);
                            const hasOpenInactive = newStatuses.delete("OpenInactive");
                            const hasOpenActive = newStatuses.delete("OpenActive");
                            if (!hasOpenInactive || !hasOpenActive) {
                                newStatuses.add("OpenInactive");
                                newStatuses.add("OpenActive");
                            }

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, displayStatuses: newStatuses},
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
                                <CheckboxIcon
                                    isChecked={
                                        filter.operation.displayStatuses.has("OpenInactive") &&
                                        filter.operation.displayStatuses.has("OpenActive")
                                    }
                                />
                                <TaskDisplayStatusCircle displayStatus="OpenInactive" size="4" />
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
                            const newStatuses = new Set(filter.operation.displayStatuses);
                            if (!newStatuses.delete("OpenInactive"))
                                newStatuses.add("OpenInactive");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, displayStatuses: newStatuses},
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
                                <CheckboxIcon
                                    isChecked={filter.operation.displayStatuses.has("OpenInactive")}
                                />
                                <TaskDisplayStatusCircle displayStatus="OpenInactive" size="4" />
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
                                        top: addRemLengths("3", "0.5"),
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.displayStatuses);
                            if (!newStatuses.delete("OpenActive")) newStatuses.add("OpenActive");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, displayStatuses: newStatuses},
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
                                <CheckboxIcon
                                    isChecked={filter.operation.displayStatuses.has("OpenActive")}
                                />
                                <TaskDisplayStatusCircle displayStatus="OpenActive" size="4" />
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
                                        bottom: addRemLengths("3", "0.5"),
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
                                        top: addRemLengths("3", "0.5"),
                                        left: `calc(${spacing["3"]} - 1px)`,
                                    }}
                                />
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newStatuses = new Set(filter.operation.displayStatuses);
                            if (!newStatuses.delete("Closed")) newStatuses.add("Closed");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, displayStatuses: newStatuses},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon
                                    isChecked={filter.operation.displayStatuses.has("Closed")}
                                />
                                <TaskDisplayStatusCircle displayStatus="Closed" size="4" />
                                <Box>Closed</Box>
                            </Box>
                        ),
                    },
                ]}
            >
                {({isVisible}) => (
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
                                        : isHovered || isVisible
                                        ? "grey-5"
                                        : undefined,
                                    borderRadius: "0.5",
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
                )}
            </MenuButton>
        </>
    );
}
