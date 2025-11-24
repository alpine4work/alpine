import {useRef} from "react";
import {mergeProps, useButton, useHover} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, inputPlaceholderStyles, sprinkles} from "~/client/web/styles/styles.js";
import {TaskPriorityIcon} from "~/client/web/tasks/internal/task_priority_icon.js";
import {TaskQueryFilterOperatorEditor} from "~/client/web/tasks/internal/task_query_filter_operator_editor.js";
import {isNonNullableOrFalse} from "~/shared/helpers/control/is_non_nullable_or_false.js";
import {TaskQueryPriorityFilter} from "~/shared/tasks/task_query_filter.js";

export function TaskQueryPriorityFilterOperationEditor({
    filter,
    onFilterChange,
}: {
    filter: TaskQueryPriorityFilter;
    onFilterChange: (filter: TaskQueryPriorityFilter) => void;
}) {
    const platform = usePlatform();

    const buttonRef = useRef<HTMLButtonElement>(null);
    const {buttonProps, isPressed} = useButton(
        {},
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        buttonRef,
    );
    const {hoverProps, isHovered} = useHover({});

    const priorities = [
        filter.operation.priorities.has(null) && (
            <>
                <TaskPriorityIcon priority={null} size="3" shouldHighlightUrgent={false} />
                <Box paddingLeft="1">none</Box>
            </>
        ),
        filter.operation.priorities.has("Low") && (
            <>
                <TaskPriorityIcon priority="Low" size="3" shouldHighlightUrgent={false} />
                <Box paddingLeft="1">low</Box>
            </>
        ),
        filter.operation.priorities.has("Medium") && (
            <>
                <TaskPriorityIcon priority="Medium" size="3" shouldHighlightUrgent={false} />
                <Box paddingLeft="1">medium</Box>
            </>
        ),
        filter.operation.priorities.has("High") && (
            <>
                <TaskPriorityIcon priority="High" size="3" shouldHighlightUrgent={false} />
                <Box paddingLeft="1">high</Box>
            </>
        ),
        filter.operation.priorities.has("Urgent") && (
            <>
                <TaskPriorityIcon priority="Urgent" size="3" shouldHighlightUrgent={false} />
                <Box paddingLeft="1">urgent</Box>
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
                                type: "Priority",
                                operation: {type: "OneOf", priorities: filter.operation.priorities},
                            });
                        },
                    },
                    {
                        label: "is not",
                        isSelected: filter.operation.type === "NoneOf",
                        onPress: () => {
                            onFilterChange({
                                type: "Priority",
                                operation: {
                                    type: "NoneOf",
                                    priorities: filter.operation.priorities,
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
                            const newPriorities = new Set(filter.operation.priorities);
                            if (!newPriorities.delete(null)) newPriorities.add(null);

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, priorities: newPriorities},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon isChecked={filter.operation.priorities.has(null)} />
                                <TaskPriorityIcon
                                    priority={null}
                                    size="4"
                                    shouldHighlightUrgent={false}
                                />
                                <Box>None</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newPriorities = new Set(filter.operation.priorities);
                            if (!newPriorities.delete("Low")) newPriorities.add("Low");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, priorities: newPriorities},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon isChecked={filter.operation.priorities.has("Low")} />
                                <TaskPriorityIcon
                                    priority="Low"
                                    size="4"
                                    shouldHighlightUrgent={false}
                                />
                                <Box>Low</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newPriorities = new Set(filter.operation.priorities);
                            if (!newPriorities.delete("Medium")) newPriorities.add("Medium");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, priorities: newPriorities},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon
                                    isChecked={filter.operation.priorities.has("Medium")}
                                />
                                <TaskPriorityIcon
                                    priority="Medium"
                                    size="4"
                                    shouldHighlightUrgent={false}
                                />
                                <Box>Medium</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newPriorities = new Set(filter.operation.priorities);
                            if (!newPriorities.delete("High")) newPriorities.add("High");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, priorities: newPriorities},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon isChecked={filter.operation.priorities.has("High")} />
                                <TaskPriorityIcon
                                    priority="High"
                                    size="4"
                                    shouldHighlightUrgent={false}
                                />
                                <Box>High</Box>
                            </Box>
                        ),
                    },
                    {
                        onPress: () => {
                            const newPriorities = new Set(filter.operation.priorities);
                            if (!newPriorities.delete("Urgent")) newPriorities.add("Urgent");

                            onFilterChange({
                                ...filter,
                                operation: {...filter.operation, priorities: newPriorities},
                            });
                        },
                        withCustomLayout: true,
                        render: () => (
                            <Box padding="1.5" display="flex" alignItems="center" gap="1.5">
                                <CheckboxIcon
                                    isChecked={filter.operation.priorities.has("Urgent")}
                                />
                                <TaskPriorityIcon
                                    priority="Urgent"
                                    size="4"
                                    shouldHighlightUrgent={false}
                                />
                                <Box>Urgent</Box>
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
                                position: "relative",
                                zIndex: "0",
                                flexShrink: "1",
                                height: "full",
                                overflow: platform === "mobile" ? "hidden" : undefined,
                            })}
                            style={{
                                paddingTop: 1,
                                paddingBottom: 1,
                            }}
                        >
                            {platform === "mobile" && (
                                <span
                                    className={sprinkles({
                                        position: "absolute",
                                        zIndex: "20",
                                        right: "0",
                                        width: "2",
                                        borderRightRadius: "0.5",
                                    })}
                                    style={{
                                        top: 1,
                                        bottom: 1,
                                        background: `linear-gradient(to right, transparent, ${
                                            colorSchemeVars[
                                                isPressed
                                                    ? "grey-10"
                                                    : isHovered || isVisible
                                                    ? "grey-5"
                                                    : "grey-0"
                                            ]
                                        })`,
                                    }}
                                />
                            )}
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
                                {priorities.length === 0 ? (
                                    <Box style={inputPlaceholderStyles}>
                                        {filter.operation.type === "OneOf" ? "anything" : "nothing"}
                                    </Box>
                                ) : priorities.length === 1 ? (
                                    priorities[0]
                                ) : priorities.length === 2 ? (
                                    <>
                                        {priorities[0]}
                                        <Box paddingLeft="1" paddingRight="1.5" color="grey-60">
                                            or
                                        </Box>
                                        {priorities[1]}
                                    </>
                                ) : priorities.length === 3 ? (
                                    <>
                                        {priorities[0]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[1]}
                                        <Box paddingRight="1.5" color="grey-60">
                                            ,&nbsp;or
                                        </Box>
                                        {priorities[2]}
                                    </>
                                ) : priorities.length === 4 ? (
                                    <>
                                        {priorities[0]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[1]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[2]}
                                        <Box paddingRight="1.5" color="grey-60">
                                            ,&nbsp;or
                                        </Box>
                                        {priorities[3]}
                                    </>
                                ) : priorities.length === 5 ? (
                                    <>
                                        {priorities[0]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[1]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[2]}
                                        <Box color="grey-60" paddingRight="1">
                                            ,
                                        </Box>
                                        {priorities[3]}
                                        <Box paddingRight="1.5" color="grey-60">
                                            ,&nbsp;or
                                        </Box>
                                        {priorities[4]}
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
