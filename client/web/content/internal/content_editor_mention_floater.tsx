import {
    Modality,
    getInteractionModality,
    isFocusVisible as getIsFocusVisible,
    setInteractionModality,
} from "@react-aria/interactions";
import _Fuse from "fuse.js";
import {IconContext, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {EditorState, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    Fragment,
    ReactNode,
    RefObject,
    useEffect,
    useImperativeHandle,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {mergeProps, useHover, usePress} from "react-aria";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {AccountShortName} from "~/client/web/accounts/account_short_name.js";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {
    ContentEditorInsertMenuAction,
    getContentEditorInsertMenuActions,
} from "~/client/web/content/internal/get_content_editor_insert_menu_actions.js";
import {useSearchMentionState} from "~/client/web/content/internal/use_search_mention_state.js";
import {
    setContentEditorQuickUndo,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Menu} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {renderTextWithEmojiFontFamily} from "~/client/web/helpers/render_text_with_emoji_font_family.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {
    useSearchEntityModel,
    useSearchEntityRegistry,
} from "~/client/web/search/core/search_entity_registry_context.js";
import {getSearchEntityTypeDisplay} from "~/client/web/search/core/search_entity_type_display.js";
import {SearchEntityViewTitlePrefix} from "~/client/web/search/core/search_entity_view_title.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {searchEntityViewTitleLineHeightPx} from "~/client/web/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {deletedSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    isSearchDynamicEntityType,
    isSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel, SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const maxAccountCount = 5;

/**
 * If we have a Fuse.js score below this when parsing a name then we consider
 * the name a match.
 *
 * We maintain a stricter score cutoff than Fuse.js since it would be odd to
 * show fuse matched items with very few similar characters next to results
 * from our search backend.
 */
const fuseScoreMatchCutoff = 0.35;

export function ContentEditorMentionFloater({
    state,
    viewRef,
    range,
    searchQuery,
    handleKeyDownRef,
    isFocused,
    isClosing,
    onCloseWithoutAnimation: onCloseWithoutAnimationFromProps,
    onCloseWithAnimation: onCloseWithAnimationFromProps,
}: {
    state: EditorState;
    viewRef: RefObject<
        | (EditorView & {
              insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
          })
        | null
    >;
    range: {from: number; to: number};
    searchQuery: string;
    handleKeyDownRef: RefObject<((event: KeyboardEvent) => void) | null>;
    isFocused: boolean;
    isClosing: boolean;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const {space, currentAccount} = useSpaceContext();
    const searchEntityRegistry = useSearchEntityRegistry();

    const overlayRef = useRef<OverlayRef>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const mergedMenuRef = useMergedRefs(menuRef, useScrollbar());

    const {
        onCloseWithoutAnimation,
        onCloseWithAnimation,
        saveAccountMention,
        saveSearchEntityMention,
    } = useEvents({
        onCloseWithoutAnimation: onCloseWithoutAnimationFromProps,
        onCloseWithAnimation: onCloseWithAnimationFromProps,

        saveAccountMention: (accountData: AccountModelData) => {
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
        },

        saveSearchEntityMention: (entityData: SearchEntityModelData) => {
            assert(isSearchMentionEntityId(entityData.id));

            const view = assertExists(viewRef.current);

            const mention: ContentMention = {type: "SearchEntity", entityId: entityData.id};

            const transaction = updateContentEditorReferences(
                view.state.tr.replaceRangeWith(
                    range.from,
                    range.to,
                    view.state.schema.node("mention", {mention}),
                ),
                {
                    type: "SetSearchEntity",
                    entityId: entityData.id,
                    entity: {
                        isPrivate: false,
                        entity: new SearchEntityModel(entityData),
                    },
                },
            );

            view.dispatch(transaction);

            onCloseWithoutAnimation();
        },
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

    const {
        output: searchMentionOutput,
        queryText: searchStateQueryText,
        onQueryTextChange: onSearchStateQueryTextChange,
    } = useSearchMentionState({initialQueryText: searchQuery});

    // `searchQuery` is controlled by a prop. Make sure we keep the state internal
    // to keep `useSearchMentionState()` in sync with the `searchQuery` prop.
    if (searchQuery !== searchStateQueryText) {
        onSearchStateQueryTextChange(searchQuery);
    }

    const lastSearchKeyRef = useRef(searchMentionOutput.key);

    // Reset scroll position whenever the search key changes.
    useLayoutEffect(() => {
        if (lastSearchKeyRef.current === searchMentionOutput.key) return;
        lastSearchKeyRef.current = searchMentionOutput.key;

        if (menuRef.current) menuRef.current.scrollTop = 0;
    }, [searchMentionOutput.key]);

    const getInsertMenuSelection = useEvent(() => {
        const view = assertExists(viewRef.current);

        let $to = view.state.doc.resolve(range.to);
        let $from = view.state.doc.resolve(range.from);

        // As a convenience, if we have "foo @divider bar" then we want to trim the
        // space at the start of " bar" when inserting our divider.
        if ($to.nodeAfter?.isText) {
            const newText = $to.nodeAfter.text!.trimStart();
            $to = view.state.doc.resolve($to.pos + ($to.nodeAfter.text!.length - newText.length));
        }

        // As a convenience, if we have "foo @divider bar" then we want to trim the
        // space at the end of "foo " when inserting our divider.
        if ($from.nodeBefore?.isText) {
            const newText = $from.nodeBefore.text!.trimEnd();
            $from = view.state.doc.resolve(
                $from.pos - ($from.nodeBefore.text!.length - newText.length),
            );
        }

        return TextSelection.between($to, $from);
    });

    const insertMenuActions = useMemo(
        () =>
            getContentEditorInsertMenuActions({
                schema: state.schema,
                viewRef,
                getSelection: getInsertMenuSelection,
                alwaysDeleteSelection: true,
            }).flat(),
        [getInsertMenuSelection, state.schema, viewRef],
    );

    const insertMenuActionsFuse = useMemo(() => {
        return new Fuse(insertMenuActions, {keys: ["label"], includeScore: true});
    }, [insertMenuActions]);

    // We use `searchMentionOutput.queryText` for searching menu actions not the
    // prop `searchQuery`. That's because we want our menu action search result to
    // update at the same time as our entity mentions search result.
    const searchedInsertMenuActions = useMemo(() => {
        if (searchMentionOutput.queryText.length === 0) {
            return insertMenuActions.filter(action => action.isSuggestedInMentionFloater);
        }

        return filterMapArray(
            insertMenuActionsFuse.search(searchMentionOutput.queryText),
            ({item, score}) => {
                if (score! >= fuseScoreMatchCutoff) return;
                return item;
            },
        );
    }, [insertMenuActions, insertMenuActionsFuse, searchMentionOutput.queryText]);

    const accountRegistry = useAccountRegistry();
    const allAccounts = useLazyLoadRpc(expensivelyGetAllSpaceAccounts, {spaceId: space.id}).output
        ?.accounts;

    const allAccountDatas = useStore(
        useMemo(
            () =>
                allAccounts
                    ? Store.mapMany(
                          allAccounts.map(account => accountRegistry.getAccountStore(account)),
                          accountDatas => accountDatas,
                      )
                    : null,
            [accountRegistry, allAccounts],
        ),
    );

    const allAccountsFuse = useMemo(() => {
        if (!allAccountDatas) return null;

        return new Fuse(allAccountDatas, {keys: ["name"], includeScore: true});
    }, [allAccountDatas]);

    // We use `searchMentionOutput.queryText` for searching accounts not the prop
    // `searchQuery`. That's because we want our account search result to update at
    // the same time as our entity mentions search result.
    const searchedAccountDatas = useMemo(() => {
        if (!allAccountDatas || !allAccountsFuse) return null;

        // If the user hasn't typed any search text yet then show accounts in affinity
        // order.
        if (searchMentionOutput.queryText.length === 0) {
            return Array.from(
                sliceIterable(
                    filterIterable(
                        allAccountDatas ?? emptyArray,
                        accountData =>
                            // Don't include your account in the suggested mention list and don't include
                            // removed accounts.
                            accountData.id !== currentAccount?.id &&
                            accountData.space.state.type === "Active",
                    ),
                    0,
                    maxAccountCount,
                ),
            );
        }

        return filterMapArray(
            allAccountsFuse.search(searchMentionOutput.queryText),
            ({item, score}) => {
                if (score! >= fuseScoreMatchCutoff) return;
                return item;
            },
        )
            .sort((accountData1, accountData2) => {
                // Sort removed accounts below all others when searching.
                if (
                    accountData1.space.state.type === "Active" &&
                    accountData2.space.state.type !== "Active"
                ) {
                    return -1;
                }

                if (
                    accountData1.space.state.type !== "Active" &&
                    accountData2.space.state.type === "Active"
                ) {
                    return 1;
                }

                // Keep the relative order of all other items.
                return 0;
            })
            .slice(0, maxAccountCount);
    }, [allAccountDatas, allAccountsFuse, currentAccount?.id, searchMentionOutput.queryText]);

    type Item =
        | {
              readonly type: "Insert";
              readonly action: ContentEditorInsertMenuAction;
              readonly onPress: () => void;
          }
        | {
              readonly type: "Account";
              readonly accountData: AccountModelData;
              readonly onPress: () => void;
          }
        | {
              readonly type: "SearchEntity";
              readonly entity: SearchEntityModel;
              readonly onPress: () => void;
          };

    const itemSections = useMemo((): ReadonlyArray<{
        readonly title: string;
        readonly items: ReadonlyArray<Item>;
    }> => {
        const hasSearchedAccountDatas =
            searchedAccountDatas !== null && searchedAccountDatas.length > 0;
        const hasSearchMentionResults =
            searchMentionOutput.results !== null && searchMentionOutput.results.length > 0;
        const hasSearchedInsertMenuActions = searchedInsertMenuActions.length > 0;
        const isSearchedInsertMenuActionsFirst = searchMentionOutput.queryText.length > 0;

        const itemSections: Array<{
            title: string;
            items: ReadonlyArray<Item>;
        }> = [];

        if (isSearchedInsertMenuActionsFirst && hasSearchedInsertMenuActions) {
            itemSections.push({
                title: "Insert",
                items: searchedInsertMenuActions.map(action => ({
                    type: "Insert",
                    action,
                    onPress: action.onPress,
                })),
            });
        }

        if (hasSearchedAccountDatas) {
            itemSections.push({
                title: "People",
                items: searchedAccountDatas.map(accountData => ({
                    type: "Account",
                    accountData,
                    onPress: () => saveAccountMention(accountData),
                })),
            });
        }

        if (hasSearchMentionResults) {
            itemSections.push({
                title: searchMentionOutput.queryText.length === 0 ? "Suggested" : "Other",
                items: searchMentionOutput.results.map(result => ({
                    type: "SearchEntity",
                    entity: result.model,
                    onPress: () =>
                        saveSearchEntityMention(
                            searchEntityRegistry.getEntityStore(result.model).getSnapshot(),
                        ),
                })),
            });
        }

        if (!isSearchedInsertMenuActionsFirst && hasSearchedInsertMenuActions) {
            itemSections.push({
                title: "Insert",
                items: searchedInsertMenuActions.map(action => ({
                    type: "Insert",
                    action,
                    onPress: action.onPress,
                })),
            });
        }

        return itemSections;
    }, [
        saveAccountMention,
        saveSearchEntityMention,
        searchEntityRegistry,
        searchMentionOutput.queryText.length,
        searchMentionOutput.results,
        searchedAccountDatas,
        searchedInsertMenuActions,
    ]);

    const items = useMemo(() => itemSections.flatMap(section => section.items), [itemSections]);

    const [actualSelectionState, setSelectionState] = useState<{
        searchKey: string;
        index: number | null;
        isFocusVisible: boolean;
    }>({
        searchKey: searchMentionOutput.key,
        index: null,
        isFocusVisible: false,
    });

    const selectionState =
        actualSelectionState.searchKey !== searchMentionOutput.key ||
        (actualSelectionState.index !== null && actualSelectionState.index >= items.length)
            ? {searchKey: searchMentionOutput.key, index: null, isFocusVisible: false}
            : actualSelectionState;

    if (selectionState !== actualSelectionState) setSelectionState(selectionState);

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

    useImperativeHandle(handleKeyDownRef, () => event => {
        switch (event.key) {
            // Moves focus to the next item, optionally wrapping from the last to
            // the first.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "ArrowDown": {
                event.preventDefault(); // Don't scroll or move cursor
                event.stopPropagation();

                if (items.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchKey: searchMentionOutput.key,
                        index:
                            selectionState.index === null ||
                            selectionState.index === items.length - 1
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

                if (items.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchKey: searchMentionOutput.key,
                        index:
                            selectionState.index === null || selectionState.index === 0
                                ? items.length - 1
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

                if (items.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchKey: searchMentionOutput.key,
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

                if (items.length > 0) {
                    originalInteractionModalityRef.current ??= getInteractionModality();
                    setInteractionModality("keyboard");

                    setSelectionState({
                        searchKey: searchMentionOutput.key,
                        index: items.length - 1,
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

                if (selectionState.index === null) break;

                items[selectionState.index]!.onPress();
                break;
            }
        }
    });

    const isLoading = allAccountDatas === null || searchMentionOutput.results === null;
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

    const shouldShowSearchMentionLoadingIndicator = useDelayLoadingIndicator(
        searchMentionOutput.isPending,
    );

    if (isLoading && !shouldShowLoadingIndicatorIfLoading) return null;

    let overlayItemIndex = 0;

    const overlay = isLoading ? (
        <Box paddingX="1.5" paddingY="1.5" display="flex" justifyContent="center">
            <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
        </Box>
    ) : (
        <>
            {shouldShowSearchMentionLoadingIndicator && (
                <Box position="absolute" top="2" right="2">
                    <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                </Box>
            )}
            {items.length === 0 ? (
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
                itemSections.map((itemSection, itemSectionIndex) => {
                    return (
                        <Fragment key={itemSection.title}>
                            {itemSectionIndex !== 0 && (
                                <Box paddingX="1" paddingY="1">
                                    <Box width="full" borderBottom="grey-5" />
                                </Box>
                            )}
                            <Box
                                paddingTop="1.5"
                                paddingBottom="1"
                                paddingX="1.5"
                                color="grey-50"
                                fontSize="50"
                            >
                                {itemSection.title}
                            </Box>
                            {itemSection.items.map(item => {
                                const index = overlayItemIndex;
                                overlayItemIndex++;

                                switch (item.type) {
                                    case "Insert": {
                                        return (
                                            <ContentEditorMentionFloaterInsertItem
                                                key={item.action.label}
                                                menuRef={menuRef}
                                                isFirst={index === 0}
                                                isLast={index === items.length - 1}
                                                isClosing={isClosing}
                                                isFocusVisible={selectionState.isFocusVisible}
                                                isSelected={selectionState.index === index}
                                                action={item.action}
                                                onPress={item.onPress}
                                            />
                                        );
                                    }
                                    case "Account": {
                                        return (
                                            <ContentEditorMentionFloaterAccountItem
                                                key={item.accountData.id}
                                                menuRef={menuRef}
                                                isFirst={index === 0}
                                                isLast={index === items.length - 1}
                                                isClosing={isClosing}
                                                isFocusVisible={selectionState.isFocusVisible}
                                                isSelected={selectionState.index === index}
                                                accountData={item.accountData}
                                                onPress={item.onPress}
                                            />
                                        );
                                    }
                                    case "SearchEntity": {
                                        return (
                                            <ContentEditorMentionFloaterSearchEntityResultItem
                                                key={item.entity.id}
                                                menuRef={menuRef}
                                                isFirst={index === 0}
                                                isLast={index === items.length - 1}
                                                isClosing={isClosing}
                                                isFocusVisible={selectionState.isFocusVisible}
                                                isSelected={selectionState.index === index}
                                                entity={item.entity}
                                                onPress={item.onPress}
                                            />
                                        );
                                    }
                                    default:
                                        throw exhaustive(item);
                                }
                            })}
                        </Fragment>
                    );
                })
            )}
        </>
    );

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
                <Box
                    data-testid="ContentEditorMentionFloater"
                    ref={mergedMenuRef}
                    position="relative"
                    width={Menu.sizeConstants.lg[platform].width}
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
                        maxHeight: platform === "mobile" ? spacing["48"] : spacing["96"],
                    }}
                >
                    <OverlayScopeContextProvider>{overlay}</OverlayScopeContextProvider>
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

function ContentEditorMentionFloaterItemBase({
    menuRef,
    isFirst,
    isLast,
    isSelected,
    isFocusVisible,
    isClosing,
    children,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isFocusVisible: boolean;
    isClosing: boolean;
    children: ReactNode | ((props: {isPressed: boolean}) => ReactNode);
    onPress: () => void;
}) {
    const spacingScale = useSpacingScale();

    const itemRef = useRef<HTMLDivElement>(null);

    const {isHovered, hoverProps} = useHover({});

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
                if (isFirst) {
                    menuElement.scrollTop = 0;
                } else {
                    menuElement.scrollTop = itemElement.offsetTop;
                }
            } else if (
                itemElement.offsetTop + itemElement.clientHeight >
                menuElement.scrollTop + menuElement.clientHeight
            ) {
                // Last item scrolls us all the way to the end.
                if (isLast) {
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
    }, [isFirst, isFocusVisible, isLast, isSelected, menuRef]);

    return (
        <FocusRing
            offset="inset"
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
                backgroundColor={isPressed ? "grey-10" : isHovered ? "grey-5" : undefined}
                style={{
                    minHeight:
                        contentStyles.paragraphLineHeightPx[spacingScale] +
                        convertRemLengthToPx("1.5", spacingScale) * 2,
                }}
            >
                {typeof children === "function" ? children({isPressed}) : children}
            </Box>
        </FocusRing>
    );
}

function ContentEditorMentionFloaterAccountItem({
    menuRef,
    isFirst,
    isLast,
    isSelected,
    isFocusVisible,
    isClosing,
    accountData,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isFocusVisible: boolean;
    isClosing: boolean;
    accountData: AccountModelData;
    onPress: () => void;
}) {
    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isFocusVisible={isFocusVisible}
            isClosing={isClosing}
            onPress={onPress}
        >
            <AccountAvatar account={accountData} size="5" />
            <Box paddingLeft="2" fontStyle="truncate">
                {accountData.name}
            </Box>
        </ContentEditorMentionFloaterItemBase>
    );
}

function ContentEditorMentionFloaterSearchEntityResultItem({
    menuRef,
    isFirst,
    isLast,
    isSelected,
    isFocusVisible,
    isClosing,
    entity,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isFocusVisible: boolean;
    isClosing: boolean;
    entity: SearchEntityModel;
    onPress: () => void;
}) {
    const spacingScale = useSpacingScale();

    const entityData = useSearchEntityModel(entity);

    const typeDisplay = useMemo(() => getSearchEntityTypeDisplay(entity.id), [entity.id]);

    const fontSize = "75";

    const lineHeightPx = fontSizesBySpacingScale[fontSize][spacingScale].fontSize * 1.5;

    const paddingYPx = (searchEntityViewTitleLineHeightPx[spacingScale] - lineHeightPx) / 2;

    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isFocusVisible={isFocusVisible}
            isClosing={isClosing}
            onPress={onPress}
        >
            <Box display="flex" alignItems="flex-start">
                <SearchEntityViewTitlePrefix
                    icon={typeDisplay.icon}
                    media={entityData.media}
                    isDeleted={entityData.title === null}
                />
                <Box
                    fontSize={fontSize}
                    overflow="hidden"
                    style={{
                        lineHeight: `${lineHeightPx}px`,
                        paddingTop: paddingYPx,
                        paddingBottom: paddingYPx,
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
                        // eslint-disable-next-line string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                >
                    {entityData.media?.type === "Account" && typeDisplay.isAccountMediaAuthor && (
                        <>
                            <AccountShortName
                                account={entityData.media.account}
                                isTooltipDisabled={true}
                            />
                            {typeDisplay.type === "Post" ? " " : ": "}
                        </>
                    )}
                    {entityData.title !== null
                        ? renderTextWithEmojiFontFamily(entityData.title)
                        : isSearchDynamicEntityType(typeDisplay.type)
                          ? // If `title` is null then we assume the entity was deleted. Otherwise, all
                            // mentionable entities should have a non-null title.
                            `${deletedSearchEntityTitle} ${getSearchEntityNoun(typeDisplay.type)}`
                          : null}
                </Box>
            </Box>
        </ContentEditorMentionFloaterItemBase>
    );
}

function ContentEditorMentionFloaterInsertItem({
    menuRef,
    isFirst,
    isLast,
    isSelected,
    isFocusVisible,
    isClosing,
    action,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isFocusVisible: boolean;
    isClosing: boolean;
    action: ContentEditorInsertMenuAction;
    onPress: () => void;
}) {
    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isFocusVisible={isFocusVisible}
            isClosing={isClosing}
            onPress={onPress}
        >
            {({isPressed}) => (
                <>
                    <IconContext.Provider
                        value={{
                            color: isPressed
                                ? colorSchemeVars["grey-100"]
                                : colorSchemeVars["grey-80"],
                            size: spacing["4"],
                            weight: "regular",
                        }}
                    >
                        {action.icon}
                    </IconContext.Provider>
                    <Box paddingLeft="2" fontStyle="truncate">
                        {action.label}
                    </Box>
                </>
            )}
        </ContentEditorMentionFloaterItemBase>
    );
}
