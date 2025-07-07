import {
    Modality,
    getInteractionModality,
    isFocusVisible as getIsFocusVisible,
    setInteractionModality,
} from "@react-aria/interactions";
import _Fuse from "fuse.js";
import {MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    RefObject,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {ContentEditorCursorTracker} from "~/client/content/internal/content_editor_cursor_tracker.js";
import {
    setContentEditorQuickUndo,
    updateContentEditorReferences,
} from "~/client/content/state/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {Menu} from "~/client/design/menu.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {OverlayRef} from "~/client/design/overlay.js";
import {OverlayAnimated} from "~/client/design/overlay_animated.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useConstant} from "~/client/helpers/lifecycle/use_constant.js";
import {useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/helpers/use_store.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    greyElevated2ClassName,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export function ContentEditorMentionFloater({
    state,
    viewRef,
    range,
    searchQuery,
    handleKeyDownRef,
    isFocused,
    isClosing,
    onCloseWithoutAnimation: _onCloseWithoutAnimation,
    onCloseWithAnimation: _onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    searchQuery: string;
    handleKeyDownRef: RefObject<((event: KeyboardEvent) => void) | null>;
    isFocused: boolean;
    isClosing: boolean;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const {space} = useSpaceContext();

    const overlayRef = useRef<OverlayRef>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const mergedMenuRef = useMergedRefs(menuRef, useScrollbar());

    const {onCloseWithoutAnimation, onCloseWithAnimation} = useEvents({
        onCloseWithoutAnimation: _onCloseWithoutAnimation,
        onCloseWithAnimation: _onCloseWithAnimation,
    });

    useLayoutEffect(() => {
        if (!isFocused) {
            // `onCloseWithAnimation` ends up calling `view.dispatch()` which runs
            // `flushSync()`. Since `flushSync()` can't be run in an effect we schedule
            // a microtask.
            scheduleMicrotask(() => {
                onCloseWithAnimation();
            });
        }
    }, [isFocused, onCloseWithAnimation]);

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onCloseWithoutAnimation();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onCloseWithoutAnimation]);

    const accountRegistry = useAccountRegistry();
    const allAccounts = useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output
        ?.accounts;

    const allAccountDatas = useStore(
        useMemo(
            () =>
                allAccounts
                    ? Store.mapMany(
                          allAccounts.map(account => accountRegistry.getAccountStore(account)),
                          accounts => accounts,
                      )
                    : null,
            [accountRegistry, allAccounts],
        ),
    );

    const allAccountsFuse = useMemo(() => {
        if (!allAccountDatas) return null;

        return new Fuse(allAccountDatas, {keys: ["name"], includeScore: true});
    }, [allAccountDatas]);

    const searchedAccountDatas = useMemo(() => {
        if (!allAccountDatas || !allAccountsFuse) return null;
        if (searchQuery.length === 0) {
            // Don't include removed accounts in the initial rendered account list.
            //
            // TODO(calebmer): When searching, removed accounts should rank lower. How do
            // we give them a lower score while still allowing users to find them?
            return allAccountDatas.filter(item => !item.space.removal);
        }
        return allAccountsFuse.search(searchQuery).map(({item}) => item);
    }, [allAccountDatas, allAccountsFuse, searchQuery]);

    const [_selectionState, setSelectionState] = useState<{
        searchQuery: string;
        index: number | null;
        isFocusVisible: boolean;
    }>({
        searchQuery,
        index: null,
        isFocusVisible: false,
    });

    const selectionState =
        _selectionState.searchQuery !== searchQuery ||
        !searchedAccountDatas ||
        (_selectionState.index !== null && _selectionState.index >= searchedAccountDatas.length)
            ? {searchQuery, index: null, isFocusVisible: false}
            : _selectionState;

    const hasSelection: boolean = selectionState.index !== null;

    const originalInteractionModalityRef = useRef<Modality | null>(null);

    // When we lose our selection (usually because we unmounted) return the
    // interaction modality to whatever it was before we started keyboard
    // navigating.
    //
    // When this component loses its selection (or unmounts) restore
    // interaction modality to whatever it was before we set it to `keyboard`.
    // While editing, the user may hit @ to mention then arrow keys to select an
    // account. Only keep them in `keyboard` interaction modality if that's the
    // state they were previously in. Since keyboard navigation within this
    // component is a pretty common pattern even for a user that predominantly uses
    // `pointer` navigation. Showing focus rings for new elements the user focuses
    // (e.g. the link input when the user hits Cmd+K) will likely confuse them
    // since they didn't intend to enter keyboard navigation mode.
    useEffect(() => {
        return () => {
            if (hasSelection && originalInteractionModalityRef.current !== null) {
                setInteractionModality(originalInteractionModalityRef.current);
                originalInteractionModalityRef.current = null;
            }
        };
    }, [hasSelection]);

    const saveMention = (accountData: AccountModelData) => {
        const view = assertExists(viewRef.current);

        // If the account's short name is not ambiguous when searching all account
        // names then we will insert a short mention by default. The user can undo
        // (cmd-z) to get the long version of the mention.
        const isShortNameAmbiguous = allAccountsFuse
            ? allAccountsFuse
                  .search(getAccountShortNameWithoutFullNameTooltip(accountData))
                  .filter(result => typeof result.score !== "number" || result.score < 0.25)
                  .length > 1
            : true;

        const mention: ContentMention = {
            type: "Account",
            accountId: accountData.id,
            // Only use short name for a non-ambiguous name on desktop. Since on mobile the
            // quick undo capability doesn't really exist. Instead the user may tap delete
            // to get a short name.
            isShort: platform !== "mobile" && !isShortNameAmbiguous,
        };

        let transaction = updateContentEditorReferences(
            view.state.tr.replaceRangeWith(
                range.from,
                range.to,
                view.state.schema.node("mention", {mention}),
            ),
            {
                type: "SetAccount",
                account: new AccountModel(accountData),
            },
        );

        // If, as a convenience, we shortened the mention then we want undo (cmd-z) to
        // expand the mention back out so register a quick undo transaction.
        if (mention.isShort) {
            const newMention: ContentMention = {
                ...mention,
                isShort: false,
            };

            transaction = setContentEditorQuickUndo(
                transaction,
                "Mod-z",
                range.from,
                (state, dispatch, pos) => {
                    // If `pos` no longer represents the mention, return.
                    const $pos = state.doc.resolve(pos);

                    const node = $pos.node();
                    if (node.childCount === 0) return false;

                    const childNode = node.child($pos.index());
                    if (childNode.type.name !== "mention") return false;

                    dispatch?.(state.tr.setNodeAttribute(pos, "mention", newMention));
                    return true;
                },
            );
        }

        view.dispatch(transaction);

        onCloseWithoutAnimation();
    };

    useImperativeHandle(handleKeyDownRef, () => event => {
        switch (event.key) {
            // Moves focus to the next item, optionally wrapping from the last to
            // the first.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "ArrowDown": {
                event.preventDefault(); // Don't scroll or move cursor
                event.stopPropagation();

                if (searchedAccountDatas && searchedAccountDatas.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchQuery,
                        index:
                            selectionState.index === null ||
                            selectionState.index === searchedAccountDatas.length - 1
                                ? 0
                                : selectionState.index + 1,
                        isFocusVisible: getIsFocusVisible(),
                    });
                }
                break;
            }
            // Moves focus to the previous item, optionally wrapping from the first to
            // the last.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "ArrowUp": {
                event.preventDefault(); // Don't scroll or move cursor
                event.stopPropagation();

                if (searchedAccountDatas && searchedAccountDatas.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchQuery,
                        index:
                            selectionState.index === null || selectionState.index === 0
                                ? searchedAccountDatas.length - 1
                                : selectionState.index - 1,
                        isFocusVisible: getIsFocusVisible(),
                    });
                }
                break;
            }
            // Moves focus to the first item in the current menu. Technically, the spec
            // says only implement if arrow key wrapping is not supported but it's easy
            // to support so why not.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "Home": {
                event.preventDefault(); // Don't scroll
                event.stopPropagation();

                if (searchedAccountDatas && searchedAccountDatas.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchQuery,
                        index: 0,
                        isFocusVisible: getIsFocusVisible(),
                    });
                }
                break;
            }
            // Moves focus to the last item in the current menu. Technically, the spec
            // says only implement if arrow key wrapping is not supported but it's easy
            // to support so why not.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "End": {
                event.preventDefault(); // Don't scroll
                event.stopPropagation();

                if (searchedAccountDatas && searchedAccountDatas.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchQuery,
                        index: searchedAccountDatas.length - 1,
                        isFocusVisible: getIsFocusVisible(),
                    });
                }
                break;
            }
            // Escape closes the menu with focus and returns focus to the context the menu
            // was opened. Given focus always stays in the content editor we just close
            // the floater.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "Escape": {
                event.preventDefault();
                event.stopPropagation();
                onCloseWithAnimation();
                break;
            }
            // When focus is on an item activate the item and close the menu.
            //
            // Space may also do this in the menu ARIA pattern but because we are in a text
            // editor, space inserts...well...a space.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();

                if (
                    searchedAccountDatas &&
                    selectionState.index !== null &&
                    selectionState.index < searchedAccountDatas.length
                ) {
                    const accountData = searchedAccountDatas[selectionState.index]!;
                    saveMention(accountData);
                }
                break;
            }
        }
    });

    const isLoading = allAccountDatas === null;
    const wasInitiallyLoading = useConstant(() => isLoading);
    const [shouldShowLoadingIndicatorIfLoading, setShouldShowLoadingIndicatorIfLoading] =
        useState(false);
    useEffect(() => {
        if (!isLoading) return;
        if (shouldShowLoadingIndicatorIfLoading) return;

        const timeout = createTimeout(() => {
            setShouldShowLoadingIndicatorIfLoading(true);
        }, delayLoadingIndicatorLimitMs);
        return () => {
            timeout.clear();
        };
    }, [isLoading, shouldShowLoadingIndicatorIfLoading]);

    if (isLoading && !shouldShowLoadingIndicatorIfLoading) return null;

    const {width} = Menu.sizeConstants.base[platform];

    return (
        <OverlayAnimated
            ref={overlayRef}
            // We don't animate in because the overlay appears in direct response to a user
            // input (keyboard shortcut). But we do animate out because closing is less
            // intentional.
            //
            // However, we do want to animate in if we are loading.
            isVisible={!isClosing}
            disableAnimation={!wasInitiallyLoading && !isClosing}
            placement="bottom-start"
            overflowTop={navigationBarHeight}
            // Set a constant `overflowBottom` value instead of relying on the current
            // keyboard height (which will be updated asynchronously after `isEditing` is
            // true). This stops the overlay placement from jumping around while the
            // keyboard opens. The value was calculated based on the keyboard height in
            // iOS. We may need to change this constant if the keyboard height for iOS
            // changes or the Android keyboard height is bigger.
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            offset="3"
            overlay={
                // TODO(calebmer): This should eventually be virtualized. Probably at the same
                // time we add a proper search backend for mentions?
                <Box
                    data-testid="ContentEditorMentionFloater"
                    ref={mergedMenuRef}
                    position="relative"
                    width={width}
                    // Hide the scrollbar while animating closed by setting overflow to `hidden`
                    // while animating.
                    overflowX="hidden"
                    overflowY={!isClosing ? "auto" : "hidden"}
                    borderRadius="1.5"
                    padding="1"
                    className={greyElevated2ClassName}
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    style={{
                        // On mobile the height needs to be less than half of the available space when
                        // the keyboard and navigation bar are open.
                        maxHeight: platform === "mobile" ? "10rem" : spacing["64"],
                    }}
                >
                    <Box
                    // Container div which:
                    //
                    // 1. Means `useScrollbar()` doesn't insert an item after our last element
                    //    messing up our scroll logic. See `!itemElement.nextSibling` check in
                    //    scroll layout effect above.
                    //
                    // 2. Means `useScrollbar()` on the parent `<Box>` doesn't need to add a resize
                    //    listener to each account.
                    >
                        {isLoading && shouldShowLoadingIndicatorIfLoading ? (
                            <Box
                                paddingX="1.5"
                                paddingY="1.5"
                                display="flex"
                                justifyContent="center"
                            >
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    size={spacing["4"]}
                                />
                            </Box>
                        ) : !searchedAccountDatas || searchedAccountDatas.length === 0 ? (
                            <Box
                                paddingX="1.5"
                                paddingY="1.5"
                                display="flex"
                                alignItems="center"
                                gap="2"
                                color="grey-70"
                            >
                                <Box padding="1">
                                    <MagnifyingGlass size={spacing["4"]} />
                                </Box>
                                <Box>No results</Box>
                            </Box>
                        ) : (
                            searchedAccountDatas?.map((accountData, index) => (
                                <ContentEditorMentionAccountItem
                                    key={accountData.id}
                                    accountData={accountData}
                                    menuRef={menuRef}
                                    isClosing={isClosing}
                                    isFocusVisible={selectionState.isFocusVisible}
                                    isSelected={selectionState.index === index}
                                    onSelect={() =>
                                        setSelectionState({
                                            searchQuery,
                                            index,
                                            isFocusVisible: getIsFocusVisible(),
                                        })
                                    }
                                    onDeselect={() =>
                                        setSelectionState(selectionState => {
                                            if (
                                                selectionState.searchQuery !== searchQuery ||
                                                selectionState.index !== index
                                            ) {
                                                return selectionState;
                                            }
                                            return {
                                                searchQuery,
                                                index: null,
                                                isFocusVisible: false,
                                            };
                                        })
                                    }
                                    onPress={() => saveMention(accountData)}
                                />
                            ))
                        )}
                    </Box>
                </Box>
            }
        >
            <ContentEditorCursorTracker
                state={state}
                viewRef={viewRef}
                pos={range.from}
                onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
            />
        </OverlayAnimated>
    );
}

