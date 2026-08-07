import {isFocusVisible, setInteractionModality} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import _Fuse from "fuse.js";
import {Check, MagnifyingGlass} from "phosphor-react";
import {Memo, RefObject, useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, Item, ListState, useListState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useOutsideInteraction} from "~/client/web/design/helpers/use_outside_interaction.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    ContentCodeBlockLanguage,
    contentCodeBlockLanguages,
} from "~/shared/content/code/content_code_block_language.js";
import {ContentCodeBlockLanguageId} from "~/shared/content/content_code_block_language_id.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export function ContentEditorCodeBlockLanguagePickerComboBox({
    targetElement,
    isVisible,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
    selectedLanguageId,
    onSelectedLanguageChange,
}: {
    targetElement: HTMLElement;
    isVisible: boolean;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
    selectedLanguageId: ContentCodeBlockLanguageId;
    onSelectedLanguageChange: (languageId: ContentCodeBlockLanguageId) => void;
}) {
    const platform = usePlatform();

    return (
        <OverlayAnimated
            // The overlay blocks interaction with everything outside the overlay. We still
            // want to render the overlay in our current overlay scope so that it animates
            // smoothly with scroll animations (important on mobile when we need to avoid the
            // keyboard).
            isBlocking={true}
            withoutRootBlockingScope={true}
            isVisible={isVisible}
            disableAnimationIn={true}
            onActuallyVisibleChange={isActuallyVisible => {
                if (!isActuallyVisible) onCloseWithoutAnimation();
            }}
            offset={defaultTooltipOffset}
            placement="bottom-end"
            // Allow flipping vertically but not horizontally. Should always be rendered inside
            // the code block.
            fallbackPlacements={["top-end"]}
            // Set a constant `overflowBottom` value instead of relying on the current keyboard
            // height (which will be updated asynchronously after `isEditing` is true). This
            // stops the overlay placement from jumping around while the keyboard opens. The
            // value was calculated based on the keyboard height in iOS. We may need to change
            // this constant if the keyboard height for iOS changes or the Android keyboard
            // height is bigger.
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            targetElement={targetElement}
            overlay={
                <Box
                    ref={useOutsideInteraction(onCloseWithAnimation)}
                    className={greyElevated2ClassName}
                    width="48"
                    maxHeight={platform === "mobile" ? "32" : "96"}
                    overflow="hidden"
                    borderRadius="1.5"
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    display="flex"
                    flexDirection="column"
                >
                    <ContentEditorCodeBlockLanguagePickerComboBoxOverlay
                        selectedLanguageId={selectedLanguageId}
                        onSelectedLanguageChange={onSelectedLanguageChange}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                </Box>
            }
        />
    );
}

function ContentEditorCodeBlockLanguagePickerComboBoxOverlay({
    selectedLanguageId,
    onSelectedLanguageChange,
    onCloseWithoutAnimation,
}: {
    selectedLanguageId: ContentCodeBlockLanguageId;
    onSelectedLanguageChange: (languageId: ContentCodeBlockLanguageId) => void;
    onCloseWithoutAnimation: () => void;
}) {
    const [inputValue, setInputValue] = useState("");

    const languagesSearchIndex = useMemo(
        () =>
            new Fuse(contentCodeBlockLanguages, {
                // Reduce churn while typing by requiring better matches in search.
                threshold: 0.4,
                keys: ["name", "aliases"],
            }),
        [],
    );

    const searchedLanguages = useMemo(() => {
        return inputValue === ""
            ? contentCodeBlockLanguages
            : languagesSearchIndex.search(inputValue).map(({item}) => item);
    }, [inputValue, languagesSearchIndex]);

    const renderItem = useCallback((language: ContentCodeBlockLanguage) => {
        return <Item key={language.id}>{language.name}</Item>;
    }, []);

    const {collection, selectionManager, disabledKeys} = useListState({
        items: searchedLanguages,
        children: renderItem,

        selectedKeys: useMemo(() => [selectedLanguageId], [selectedLanguageId]),
        selectionMode: "single",
        onSelectionChange: selectedKeys => {
            if (selectedKeys === "all") return;

            const selectedKey = iterableFirst(selectedKeys);
            if (!selectedKey) return;

            onSelectedLanguageChange(selectedKey as ContentCodeBlockLanguageId);
            onCloseWithoutAnimation();
        },
    });

    // Memoized list state object we can use to avoid re-renders if list doesn't
    // change.
    const listState = useMemo(
        (): ListState<ContentCodeBlockLanguage> => ({
            collection,
            disabledKeys,
            selectionManager,
        }),
        [collection, disabledKeys, selectionManager],
    );

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const comboBoxState: ComboBoxState<ContentCodeBlockLanguage> = {
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
        selectedKey: selectedLanguageId,
        selectedItem: collection.getItem(selectedLanguageId) as Node<ContentCodeBlockLanguage>,
        setSelectedKey: key => selectionManager.select(key!),

        collection,
        selectionManager,
        disabledKeys,
    };

    const {inputProps, listBoxProps} = useComboBox(
        {
            "aria-label": "Language",
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
            items: searchedLanguages,
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

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        assertExists(inputRef.current).focus();
    }, []);

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
                            paddingRight: "2.5",
                            backgroundColor: "transparent",
                            borderTopRadius: "1.5",
                            borderBottomRadius: "none",
                        })}
                        style={{boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5-translucent"]}`}}
                        placeholder="Language"
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
            </Box>
            <Box
                ref={popoverRef}
                flexGrow="1"
                overflow="hidden"
                display="flex"
                flexDirection="column"
            >
                <ContentEditorCodeBlockLanguagePickerListBox
                    listState={listState}
                    listBoxRef={listBoxRef}
                    listBoxProps={listBoxProps}
                />
            </Box>
        </>
    );
}

function ContentEditorCodeBlockLanguagePickerListBox({
    listState,
    listBoxRef,
    listBoxProps: _listBoxProps,
}: {
    listState: Memo<ListState<ContentCodeBlockLanguage>>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<ContentCodeBlockLanguage>;
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
                            <ContentEditorCodeBlockLanguagePickerListBoxOption
                                key={item.key}
                                listState={listState}
                                item={item}
                            />
                        ))
                    );
                }, [listState])}
            </ul>
        </div>
    );
}

function ContentEditorCodeBlockLanguagePickerListBoxOption({
    listState,
    item,
}: {
    listState: Memo<ListState<ContentCodeBlockLanguage>>;
    item: Node<ContentCodeBlockLanguage>;
}) {
    const optionRef = useRef<HTMLLIElement>(null);
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
                <Box flexGrow="1">{item.rendered}</Box>
                {isSelected && (
                    <Box flexShrink="0">
                        <Check
                            size={spacing["3"]}
                            color={
                                isPressed ? colorSchemeVars["grey-100"] : colorSchemeVars["grey-80"]
                            }
                        />
                    </Box>
                )}
            </li>
        </FocusRing>
    );
}
