import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import {Check, MagnifyingGlass} from "phosphor-react";
import {RefObject, cloneElement, isValidElement, useRef, useState} from "react";
import {AriaListBoxOptions, useListBox, useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {getTaskPriorityName} from "~/client/web/tasks/get_task_priority_name.js";
import {TaskPriorityInputItem} from "~/client/web/tasks/internal/task_priority_input.js";
import {TaskPriorityIcon} from "~/client/web/tasks/task_priority_icon.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function TaskPriorityInputListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskPriorityInputItem>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<TaskPriorityInputItem>;
    selectedKey: TaskPriorityInputItem["key"];
}) {
    const platform = usePlatform();

    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox(
        {
            ..._listBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        comboBoxState,
        listBoxRef,
    );

    return (
        <div
            // `useScrollbar()` is on a `<div>` wrapping the `<ul>` so `useScrollbar()`
            // doesn't need to add a resize listener to every child. This means we need to
            // provide `useListBox()` a `scrollRef` if we want to scroll to the
            // focused option.
            ref={useMergedRefs(useScrollbar(), scrollRef)}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    position: "relative",
                    borderRadius: "1.5",
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
                maxHeight: platform === "mobile" ? "10rem" : spacing["64"],
            }}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
                {comboBoxState.collection.size === 0 ? (
                    <Box padding="1.5" display="flex" alignItems="center" gap="1.5" color="grey-70">
                        <Box padding="0.5">
                            <MagnifyingGlass size={spacing["4"]} />
                        </Box>
                        <Box>No results</Box>
                    </Box>
                ) : (
                    Array.from(comboBoxState.collection, item => (
                        <TaskPriorityInputListBoxOption
                            key={item.key}
                            comboBoxState={comboBoxState}
                            item={item}
                            selectedKey={selectedKey}
                        />
                    ))
                )}
            </ul>
        </div>
    );
}

function TaskPriorityInputListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<TaskPriorityInputItem>;
    item: Node<TaskPriorityInputItem>;
    selectedKey: TaskPriorityInputItem["key"];
}) {
    const optionRef = useRef<HTMLLIElement>(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // By default `@react-aria/listbox` allows you to press on the combobox trigger
            // then drag up and release to select an item. This is not a common interaction
            // and not something we want to support (our `<MenuButton>` doesn't support
            // this). Furthermore, on mobile it means if you press an option in a combobox
            // then scroll and release that option will be selected! Instead the scroll
            // should cancel the press. We really want to disable that behavior since it
            // feels broken.
            disallowsDifferentPressOrigin: true,
        },
        comboBoxState,
        // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
        // the ref correctly but the type is wrong after upgrading to React v19.
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

    assert(isValidElement(item.rendered));

    return (
        <FocusRing offset="inset" isVisible={isFocused && wasFocusVisibleWhenFocused}>
            <li
                {...optionProps}
                ref={optionRef}
                className={sprinkles({
                    width: "full",
                    padding: "1.5",
                    borderRadius: "1",
                    color: "grey-100",
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

export function TaskPriorityInputListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: TaskPriorityInputItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" || typeof isPressed === "boolean",
        "Expected to be rendered by <TaskPriorityInputListBoxOption> which provides extra props",
    );

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <TaskPriorityIcon
                size="4"
                priority={item.key === "Null" ? null : item.key}
                shouldHighlightUrgent={false}
            />
            <Box flexGrow="1" fontStyle="truncate">
                {getTaskPriorityName(item.key)}
            </Box>
            {isSelected && (
                <Box flexShrink="0" marginLeft="2">
                    <Check
                        size={spacing["3"]}
                        color={isPressed ? colorSchemeVars["grey-100"] : colorSchemeVars["grey-70"]}
                    />
                </Box>
            )}
        </Box>
    );
}