function ContentEditorMentionAccountItem({
    accountData,
    menuRef,
    isClosing,
    isFocusVisible,
    isSelected,
    onSelect,
    onDeselect,
    onPress,
}: {
    accountData: AccountModelData;
    menuRef: RefObject<HTMLDivElement>;
    isClosing: boolean;
    isFocusVisible: boolean;
    isSelected: boolean;
    onSelect: () => void;
    onDeselect: () => void;
    onPress: () => void;
}) {
    const itemRef = useRef<HTMLDivElement>(null);

    const {isHovered, hoverProps} = useHover({
        onHoverStart: onSelect,
        onHoverEnd: onDeselect,
    });

    const {isPressed, pressProps} = usePress({
        onPress,
    });

    // Scroll our item into view when it is focused using the keyboard. We manually
    // implement scrolling since `scrollIntoView()` has weird behavior.
    const wasScrolledInRef = useRef(false);
    useLayoutEffect(() => {
        const run = () => {
            const menuElement = assertExists(menuRef.current);
            const itemElement = assertExists(itemRef.current);
            assert(itemElement.offsetParent === menuElement);

            if (!isSelected || !isFocusVisible) {
                wasScrolledInRef.current = false;
                return;
            }

            if (wasScrolledInRef.current) return;
            wasScrolledInRef.current = true;

            if (itemElement.offsetTop < menuElement.scrollTop) {
                // First item scrolls us all the way to the top.
                if (!itemElement.previousSibling) {
                    menuElement.scrollTop = 0;
                } else {
                    menuElement.scrollTop = itemElement.offsetTop;
                }
            } else if (
                itemElement.offsetTop + itemElement.clientHeight >
                menuElement.scrollTop + menuElement.clientHeight
            ) {
                // Last item scrolls us all the way to the end.
                if (!itemElement.nextSibling) {
                    menuElement.scrollTop = menuElement.scrollHeight - menuElement.clientHeight;
                } else {
                    menuElement.scrollTop =
                        itemElement.offsetTop + itemElement.clientHeight - menuElement.clientHeight;
                }
            }
        };

        // Run after a microtask so the parent `menuRef` can be populated.
        let isCancelled = false;
        scheduleMicrotask(() => {
            if (isCancelled) return;
            run();
        });
        return () => {
            isCancelled = true;
        };
    }, [isFocusVisible, isSelected, menuRef]);

    return (
        <FocusRing
            offset="0"
            isVisible={isSelected && isFocusVisible && !isClosing}
            shouldIgnoreFocusEvents={true}
        >
            <Box
                {...mergeProps(hoverProps, pressProps)}
                ref={itemRef}
                paddingX="1.5"
                paddingY="1.5"
                borderRadius="1"
                display="flex"
                alignItems="center"
                gap="2"
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
            >
                <AccountAvatar account={accountData} size="6" />
                <Box fontStyle="truncate">{accountData.name}</Box>
            </Box>
        </FocusRing>
    );
}
