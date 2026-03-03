import {isFocusVisible} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {ReactNode, RefObject, cloneElement, isValidElement, useMemo, useRef, useState} from "react";
import {AriaListBoxOptions, useListBox, useOption} from "react-aria";
import {ComboBoxState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {
    colorSchemeVars,
    fontSizes,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {TaskCollectionComboBoxCreateCollectionOption} from "~/client/web/tasks/internal/task_collection_combo_box_create_collection_option.js";
import {TaskCollectionComboBoxInstructionalPlaceholder} from "~/client/web/tasks/internal/task_collection_combo_box_instructional_placeholder.js";
import {
    TaskCollectionComboBoxCreateCollectionItem,
    TaskCollectionComboBoxItem,
} from "~/client/web/tasks/internal/task_collection_combo_box_item.js";
import {taskCollectionOptionSecondaryTextColor} from "~/client/web/tasks/internal/task_collection_option.js";
import {addRemLengths, spacing} from "~/shared/design/core/spacing.js";

export function TaskCollectionComboBoxListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: originalListBoxProps,
    pendingKey = null,
    autoFocus,
    shouldHideNoResultsIcon,
}: {
    comboBoxState: ComboBoxState<TaskCollectionComboBoxItem>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<TaskCollectionComboBoxItem>;
    pendingKey?: TaskCollectionComboBoxItem["key"] | null;
    autoFocus?: boolean;
    shouldHideNoResultsIcon?: boolean;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox(
        {
            ...originalListBoxProps,
            autoFocus: autoFocus ?? originalListBoxProps.autoFocus,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        comboBoxState,
        listBoxRef,
    );

    const {itemsWithoutCreateCollectionButton, createCollectionButtonItem} = useMemo(() => {
        const itemsWithoutCreateCollectionButton: Array<ReactNode> = [];
        let createCollectionButtonItem: Node<TaskCollectionComboBoxCreateCollectionItem> | null =
            null;

        for (const item of comboBoxState.collection) {
            if (item.value!.type === "CreateCollection") {
                createCollectionButtonItem =
                    item as Node<TaskCollectionComboBoxCreateCollectionItem>;
            } else {
                itemsWithoutCreateCollectionButton.push(
                    <TaskCollectionComboBoxListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        pendingKey={pendingKey}
                    />,
                );
            }
        }

        return {itemsWithoutCreateCollectionButton, createCollectionButtonItem};
    }, [comboBoxState, pendingKey]);

    // If there are 0 items then we're in a loading state. If there's 1 item (the
    // create button) then we either have no search results (input value is non-empty)
    // or we should render our instructional placeholder as the empty state.
    const shouldShowInstructionalPlaceholder =
        comboBoxState.collection.size > 0 &&
        createCollectionButtonItem &&
        // NOTE(calebmer): We need to use `isInputValueEmpty` from items since when
        // react-aria closes a combobox overlay it renders the old set of items. If we use
        // `comboBoxState.inputValue` with the old items of an empty search result then
        // we'll flash the instructional placeholder.
        createCollectionButtonItem.value!.isInputValueEmpty &&
        itemsWithoutCreateCollectionButton.length === 0;

    return (
        <Box flexGrow="1" overflow="hidden" display="flex" flexDirection="column">
            <div
                // `useScrollbar()` is on a `<div>` wrapping the `<ul>` so `useScrollbar()` doesn't
                // need to add a resize listener to every child. This means we need to provide
                // `useListBox()` a `scrollRef` if we want to scroll to the focused option.
                ref={useMergedRefs(scrollRef, useScrollbar())}
                className={sprinkles({
                    position: "relative",
                    flexGrow: "1",
                    padding: "1",
                    overflowX: "hidden",
                    overflowY: "auto",
                    display: shouldShowInstructionalPlaceholder ? "none" : undefined,
                })}
            >
                <ul {...listBoxProps} ref={listBoxRef}>
                    {comboBoxState.collection.size === 0 ? (
                        <Box
                            padding="1.5"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            style={{
                                height: addRemLengths(
                                    "1.5",
                                    fontSizes["75"].lineHeight,
                                    fontSizes["50"].lineHeight,
                                    "1.5",
                                ),
                            }}
                        >
                            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                        </Box>
                    ) : itemsWithoutCreateCollectionButton.length === 0 ? (
                        // Mimic the structure of a `<TaskCollectionOption>`
                        <Box padding="1.5" display="flex" alignItems="flex-start" gap="1.5">
                            <Box
                                flexShrink="0"
                                height="4"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                            >
                                <Box
                                    width="3"
                                    height="3"
                                    color={taskCollectionOptionSecondaryTextColor}
                                >
                                    {!shouldHideNoResultsIcon && (
                                        <MagnifyingGlass size={spacing["3"]} />
                                    )}
                                </Box>
                            </Box>
                            <Box>
                                <Box
                                    fontStyle="truncate"
                                    color={taskCollectionOptionSecondaryTextColor}
                                >
                                    No results
                                </Box>
                                <Box style={{height: fontSizes["50"].lineHeight}}></Box>
                            </Box>
                        </Box>
                    ) : (
                        itemsWithoutCreateCollectionButton
                    )}
                </ul>
            </div>
            {shouldShowInstructionalPlaceholder ? (
                <TaskCollectionComboBoxInstructionalPlaceholder
                    createCollectionButton={
                        <TaskCollectionComboBoxCreateCollectionOption
                            comboBoxState={comboBoxState}
                            item={createCollectionButtonItem}
                            isQuiet={false}
                            isPending={createCollectionButtonItem.key === pendingKey}
                        />
                    }
                />
            ) : (
                createCollectionButtonItem && (
                    <Box
                        padding="1"
                        style={{boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-5-translucent"]}`}}
                    >
                        <TaskCollectionComboBoxCreateCollectionOption
                            comboBoxState={comboBoxState}
                            item={createCollectionButtonItem}
                            isQuiet={true}
                            isPending={createCollectionButtonItem.key === pendingKey}
                        />
                    </Box>
                )
            )}
        </Box>
    );
}

function TaskCollectionComboBoxListBoxOption({
    comboBoxState,
    item,
    pendingKey,
}: {
    comboBoxState: ComboBoxState<TaskCollectionComboBoxItem>;
    item: Node<TaskCollectionComboBoxItem>;
    pendingKey: TaskCollectionComboBoxItem["key"] | null;
}) {
    const optionRef = useRef(null);
    const {optionProps, isFocused, isPressed, isHovered} = useOption(
        {
            key: item.key,
            // By default `@react-aria/listbox` allows you to press on the combobox trigger
            // then drag up and release to select an item. This is not a common interaction and
            // not something we want to support (our `<MenuButton>` doesn't support this).
            // Furthermore, on mobile it means if you press an option in a combobox then scroll
            // and release that option will be selected! Instead the scroll should cancel the
            // press. We really want to disable that behavior since it feels broken.
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
                {useMemo(
                    () =>
                        isValidElement(item.rendered)
                            ? cloneElement(item.rendered, {
                                  isPending: item.key === pendingKey,
                              } as any)
                            : item.rendered,
                    [item.key, item.rendered, pendingKey],
                )}
            </li>
        </FocusRing>
    );
}
