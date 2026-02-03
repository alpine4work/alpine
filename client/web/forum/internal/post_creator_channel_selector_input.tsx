import {
    getInteractionModality,
    isFocusVisible,
    setInteractionModality,
} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import {CaretDown, Check, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {
    MutableRefObject,
    Ref,
    RefObject,
    cloneElement,
    forwardRef,
    isValidElement,
    useCallback,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useIdlyPreloadRpc, useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    colorSchemeVars,
    fontSizes,
    pointerEventsNoneNotInheritedClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {filterMapIterable} from "~/shared/helpers/iterable/filter_map_iterable.js";
import {ChannelId} from "~/shared/id/types/id_types.js";
import {
    searchChannelsByAffinity,
    searchChannelsByKeywords,
} from "~/shared/rpc/search_rpc_definitions.js";

/**
 * Limit of search results we'll fetch on the client. We don't lazy load more
 * when the user scrolls, instead the user needs to narrow their search.
 *
 * This is enough to give the user some choice while they scroll while not
 * using too many resources.
 */
const channelSelectorSearchEntityLimit = 20;

type PostCreatorChannelSelectorInputState =
    | {
          readonly type: "Selection";
          readonly disableAnimationOut: boolean;
          readonly shouldBlurRef: MutableRefObject<boolean>;
      }
    | {
          readonly type: "Typing";
          readonly value: string;
          readonly hasChanged: boolean;
          readonly disableAnimationOut: boolean;
          readonly shouldSelectRef: MutableRefObject<boolean>;
      };

type PostCreatorChannelSelectorItem = {
    readonly key: ChannelId;
    readonly channel: ChannelPreviewModel;
    readonly descriptionTextSnippet: string;
};

let isClosingComboBox = false;

export type PostCreatorChannelSelectorInputRef = {
    focus(): void;
};

const PostCreatorChannelSelectorInputForwardRef = forwardRef(PostCreatorChannelSelectorInput);
export {PostCreatorChannelSelectorInputForwardRef as PostCreatorChannelSelectorInput};

function PostCreatorChannelSelectorInput(
    {
        channel,
        onChannelChange,
        width = "48",
    }: {
        channel: ChannelPreviewModel | null;
        onChannelChange: (channel: ChannelPreviewModel | null) => void;
        width?: "48" | "full";
    },
    ref: Ref<PostCreatorChannelSelectorInputRef>,
) {
    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();

    const inputRef = useRef<HTMLInputElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => assertExists(inputRef.current).focus(),
        }),
        [],
    );

    const [shouldLoadItems, setShouldLoadItems] = useState(false);

    const [inputState, setInputState] = useState<PostCreatorChannelSelectorInputState>({
        type: "Selection",
        disableAnimationOut: false,
        shouldBlurRef: {current: false},
    });

    useLayoutEffectWithoutServerSideWarning(() => {
        if (inputState.type === "Selection" && inputState.shouldBlurRef.current) {
            inputState.shouldBlurRef.current = false;
            assertExists(inputRef.current).blur();
        }

        if (inputState.type === "Typing" && inputState.shouldSelectRef.current) {
            inputState.shouldSelectRef.current = false;
            assertExists(inputRef.current).select();
        }
    }, [inputState]);

    const selectionInputValue = channel?.name ?? "";
    const inputValue = inputState.type === "Selection" ? selectionInputValue : inputState.value;
    const trimmedInputValue = inputValue.trim();

    useIdlyPreloadRpc(searchChannelsByAffinity, {
        spaceId: space.id,
        limit: channelSelectorSearchEntityLimit,
    });

    const {output: searchByAffinityOutput} = useLazyLoadRpc(
        searchChannelsByAffinity,
        shouldLoadItems ? {spaceId: space.id, limit: channelSelectorSearchEntityLimit} : null,
    );

    const [currentlyLoadingInputValue, setCurrentlyLoadingInputValue] =
        useState<string>(trimmedInputValue);

    const {isLoading: originalIsSearchLoading, output: searchByKeywordsOutput} = useLazyLoadRpc(
        searchChannelsByKeywords,
        shouldLoadItems &&
            inputState.type === "Typing" &&
            inputState.hasChanged &&
            currentlyLoadingInputValue.length > 0
            ? {
                  spaceId: space.id,
                  limit: channelSelectorSearchEntityLimit,
                  queryText: currentlyLoadingInputValue,
              }
            : null,
        {keepPreviousData: true},
    );

    let isSearchLoading = originalIsSearchLoading;

    // Throttle our RPC call. Only load search results for a new input value after
    // we're done loading search results for the old one.
    if (!isSearchLoading && currentlyLoadingInputValue !== trimmedInputValue) {
        isSearchLoading = true;
        setCurrentlyLoadingInputValue(trimmedInputValue);
    }

    const shouldShowSearchLoadingIndicator = useDelayLoadingIndicator(isSearchLoading);

    const items: ReadonlyArray<PostCreatorChannelSelectorItem> | null = useMemo(() => {
        if (!searchByKeywordsOutput) {
            if (!searchByAffinityOutput) {
                return null;
            } else {
                return filterMapArray(searchByAffinityOutput.results, result => {
                    // Only show channels here that we're allowed to post in. Even if we're allowed
                    // to view the channel.
                    if (
                        !hasAccessLevel(
                            getAccountAccessLevelAssumingSpaceAccess(
                                result.accessPolicy,
                                currentAccount?.id,
                            ),
                            "Edit",
                        )
                    ) {
                        return;
                    }

                    return {
                        key: result.channel.id,
                        ...result,
                    };
                });
            }
        } else {
            const channelIdsFromSearchByAffinity = searchByAffinityOutput
                ? new Set(
                      filterMapIterable(searchByAffinityOutput.results, result => {
                          if (result.origin !== "Account") return;

                          // Only show channels here that we're allowed to post in. Even if we're allowed
                          // to view the channel.
                          if (
                              !hasAccessLevel(
                                  getAccountAccessLevelAssumingSpaceAccess(
                                      result.accessPolicy,
                                      currentAccount?.id,
                                  ),
                                  "Edit",
                              )
                          ) {
                              return;
                          }

                          return result.channel.id;
                      }),
                  )
                : null;

            // Re-sort results so that if any keyword results were also in our affinity
            // search then we put the affinity search results at the top.
            const results = filterMapArray(searchByKeywordsOutput.results, result => {
                // Only show channels here that we're allowed to post in. Even if we're allowed
                // to view the channel.
                if (
                    !hasAccessLevel(
                        getAccountAccessLevelAssumingSpaceAccess(
                            result.accessPolicy,
                            currentAccount?.id,
                        ),
                        "Edit",
                    )
                ) {
                    return;
                }

                return {
                    key: result.channel.id,
                    ...result,
                };
            }).sort((result1, result2) => {
                const isResult1InSearchByAffinity =
                    channelIdsFromSearchByAffinity?.has(result1.channel.id) ?? false;
                const isResult2InSearchByAffinity =
                    channelIdsFromSearchByAffinity?.has(result2.channel.id) ?? false;

                if (isResult1InSearchByAffinity && isResult2InSearchByAffinity) return 0;
                if (isResult1InSearchByAffinity) return -1;
                if (isResult2InSearchByAffinity) return 1;

                return 0;
            });

            return results;
        }
    }, [currentAccount?.id, searchByAffinityOutput, searchByKeywordsOutput]);

    const areItemsLoading = !items;

    const selectedKey = channel?.id ?? null;

    const comboBoxProps: ComboBoxStateOptions<PostCreatorChannelSelectorItem> = {
        menuTrigger: "manual",
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue,
        onInputChange: inputValue => {
            setInputState(inputState => {
                // Must be in a typing state to accept new typing changes.
                if (inputState.type !== "Typing") return inputState;

                return {
                    type: "Typing",
                    value: inputValue,
                    hasChanged: true,
                    disableAnimationOut: false,
                    shouldSelectRef: {current: false},
                };
            });

            // If the combobox was closed (probably because of a selection) reopen when the
            // user starts typing again.
            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        onOpenChange: isOpen => {
            const inputElement = assertExists(inputRef.current);

            // Select all text when the combobox opens.
            //
            // Except on mobile. Since on mobile devices like iOS selecting a range of text
            // will open a hovering edit menu (with copy/paste/etc. actions) which
            // conflicts with our overlay. So instead we clear out the text. The old text
            // will still be visible in a placeholder.
            if (isOpen && platform !== "mobile") {
                inputElement.select();
            }

            // We need to know whether the combobox is open or not to decide whether we
            // should load channel items.
            //
            // We call `setShouldLoadItems(false)` after the overlay animation finishes.
            if (isOpen) {
                setShouldLoadItems(isOpen);
            }
        },

        onFocus: () => {
            // Open the combobox on focus.
            comboBoxState.open();

            // When focused, switch to a typing state.
            setInputState(inputState => {
                if (inputState.type === "Typing") return inputState;
                return {
                    type: "Typing",
                    value: platform !== "mobile" ? inputValue : "",
                    hasChanged: false,
                    disableAnimationOut: false,
                    shouldSelectRef: {current: false},
                };
            });
        },

        onBlur: event => {
            // Chrome dispatches a "fake" blur event when the user has an element focused
            // but then clicks on another window, focusing that window but leaving our
            // current window visible. `blur` is dispatched but `document.activeElement`
            // doesn't change!
            //
            // Detect this case. If we receive a `blur` event but `document.activeElement`
            // hasn't changed then escalate to a real blur.
            if (event.target === document.activeElement) {
                event.target.blur();
            }

            // When unfocused, switch back to a selection state discarding any typed value.
            setInputState(inputState => {
                if (inputState.type === "Selection") return inputState;
                return {
                    type: "Selection",
                    disableAnimationOut: false,
                    shouldBlurRef: {current: false},
                };
            });
        },

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

        items: items ?? emptyArray,
        children: useCallback((item: PostCreatorChannelSelectorItem) => {
            return (
                <Item textValue={item.channel.name}>
                    <PostCreatorChannelSelectorListBoxOptionItem item={item} />
                </Item>
            );
        }, []),

        selectedKey,
        onSelectionChange: _key => {
            if (isClosingComboBox) return;

            const key = _key as ChannelId;

            let item: PostCreatorChannelSelectorItem | null;
            if (key === null) {
                item = null;
            } else {
                item = items?.find(item => item.key === key) ?? null;

                // If we couldn't find the item (maybe the combobox is closed) then abort!
                if (!item) return;
            }

            if (key !== selectedKey) {
                onChannelChange(item?.channel ?? null);
            }

            // Keep focus in the input if we're using a keyboard interaction modality.
            //
            // And if an item is selected. If the user hits "Enter" to clear the selection
            // we always want to blur the input.
            if (item !== null && getInteractionModality() !== "pointer") {
                setInputState(inputState => {
                    if (inputState.type !== "Typing") return inputState;
                    return {
                        type: "Typing",
                        value: item ? item.channel.name : "",
                        hasChanged: false,
                        disableAnimationOut: true,
                        shouldSelectRef: {current: true},
                    };
                });

                // Close after the user has selected an option. `shouldSelect: true` will also
                // disable the overlay animation out.
                //
                // Annoyingly, `react-aria` recursively calls `onSelectionChange` when you call
                // `close()` so we need to defend against recursion.
                isClosingComboBox = true;
                try {
                    comboBoxState.close();
                } finally {
                    isClosingComboBox = false;
                }
            } else {
                setInputState(inputState => {
                    if (inputState.type === "Selection") return inputState;
                    return {
                        type: "Selection",
                        disableAnimationOut: true,
                        shouldBlurRef: {current: true},
                    };
                });
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    const {inputProps, listBoxProps, buttonProps} = useComboBox(
        {
            ...comboBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            "aria-label": "Channel",
        },
        comboBoxState,
    );

    return (
        <OverlayAnimated
            isVisible={comboBoxState.isOpen}
            offset={defaultTooltipOffset}
            disableAnimationIn={true}
            disableAnimationOut={inputState.disableAnimationOut}
            placement="bottom-start"
            sameWidth={width === "full"}
            // The overlay blocks interaction with everything below it, except the element
            // we're targeting (the combobox input).
            isBlocking={true}
            withoutBlockingTarget={true}
            onBlockingCoverPointerDown={() => {
                if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
            }}
            overlay={
                <Box ref={popoverRef} position="relative">
                    <PostCreatorChannelSelectorListBox
                        width={width}
                        comboBoxState={comboBoxState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                        selectedKey={selectedKey}
                        areItemsLoading={areItemsLoading}
                    />
                </Box>
            }
            onActuallyVisibleChange={isActuallyVisible => {
                // Wait for the animation to finish before we stop loading items.
                if (!isActuallyVisible) {
                    setShouldLoadItems(false);
                }
            }}
        >
            <Box position="relative" height="7" width={width}>
                <FocusRing offset="border">
                    <input
                        {...inputProps}
                        ref={inputRef}
                        className={sprinkles({
                            display: "block",
                            width: "full",
                            paddingLeft: "2",
                            paddingRight: "7",
                            height: "full",
                            fontSize: "75",
                            backgroundColor: "transparent",
                            borderRadius: "1",
                            boxShadow: "elevation-5-with-grey-10-border",
                        })}
                        placeholder="Channel"
                        // Allow iOS and MacOS autocorrect and spell checking. By default `react-aria`
                        // disables these capabilities because the user has combobox suggestions.
                        // However, fixing typos at the OS level when typos are common (like on iOS)
                        // is really useful.
                        autoCorrect={undefined}
                        spellCheck={undefined}
                        onKeyDown={event => {
                            if (
                                event.key === "Enter" &&
                                comboBoxState.selectionManager.focusedKey == null
                            ) {
                                // NOTE(calebmer): By default, `@react-aria/combobox` [calls `state.commit()`
                                // whenever `Enter` is pressed][1] whether or not an option is focused. If an
                                // option isn't focused this just closes the combobox and leaves the user
                                // confused. Is what they typed the new value or not? It's not, you can tell
                                // since the avatar doesn't change. This is particularly confusing on mobile
                                // where the user may hit the return key expecting the first value in the menu
                                // to be selected. But that won't happen, the menu will just close.
                                //
                                // So intercept this case and don't call into `@react-aria/combobox`.
                                //
                                // [1]: https://github.com/adobe/react-spectrum/blob/e7b1c7fa869fbf3f03194f98c3e2f35c9861a613/packages/%40react-aria/combobox/src/useComboBox.ts#L132

                                // Clear the selection when the user presses enter when nothing is focused.
                                // This way the user has a way to empty the channel selector input.
                                comboBoxProps.onSelectionChange?.(null as any);
                            } else {
                                inputProps.onKeyDown?.(event);
                            }
                        }}
                        onPointerDown={event => {
                            // As a convenience, if you tap on this element while it's already focused but
                            // the combobox isn't open then open the combobox. After you select an option
                            // the combobox closes but the user may want to select another account.
                            //
                            // We have to be a little careful and make sure this doesn't break the default
                            // browser behavior of focusing the input if it's unfocused.
                            if (document.activeElement === event.target && !comboBoxState.isOpen) {
                                comboBoxState.open();
                            }

                            // When using the mouse, if the user clicks the input and the input isn't
                            // focused then prevent default and open the combobox. We `preventDefault()`
                            // since the browser default is to focus on `pointerdown` then set the
                            // selection on `pointerup`. However, on initial tap we want to focus
                            // everything (we call `inputElement.select()` in `onOpenChange`) so the
                            // browser changing the selection in `pointerup` breaks that.
                            if (
                                event.pointerType === "mouse" &&
                                document.activeElement !== event.target
                            ) {
                                event.preventDefault();
                                comboBoxState.open();
                            }
                        }}
                    />
                </FocusRing>
                <Box
                    position="absolute"
                    top="1"
                    right="1"
                    className={
                        shouldShowSearchLoadingIndicator
                            ? undefined
                            : pointerEventsNoneNotInheritedClassName
                    }
                    opacity={shouldShowSearchLoadingIndicator ? "0" : undefined}
                    pointerEvents={shouldShowSearchLoadingIndicator ? "none" : undefined}
                >
                    <IconButton
                        {...buttonProps}
                        // The button has its own label so we don't need one from `react-aria`.
                        aria-labelledby={undefined}
                        size="sm"
                        description="Toggle"
                        withoutTooltip={true}
                    >
                        <CaretDown />
                    </IconButton>
                </Box>
                {shouldShowSearchLoadingIndicator && (
                    <Box
                        position="absolute"
                        top="0"
                        bottom="0"
                        right="0"
                        width="7"
                        pointerEvents="none"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                    >
                        <SpinnerGap className={spinAnimationClassName} size={spacing["3"]} />
                    </Box>
                )}
            </Box>
        </OverlayAnimated>
    );
}

function PostCreatorChannelSelectorListBox({
    width,
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    selectedKey,
    areItemsLoading,
}: {
    width: "48" | "full";
    comboBoxState: ComboBoxState<PostCreatorChannelSelectorItem>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<PostCreatorChannelSelectorItem>;
    selectedKey: string | null;
    areItemsLoading: boolean;
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
                    width: width === "full" ? "full" : "64",
                    overflowX: "hidden",
                    overflowY: "auto",
                }),
            )}
            style={{
                // On mobile the height needs to be less than half of the available space when
                // the keyboard and navigation bar are open.
                maxHeight:
                    platform === "mobile"
                        ? "10rem"
                        : // Subtract `6` since `64` is a little awkward when we're sharing an entity in
                          // `<PostCreator>` because it almost exactly touches the bottom of the file
                          // entity.
                          subtractRemLengths(spacing["64"], spacing["6"]),
            }}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
                {areItemsLoading ? (
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
                ) : comboBoxState.collection.size === 0 ? (
                    <Box padding="1.5" display="flex" alignItems="center" gap="1.5" color="grey-70">
                        <Box padding="0.5">
                            <MagnifyingGlass size={spacing["4"]} />
                        </Box>
                        <Box>No results</Box>
                    </Box>
                ) : (
                    Array.from(comboBoxState.collection, item => (
                        <PostCreatorChannelSelectorListBoxOption
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

function PostCreatorChannelSelectorListBoxOption({
    comboBoxState,
    item,
    selectedKey,
}: {
    comboBoxState: ComboBoxState<PostCreatorChannelSelectorItem>;
    item: Node<PostCreatorChannelSelectorItem>;
    selectedKey: string | null;
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
                    padding: "2",
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

function PostCreatorChannelSelectorListBoxOptionItem({
    item,
    isSelected,
    isPressed,
}: {
    item: PostCreatorChannelSelectorItem;
    isSelected?: boolean;
    isPressed?: boolean;
}) {
    assert(
        typeof isSelected === "boolean" && typeof isPressed === "boolean",
        "Expected to be rendered by <TaskAssigneeInputListBoxOption> which provides extra props",
    );

    return (
        <Box display="flex" alignItems="center" gap="3">
            <Box flexGrow="1" overflow="hidden" style={{minWidth: 0}}>
                <Box fontStyle="truncate">{item.channel.name}</Box>
                {item.descriptionTextSnippet.length > 0 && (
                    <Box
                        paddingTop="0.5"
                        overflow="hidden"
                        color="grey-40"
                        fontSize="50"
                        style={{
                            // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                            // except IE.
                            // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            lineClamp: 2,
                            WebkitBoxOrient: "vertical",
                            textOverflow: "ellipsis",
                            // Render contextual alternate glyphs. Particularly important that we render
                            // the right "@" for mentions.
                            // eslint-disable-next-line cyberworlds/string-quotes
                            fontFeatureSettings: '"calt" on',
                        }}
                    >
                        {item.descriptionTextSnippet}
                    </Box>
                )}
            </Box>
            {isSelected && (
                <Box flexShrink="0" display="flex">
                    <Check
                        size={spacing["3"]}
                        color={isPressed ? colorSchemeVars["grey-100"] : colorSchemeVars["grey-70"]}
                    />
                </Box>
            )}
        </Box>
    );
}
