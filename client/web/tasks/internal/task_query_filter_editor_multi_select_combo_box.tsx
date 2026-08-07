import {isFocusVisible, setInteractionModality, usePress} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {Memo, ReactNode, Ref, RefObject, useCallback, useMemo, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, Item, ListState, useListState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {CheckboxIcon} from "~/client/web/design/checkbox_icon.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/web/design/overlay_trigger_button.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, spinAnimationClassName, sprinkles} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";

export type TaskQueryFilterEditorMultiSelectComboBoxItemBase = {
    readonly key: string;
    readonly textValue: string;
    readonly node: ReactNode;
};

export function TaskQueryFilterEditorMultiSelectComboBox<
    Item extends TaskQueryFilterEditorMultiSelectComboBoxItemBase,
>({
    inputLabel,
    triggerButtonRef,
    preview,
    selectedKeys,
    onSelectedKeysChange,
    useSearchedItems,
    optionCheckboxMarginTop,
}: {
    inputLabel: string;
    triggerButtonRef?: Ref<OverlayTriggerButtonRef> | null;
    preview: ReactNode;
    selectedKeys: ReadonlySet<Item["key"]>;
    onSelectedKeysChange: (
        selectedKeys: ReadonlySet<Item["key"]>,
        searchedItems: ReadonlyArray<Item>,
    ) => void;
    useSearchedItems: (searchInputValue: string) =>
        | {
              isLoading: false;
              shouldShowSearchLoadingIndicator?: boolean;
              searchedItems: ReadonlyArray<Item>;
          }
        | {isLoading: true};
    optionCheckboxMarginTop?: Spacing;
}) {
    const platform = usePlatform();

    const {pressProps, isPressed} = usePress({preventFocusOnPress: true});
    const {hoverProps, isHovered} = useHover({});

    return (
        <OverlayTriggerButton
            ref={triggerButtonRef}
            aria-haspopup="listbox"
            placement="bottom-start"
            // Allow flipping vertically but not horizontally on mobile. Flipping horizontally
            // on mobile can happen easily and be disruptive.
            fallbackPlacements={platform === "mobile" ? ["top-start"] : undefined}
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    className={greyElevated2ClassName}
                    width="64"
                    maxHeight={platform === "mobile" ? "64" : "96"}
                    overflow="hidden"
                    borderRadius="1.5"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <TaskQueryFilterEditorMultiSelectComboBoxOverlay
                        inputLabel={inputLabel}
                        selectedKeys={selectedKeys}
                        onSelectedKeysChange={onSelectedKeysChange}
                        useSearchedItems={useSearchedItems}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                        optionCheckboxMarginTop={optionCheckboxMarginTop ?? null}
                    />
                </Box>
            )}
        >
            {({isVisible}) => (
                <FocusRing offset="0">
                    <button
                        {...mergeProps(pressProps, hoverProps)}
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
                        <span
                            className={sprinkles({
                                height: "full",
                                minWidth: "4",
                                paddingX: "1",
                                display: "flex",
                                alignItems: "center",
                                // The hit radius for this button extends within the entire filter editor but the
                                // background color style has some inset.
                                backgroundColor: isPressed
                                    ? "grey-10"
                                    : isHovered || isVisible
                                      ? "grey-5"
                                      : undefined,
                                borderRadius: "0.5",
                            })}
                        >
                            {preview}
                        </span>
                    </button>
                </FocusRing>
            )}
        </OverlayTriggerButton>
    );
}

function TaskQueryFilterEditorMultiSelectComboBoxOverlay<
    Item extends TaskQueryFilterEditorMultiSelectComboBoxItemBase,
