import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import {Check, MagnifyingGlass} from "phosphor-react";
import {RefObject, cloneElement, isValidElement, useRef, useState} from "react";
import {AriaListBoxOptions, mergeProps, useHover, useListBox, useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    TaskAssigneeInputItem,
    nullTaskAssigneeInputLabel,
} from "~/client/tasks/internal/task_assignee_input.js";
import {TaskMissingAccountAvatar} from "~/client/tasks/internal/task_missing_account_avatar.js";
import {spacing} from "~/shared/design/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {colorSchemeVars, greyElevated2ClassName, sprinkles} from "~/shared/styles/styles.js";

export function TaskAssigneeInputListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskAssigneeInputItem>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskAssigneeInputItem>;
    selectedKey: string;
}) {
    const isMobile = useIsMobile();

    const {listBoxProps} = useListBox(_listBoxProps, comboBoxState, listBoxRef);

    return (
        <ul
            {...listBoxProps}
            ref={useMergedRefs(listBoxRef, useScrollbar())}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    position: "relative",
                    borderRadius: "md",
                    padding: "1",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    width: "48",
                    overflowX: "hidden",
                    overflowY: "auto",
                }),
            )}
            style={{
                // On mobile the height needs to be less than half of the available space when
                // the keyboard and navigation bar are open.
                maxHeight: isMobile ? "10rem" : spacing["64"],
            }}
        >
            {comboBoxState.collection.size === 0 ? (
                <Box padding="1.5" display="flex" alignItems="center" gap="1.5" color="grey-70">
                    <Box padding="0.5">
                        <MagnifyingGlass size={spacing["4"]} />
                    </Box>
                    <Box>No results</Box>
                </Box>
            ) : (
                Array.from(comboBoxState.collection, item => (
                    <TaskAssigneeInputListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        selectedKey={selectedKey}
                    />
                ))
            )}
        </ul>
    );
}

function TaskAssigneeInputListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskAssigneeInputItem>;
    item: Node<TaskAssigneeInputItem>;
    selectedKey: string;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    assert(isValidElement(item.rendered));

    return (
        <FocusRing offset="0" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...mergeProps(optionProps, hoverProps)}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    borderRadius: "base",
                    color: "grey-text",
                    backgroundColor: isPressed ? "grey-10" : isHovered ? "grey-5" : undefined,
                })}
            >
                {cloneElement(item.rendered, {
                    isSelected: selectedKey === item.key,
                    isPressed,
                } as any)}
            </li>
        </FocusRing>
    );
}

export function TaskAssigneeInputListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: TaskAssigneeInputItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" && typeof isPressed === "boolean",
        "Expected to be rendered by <TaskAssigneeInputListBoxOption> which provides extra props",
    );

    switch (item.type) {
        case "Account": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <AccountAvatar account={item.accountData} size="5" />
                    <Box flexGrow="1" fontStyle="truncate">
                        {item.accountData.name}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        case "Null": {
            return (
                <Box display="flex" alignItems="center" gap="1.5">
                    <TaskMissingAccountAvatar />
                    <Box flexGrow="1" fontStyle="truncate" color="grey-60">
                        {nullTaskAssigneeInputLabel}
                    </Box>
                    {isSelected && (
                        <Box flexShrink="0" marginLeft="2">
                            <Check
                                size={spacing["3"]}
                                color={
                                    isPressed
                                        ? colorSchemeVars["grey-text"]
                                        : colorSchemeVars["grey-70"]
                                }
                            />
                        </Box>
                    )}
                </Box>
            );
        }
        default:
            throw exhaustive(item);
    }
}
