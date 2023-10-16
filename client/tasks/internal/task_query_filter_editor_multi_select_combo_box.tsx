import {isFocusVisible, usePress} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {ReactNode, RefObject, useRef, useState} from "react";
import {
    AriaListBoxOptions,
    mergeProps,
    useComboBox,
    useHover,
    useListBox,
    useOption,
} from "react-aria";
import {ComboBoxState, Item, useListState} from "react-stately";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {TaskCheckbox} from "~/client/tasks/internal/task_checkbox.js";
import {Spacing, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {
    colorSchemeVars,
    greyElevated2ClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/shared/styles/styles.js";

export type TaskQueryFilterEditorMultiSelectComboBoxItemBase = {
    readonly key: string;
    readonly textValue: string;
    readonly node: ReactNode;
};

export function TaskQueryFilterEditorMultiSelectComboBox<
    Item extends TaskQueryFilterEditorMultiSelectComboBoxItemBase,
>({
    inputLabel,
    preview,
    selectedKeys,
    onSelectedKeysChange,
    useSearchedItems,
    optionCheckboxMarginTop,
}: {
    inputLabel: string;
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
    const {pressProps, isPressed} = usePress({});
    const {hoverProps, isHovered} = useHover({});

    return (
        <OverlayTriggerButton
            aria-haspopup="listbox"
            overlay={({onCloseWithoutAnimation}) => (
                <Box
                    className={greyElevated2ClassName}
                    width="64"
                    maxHeight="96"
                    overflow="hidden"
                    borderRadius="md"
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
            <FocusRing offset="0">
                <button
                    {...mergeProps(pressProps, hoverProps)}
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
                        {preview}
                    </span>
                </button>
            </FocusRing>
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

    const searchedItemsResult = useSearchedItems(inputValue);
    const searchedItems = searchedItemsResult.isLoading
        ? emptyArray
        : searchedItemsResult.searchedItems;

    const shouldShowSearchLoadingIndicator =
        !searchedItemsResult.isLoading && !!searchedItemsResult.shouldShowSearchLoadingIndicator;

    const renderItem = (item: TaskQueryFilterEditorMultiSelectComboBoxItemBase) => (
        <Item textValue={item.textValue}>{item.node}</Item>
    );

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedItems,
        children: renderItem,

        selectionMode: "multiple",
        selectedKeys,
        onSelectionChange: selectedKeys => {
            // Ignore "all" selections. Doesn't make sense for this input.
            if (selectedKeys === "all") return;

            onSelectedKeysChange(selectedKeys as Set<Item["key"]>, searchedItems);
        },
    });

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
            inputRef,
            popoverRef,
            listBoxRef,
            autoFocus: false,
            shouldFocusWrap: false,
            items: searchedItems,
        },
        comboBoxState,
    );

    return (
        <>
            <Box position="relative">
                <Box position="absolute" top="2.5" left="2.5" pointerEvents="none" color="grey-70">
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
                            height: "8",
                            paddingLeft: "7",
                            paddingRight: shouldShowSearchLoadingIndicator ? "7" : "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "md",
                            borderBottom: "grey-10",
                        })}
                        placeholder={inputLabel}
                        onKeyDown={event => {
                            // Don't handle a tab keypress with `react-aria`. Instead let our
                            // `<OverlayTriggerButton>` handle it.
                            if (event.key === "Tab") return;

                            inputProps.onKeyDown?.(event);
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
                        comboBoxState={comboBoxState}
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
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    optionCheckboxMarginTop,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    listBoxRef: RefObject<HTMLUListElement>;
    listBoxProps: AriaListBoxOptions<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const {listBoxProps} = useListBox(
        {..._listBoxProps, autoFocus: false},
        comboBoxState,
        listBoxRef,
    );

    return (
        <ul
            {...listBoxProps}
            ref={useMergedRefs(listBoxRef, useScrollbar())}
            className={sprinkles({
                position: "relative",
                flexGrow: "1",
                padding: "1",
                overflowX: "hidden",
                overflowY: "auto",
            })}
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
                    <TaskQueryFilterEditorMultiSelectListBoxOption
                        key={item.key}
                        comboBoxState={comboBoxState}
                        item={item}
                        optionCheckboxMarginTop={optionCheckboxMarginTop}
                    />
                ))
            )}
        </ul>
    );
}

function TaskQueryFilterEditorMultiSelectListBoxOption({
    comboBoxState,
    item,
    optionCheckboxMarginTop,
}: {
    comboBoxState: ComboBoxState<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    item: Node<TaskQueryFilterEditorMultiSelectComboBoxItemBase>;
    optionCheckboxMarginTop: Spacing | null;
}) {
    const optionRef = useRef(null);
    const {isHovered, hoverProps} = useHover({});
    const {optionProps, isFocused, isPressed, isSelected} = useOption(
        {key: item.key},
        comboBoxState,
        optionRef,
    );

    const [wasFocusVisibleWhenFocused, setWasFocusVisibleWhenFocused] = useState(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (isFocused) setWasFocusVisibleWhenFocused(isFocusVisible());
    }, [isFocused]);

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
                    <TaskCheckbox isChecked={isSelected} />
                </Box>
                {item.rendered}
            </li>
        </FocusRing>
    );
}