>({
    inputLabel,
    selectedKeys,
    onSelectedKeysChange,
    useSearchedItems,
    onCloseWithoutAnimation,
    optionCheckboxMarginTop,
}: {
    inputLabel: string;
    selectedKeys: ReadonlySet<Item["key"]>;
    onSelectedKeysChange: (
        selectedKeys: ReadonlySet<Item["key"]>,
        searchedItems: ReadonlyArray<Item>,
    ) => void;
    useSearchedItems: (searchInputValue: string) =>
        | {
              isLoading: false;
              shouldShowSearchLoadingIndicator?: boolean;
              searchedItems: ReadonlyArray<Item>;
          }
        | {isLoading: true};
    onCloseWithoutAnimation: () => void;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const [inputValue, setInputValue] = useState("");

    // eslint-disable-next-line react-compiler/react-compiler
    const searchedItemsResult = useSearchedItems(inputValue);
    const searchedItems = searchedItemsResult.isLoading
        ? emptyArray
        : searchedItemsResult.searchedItems;

    const shouldShowSearchLoadingIndicator =
        !searchedItemsResult.isLoading && !!searchedItemsResult.shouldShowSearchLoadingIndicator;

    const renderItem = useCallback((item: TaskQueryFilterEditorMultiSelectComboBoxItemBase) => {
        return <Item textValue={item.textValue}>{item.node}</Item>;
    }, []);

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedItems,
        children: renderItem,

        selectionMode: "multiple",
        selectedKeys,
        onSelectionChange: useEvent(selectedKeys => {
            // Ignore "all" selections. Doesn't make sense for this input.
            if (selectedKeys === "all") return;

            onSelectedKeysChange(selectedKeys as Set<Item["key"]>, searchedItems);
        }),
    });

    // Memoized list state object we can use to avoid re-renders if list doesn't
    // change.
    const listState = useMemo(
        (): ListState<TaskQueryFilterEditorMultiSelectComboBoxItemBase> => ({
            collection,
            disabledKeys,
            selectionManager,
        }),
        [collection, disabledKeys, selectionManager],
    );

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItemBase> = {
        inputValue,
        setInputValue,

        commit: () => {
            selectionManager.select(selectionManager.focusedKey);
        },
        revert: () => {
            setInputValue("");
            onCloseWithoutAnimation();
        },

        // Always open
        isOpen: true,
        setOpen: noop,
        open: noop,
        close: noop,
        toggle: noop,
        focusStrategy: "first",

        isFocused: selectionManager.isFocused,
        setFocused: isFocused => selectionManager.setFocused(isFocused),

        // We use multiple selection, there is never one selected key.
        selectedKey: null as any,
        selectedItem: null as any,
        setSelectedKey: key => selectionManager.select(key!),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": inputLabel,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: searchedItems,
            onKeyDown: event => {
                switch (event.key) {
                    case "ArrowDown":
                    case "ArrowUp":
                    case "Home":
                    case "End": {
                        setInteractionModality("keyboard");
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    return (
        <>
            <Box position="relative">
                <Box position="absolute" top="3" left="2.5" pointerEvents="none" color="grey-70">
                    <MagnifyingGlass size={spacing["3"]} />
                </Box>
                <FocusRing offset="border" isDisabled={!!selectionManager.focusedKey}>
                    <input
                        {...inputProps}
                        ref={inputRef}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "block",
                            width: "full",
                            height: "9",
                            paddingLeft: "7",
                            paddingRight: shouldShowSearchLoadingIndicator ? "7" : "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "1.5",
                            borderBottomRadius: "none",
                            borderBottom: "grey-5",
                        })}
                        placeholder={inputLabel}
                        // Allow iOS and MacOS autocorrect and spell checking. By default `react-aria`
                        // disables these capabilities because the user has combobox suggestions. However,
                        // fixing typos at the OS level when typos are common (like on iOS) is really
                        // useful.
                        autoCorrect={undefined}
                        spellCheck={undefined}
                        onKeyDown={event => {
                            // Don't handle a tab keypress with `react-aria`. Instead let our
                            // `<OverlayTriggerButton>` handle it.
                            if (event.key === "Tab") return;

                            if (
                                event.key === "Enter" &&
                                comboBoxState.selectionManager.focusedKey == null
                            ) {
                                // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                // option isn't focused this just closes the combobox and leaves the user confused.
                                // Is what they typed the new value or not? It's not, you can tell since the avatar
                                // doesn't change. This is particularly confusing on mobile where the user may hit
                                // the return key expecting the first value in the menu to be selected. But that
                                // won't happen, the menu will just close.
                                //
                                // So intercept this case and don't call into `@react-aria/combobox`.
                                //
                                // [1]:
                                //     https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132
                            } else {
                                inputProps.onKeyDown?.(event);
                            }
                        }}
                    />
                </FocusRing>
                {shouldShowSearchLoadingIndicator && (
                    <Box position="absolute" top="2.5" right="2.5" pointerEvents="none">
                        <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                    </Box>
                )}
            </Box>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                {searchedItemsResult.isLoading ? (
                    <Box paddingY="7" display="flex" justifyContent="center">
                        <SpinnerGap
                            className={spinAnimationClassName}
                            color={colorSchemeVars["grey-70"]}
                            size={spacing["4"]}
                        />
                    </Box>
                ) : (
                    <TaskQueryFilterEditorMultiSelectListBox
                        listState={listState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                        optionCheckboxMarginTop={optionCheckboxMarginTop}
                    />
                )}
            </Box>
        </>
    );
}

function TaskQueryFilterEditorMultiSelectListBox({
    listState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    optionCheckboxMarginTop,
}: {
    listState: Memo<ListState<TaskQueryFilterEditorMultiSelectComboBoxItemBase>>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const {listBoxProps} = useListBox(
        {
            ..._listBoxProps,
            autoFocus: false,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            scrollRef,
        },
        listState,
        listBoxRef,
    );

    return (
        <div
            // `useScrollbar()` is on a `<div>` wrapping the `<ul>` so `useScrollbar()` doesn't
            // need to add a resize listener to every child. This means we need to provide
            // `useListBox()` a `scrollRef` if we want to scroll to the focused option.
            ref={useMergedRefs(useScrollbar(), scrollRef)}
            className={sprinkles({
                position: "relative",
                flexGrow: "1",
                padding: "1",
                overflowX: "hidden",
                overflowY: "auto",
            })}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
                {useMemo(() => {
                    // The list of collection items shouldn't need to re-render whenever the combobox
                    // opens, closes, or animates. Hence the `useMemo()`.
                    return listState.collection.size === 0 ? (
                        <Box
                            padding="1.5"
                            display="flex"
                            alignItems="center"
                            gap="1.5"
                            color="grey-70"
                        >
                            No results
                        </Box>
                    ) : (
                        Array.from(listState.collection, item => (
                            <TaskQueryFilterEditorMultiSelectListBoxOption
                                key={item.key}
                                listState={listState}
                                item={item}
                                optionCheckboxMarginTop={optionCheckboxMarginTop}
                            />
                        ))
                    );
                }, [listState, optionCheckboxMarginTop])}
            </ul>
        </div>
    );
}

function TaskQueryFilterEditorMultiSelectListBoxOption({
    listState,
    item,
    optionCheckboxMarginTop,
}: {
    listState: Memo<ListState<TaskQueryFilterEditorMultiSelectComboBoxItemBase>>;
    item: Node<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const optionRef = useRef(null);
    const {optionProps, isFocused, isPressed, isSelected, isHovered} = useOption(
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
        listState,
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
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "1.5",
                })}
            >
                <Box
                    alignSelf={optionCheckboxMarginTop === null ? "stretch" : undefined}
                    paddingTop={
                        optionCheckboxMarginTop !== null ? optionCheckboxMarginTop : undefined
                    }
                    display="flex"
                    alignItems="center"
                >
                    <CheckboxIcon isChecked={isSelected} />
                </Box>
                {item.rendered}
            </li>
        </FocusRing>
    );
}
