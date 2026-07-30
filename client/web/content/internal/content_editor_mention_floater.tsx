import {Modality, getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import _Fuse from "fuse.js";
import {CalendarBlank, IconContext, MagnifyingGlass, SpinnerGap} from "phosphor-react";
import {EditorState, NodeSelection, Selection, TextSelection} from "prosemirror-state";
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
import {FileInfoWithEntity} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {useSearchMentionState} from "~/client/web/content/internal/use_search_mention_state.js";
import {
    rememberContentEditorPosWhileLoading,
    setContentEditorQuickUndo,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Menu} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useConstant} from "~/client/web/helpers/lifecycle/use_constant.js";
import {useEvent, useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {renderTextWithEmojiFontFamily} from "~/client/web/helpers/render_text_with_emoji_font_family.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {
    useSearchEntityModel,
    useSearchEntityRegistry,
} from "~/client/web/search/core/search_entity_registry_context.js";
import {SearchEntityViewTitlePrefix} from "~/client/web/search/core/search_entity_view_title.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {searchEntityViewTitleLineHeightPx} from "~/client/web/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {formatContentDateString} from "~/shared/content/content_date_helpers.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {formatContentDateAbsolute} from "~/shared/content/format_content_date.js";
import {getContentDateSuggestions} from "~/shared/content/get_content_date_suggestions.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {FileEntityId, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {filterIterable} from "~/shared/helpers/iterable/filter_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";
import {getFileEntityIfPossible} from "~/shared/rpc/files_rpc_definitions.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {getAuthorFromSearchEntityIfExists} from "~/shared/search/get_author_from_search_entity_if_exists.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {deletedSearchEntityTitle} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchMentionEntityId,
    isSearchDynamicEntityType,
    isSearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {
    SearchEntityModel,
    SearchEntityModelData,
    SearchEntityModelDataWithAccount,
    printSearchEntityModelId,
} from "~/shared/search/search_entity_model.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {hasDatePickerFeature} from "~/shared/spaces/has_date_picker_feature.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

const maxAccountCount = 5;

/**
 * If we have a Fuse.js score below this when parsing a name then we consider the
 * name a match.
 *
 * We maintain a stricter score cutoff than Fuse.js since it would be odd to show
 * fuse matched items with very few similar characters next to results from our
 * search backend.
 */
const fuseScoreMatchCutoff = 0.35;

/**
 * The order of sections in the mention menu when there's no search query.
 *
 * When there is a search query insert is always first (the other sections follow
 * the same order).
 */
export type ContentEditorMentionFloaterSectionOrder =
    | "PeopleSuggestedInsert"
    | "InsertSuggestedPeople"
    | "SuggestedInsertPeople";

export function ContentEditorMentionFloater({
    state,
    viewRef,
    range,
    searchQuery,
    handleKeyDownRef,
    handleKeyUpRef,
    isFocused,
    isClosing,
    sectionOrder,
    onCloseWithoutAnimation: onCloseWithoutAnimationFromProps,
    onCloseWithAnimation: onCloseWithAnimationFromProps,
    onPasteOrDropFiles,
    onOpenGifPicker,
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
    handleKeyUpRef: RefObject<((event: KeyboardEvent) => void) | null>;
    isFocused: boolean;
    isClosing: boolean;
    sectionOrder: ContentEditorMentionFloaterSectionOrder;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
    // Optional callback to handle file entities when the content doesn't support file
    // nodes (e.g. message inputs that support file attachments but not inline file
    // previews).
    onPasteOrDropFiles?: (
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ) => SafeFloatingPromise<void>;
    onOpenGifPicker?: () => void;
}) {
    const platform = usePlatform();
    const context = useAppContext();
    const reporter = useReporter();
    const {space, currentAccount} = useSpaceContext();
    const isDatePickerDisabled =
        typeof window !== "undefined" && localStorage.getItem("disableDatePicker") === "true";
    const hasDatePickerUiFeature = !isDatePickerDisabled && hasDatePickerFeature(space.id);
    const searchEntityRegistry = useSearchEntityRegistry();

    const overlayRef = useRef<OverlayRef>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const mergedMenuRef = useMergedRefs(menuRef, useScrollbar());

    // Track which search entity is pending when inserting a file entity preview.
    const [pendingEntityId, setPendingEntityId] = useState<SearchMentionEntityId | null>(null);

    const tryToSaveSearchEntityMentionAsFileEntity = (
        insertFileEntityId: FileEntityId & SearchMentionEntityId,
    ) => {
        const view = assertExists(viewRef.current);
        const schema = view.state.schema;

        // If the schema doesn't support files (e.g. message content) then we don't want to
        // insert a file entity preview. But if there's an `onAttachFileEntity` callback
        // (message inputs) we want to call that.
        if (!schema.nodes.fileRow || !schema.nodes.file) {
            if (!onPasteOrDropFiles) return false;

            // Set pending state for async operation
            setPendingEntityId(insertFileEntityId);

            // Attach file to input (e.g. message inputs that don't support file nodes)
            onPasteOrDropFiles([
                {
                    type: "AttachFileEntity",
                    spaceId: space.id,
                    fileEntityId: insertFileEntityId,
                },
            ]).then(
                () => {
                    // Clear the mention text from the editor
                    const transaction = view.state.tr.delete(range.from, range.to);
                    view.dispatch(transaction);

                    onCloseWithoutAnimation();
                },
                error => {
                    // We only call `setPendingEntityId(null)` on error since on success we close the
                    // mention floater (so the state is implicitly cleared).
                    setPendingEntityId(null);

                    const entityIdObject = parseSearchMentionEntityId(insertFileEntityId);
                    reporter.displayError(
                        `Couldn\u2019t add ${getSearchEntityNoun(entityIdObject.type)}`,
                        error,
                    );
                },
            );

            // We kicked of a promise that will insert the file entity.
            return true;
        }

        const $from = view.state.doc.resolve(range.from);
        const paragraphStart = $from.before();

        // Set pending state for async operation
        setPendingEntityId(insertFileEntityId);

        // Start loading the file entity data
        const promise = getFileEntityIfPossible(context, {
            spaceId: space.id,
            fileEntityId: insertFileEntityId,
        });

        const finalPromise = promise
            .then(({fileEntityResult}) => {
                const paragraphStart = assertExists(getPos());

                // Find the paragraph end from the mapped start position
                const $paragraphStart = view.state.doc.resolve(paragraphStart);
                const paragraphNode = $paragraphStart.nodeAfter;
                if (!paragraphNode || paragraphNode.type.name !== "paragraph") return;

                const paragraphEnd = paragraphStart + paragraphNode.nodeSize;

                // Create the file row node
                const fileRowNode = (
                    $paragraphStart.parent.type.name === "tableCell"
                        ? schema.nodes.fileRowTable!
                        : schema.nodes.fileRow!
                ).create(null, [schema.nodes.file!.create({fileId: insertFileEntityId})]);

                const transaction = view.state.tr;

                transaction.replaceWith(paragraphStart, paragraphEnd, fileRowNode);

                // Make sure we select the file entity we just inserted.
                transaction.setSelection(
                    new NodeSelection(transaction.doc.resolve(paragraphStart + 1)),
                );

                // Replace the paragraph with the file row
                updateContentEditorReferences(transaction, {
                    type: "MergeBase",
                    references: {
                        ...emptyContentReferences,
                        fileEntityById: new Map([[insertFileEntityId, fileEntityResult]]),
                    },
                });

                view.dispatch(transaction);
            })
            .then(
                () => {
                    onCloseWithoutAnimation();
                },
                error => {
                    // We only call `setPendingEntityId(null)` on error since on success we close the
                    // mention floater (so the state is implicitly cleared).
                    setPendingEntityId(null);

                    const entityIdObject = parseSearchMentionEntityId(insertFileEntityId);
                    reporter.displayError(
                        `Couldn\u2019t add ${getSearchEntityNoun(entityIdObject.type)}`,
                        error,
                    );
                },
            );

        // Remember the paragraph position while loading
        const {getPos} = rememberContentEditorPosWhileLoading(view, paragraphStart, finalPromise);

        // We kicked of a promise that will insert the file entity.
        return true;
    };

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

            const accountShortName = getAccountShortNameWithoutFullNameTooltip(accountData);

            // If the account's short name is not ambiguous when searching all account names
            // then we will insert a short mention by default. The user can undo (cmd-z) to get
            // the long version of the mention.
            const isShortNameAmbiguous = allAccountsFuse
                ? allAccountsFuse
                      .search(accountShortName)
                      .filter(
                          result =>
                              !result.item.botId &&
                              (typeof result.score !== "number" || result.score < 0.25),
                      ).length > 1
                : true;

            const isBot = !!accountData.botId;

            const mention: ContentMention = {
                type: "Account",
                accountId: accountData.id,
                // Only use short name for a non-ambiguous name on desktop. Since on mobile the
                // quick undo capability doesn't really exist. Instead the user may tap delete to
                // get a short name.
                isShort:
                    !isBot &&
                    platform !== "mobile" &&
                    !isShortNameAmbiguous &&
                    // Make sure the name can be shortened. If it can't be shortened then marking the
                    // mention as short can be confusing in other parts of our system.
                    accountShortName !== accountData.name,
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
            // Prevent double-clicks while loading
            if (pendingEntityId !== null) return;

            const searchEntityId = printSearchEntityModelId(entityData);
            assert(isSearchMentionEntityId(searchEntityId));

            const view = assertExists(viewRef.current);

            // Check if we should insert a file entity preview instead of an inline mention.
            // Conditions:
            //
            // 1. Entity supports file preview (isFileEntityId)
            // 2. Schema supports file nodes
            // 3. Range is in an empty paragraph (paragraph only contains `@` + search text)
            // 4. Paragraph is directly in doc or tableCell (not nested in other blocks)
            const insertFileEntityId: (FileEntityId & SearchMentionEntityId) | null = (() => {
                if (!isFileEntityId(searchEntityId)) return null;

                const $from = view.state.doc.resolve(range.from);
                const parentNode = $from.parent;

                // Check if we're in a paragraph directly in doc or tableCell
                if (parentNode.type.name !== "paragraph") return null;

                // Check if paragraph only contains the mention text (@ + search query) The @ is at
                // position 0 and the mention range covers the rest
                const isEmptyParagraph =
                    $from.parentOffset === 0 && // @ is at start of paragraph
                    parentNode.content.size === range.to - range.from; // paragraph only has mention text

                if (!isEmptyParagraph) return null;

                const grandParentNode = $from.node(-1);

                // Check if the paragraph can be replaced by a `fileRow`. (So that means we're in a
                // `doc` or `tableCell` node most likely.)
                if (
                    grandParentNode.type.name !== "doc" &&
                    grandParentNode.type.name !== "tableCell"
                ) {
                    return null;
                }

                return searchEntityId;
            })();

            if (
                insertFileEntityId !== null &&
                // If this function returns true then we inserted a file entity! (Or we kicked off
                // a promise that will insert a file entity.) If it returns false then we need to
                // insert an inline mention.
                tryToSaveSearchEntityMentionAsFileEntity(insertFileEntityId)
            ) {
                return;
            }

            // Default: insert inline mention
            const mention: ContentMention = {type: "SearchEntity", entityId: searchEntityId};

            const transaction = updateContentEditorReferences(
                view.state.tr.replaceRangeWith(
                    range.from,
                    range.to,
                    view.state.schema.node("mention", {mention}),
                ),
                {
                    type: "SetSearchEntity",
                    entityId: searchEntityId,
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
            // `flushSync()`. Since `flushSync()` can't be run in an effect we schedule a
            // microtask.
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

    // `searchQuery` is controlled by a prop. Make sure we keep the state internal to
    // keep `useSearchMentionState()` in sync with the `searchQuery` prop.
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

        // As a convenience, if we have "foo @divider bar" then we want to trim the space
        // at the start of " bar" when inserting our divider.
        if ($to.nodeAfter?.isText) {
            const newText = $to.nodeAfter.text!.trimStart();
            $to = view.state.doc.resolve($to.pos + ($to.nodeAfter.text!.length - newText.length));
        }

        // As a convenience, if we have "foo @divider bar" then we want to trim the space
        // at the end of "foo " when inserting our divider.
        if ($from.nodeBefore?.isText) {
            const newText = $from.nodeBefore.text!.trimEnd();
            $from = view.state.doc.resolve(
                $from.pos - ($from.nodeBefore.text!.length - newText.length),
            );
        }

        return TextSelection.between($from, $to);
    });

    const insertMenuActions = useMemo(
        () =>
            getContentEditorInsertMenuActions({
                schema: state.schema,
                viewRef,
                getSelection: getInsertMenuSelection,
                alwaysDeleteSelection: true,
                onOpenGifPicker,
            }).flat(),
        [getInsertMenuSelection, onOpenGifPicker, state.schema, viewRef],
    );

    const insertMenuActionsFuse = useMemo(() => {
        return new Fuse(insertMenuActions, {
            keys: ["label", "searchKeywords"],
            includeScore: true,
        });
    }, [insertMenuActions]);

    // Date suggestions use exact prefix matching (no fuzzy) and are computed
    // separately from the Fuse.js insert action search.
    const currentDate = useCurrentDate();
    const todayString = useMemo(
        () => formatContentDateString(currentDate.year, currentDate.month, currentDate.day),
        [currentDate.day, currentDate.month, currentDate.year],
    );

    const dateSuggestionActions: ReadonlyArray<ContentEditorInsertMenuAction> = useMemo(() => {
        if (!hasDatePickerUiFeature || searchMentionOutput.queryText.length === 0) {
            return emptyArray;
        }

        const suggestions = getContentDateSuggestions(searchMentionOutput.queryText, todayString);
        return suggestions.map(suggestion => ({
            label: suggestion.label,
            icon: <CalendarBlank />,
            isSuggestedInMentionFloater: false,
            onPress: () => {
                const view = assertExists(viewRef.current);
                const absoluteDateText = formatContentDateAbsolute(suggestion.dateString);

                const $to = view.state.doc.resolve(range.to);
                const $from = view.state.doc.resolve(range.from);
                const selection = TextSelection.between($from, $to);

                let tr = view.state.tr;
                tr = tr.setSelection(selection);
                tr = tr.replaceSelectionWith(view.state.schema.text(absoluteDateText), false);

                view.dispatch(tr.scrollIntoView());
            },
        }));
    }, [hasDatePickerUiFeature, range, searchMentionOutput.queryText, todayString, viewRef]);

    // We use `searchMentionOutput.queryText` for searching menu actions not the prop
    // `searchQuery`. That's because we want our menu action search result to update at
    // the same time as our entity mentions search result.
    const searchedInsertMenuActions = useMemo(() => {
        if (searchMentionOutput.queryText.length === 0) {
            return insertMenuActions.filter(action => action.isSuggestedInMentionFloater);
        }

        const fuseResults = filterMapArray(
            insertMenuActionsFuse.search(searchMentionOutput.queryText),
            ({item, score}) => {
                if (score! >= fuseScoreMatchCutoff) return;
                return item;
            },
        );

        // Prepend exact-match date suggestions before fuzzy results.
        if (dateSuggestionActions.length > 0) {
            return [...dateSuggestionActions, ...fuseResults];
        }
        return fuseResults;
    }, [
        dateSuggestionActions,
        insertMenuActions,
        insertMenuActionsFuse,
        searchMentionOutput.queryText,
    ]);

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
    // `searchQuery`. That's because we want our account search result to update at the
    // same time as our entity mentions search result.
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
                            accountData.space.state.type !== "Removed",
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
                    accountData1.space.state.type !== "Removed" &&
                    accountData2.space.state.type === "Removed"
                ) {
                    return -1;
                }

                if (
                    accountData1.space.state.type === "Removed" &&
                    accountData2.space.state.type !== "Removed"
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
        const hasSearchQuery = searchMentionOutput.queryText.length > 0;

        const itemSections: Array<{
            title: string;
            items: ReadonlyArray<Item>;
        }> = [];

        const insertSection = hasSearchedInsertMenuActions
            ? {
                  title: "Insert",
                  items: searchedInsertMenuActions.map(action => ({
                      type: "Insert" as const,
                      action,
                      onPress: action.onPress,
                  })),
              }
            : null;

        const peopleSection = hasSearchedAccountDatas
            ? {
                  title: "People",
                  items: searchedAccountDatas.map(accountData => ({
                      type: "Account" as const,
                      accountData,
                      onPress: () => saveAccountMention(accountData),
                  })),
              }
            : null;

        const suggestedSection = hasSearchMentionResults
            ? {
                  title: hasSearchQuery ? "Other" : "Suggested",
                  items: searchMentionOutput.results.map(result => ({
                      type: "SearchEntity" as const,
                      entity: result.model,
                      onPress: () =>
                          saveSearchEntityMention(
                              searchEntityRegistry.getEntityStore(result.model).getSnapshot(),
                          ),
                  })),
              }
            : null;

        switch (sectionOrder) {
            case "PeopleSuggestedInsert": {
                if (!hasSearchQuery) {
                    if (peopleSection) itemSections.push(peopleSection);
                    if (suggestedSection) itemSections.push(suggestedSection);
                    if (insertSection) itemSections.push(insertSection);
                } else {
                    // If there's a search query, put the insert section first. Since insert matches
                    // are near exact matches.
                    if (insertSection) itemSections.push(insertSection);

                    if (peopleSection) itemSections.push(peopleSection);
                    if (suggestedSection) itemSections.push(suggestedSection);
                }
                break;
            }
            case "InsertSuggestedPeople": {
                if (insertSection) itemSections.push(insertSection);
                if (suggestedSection) itemSections.push(suggestedSection);
                if (peopleSection) itemSections.push(peopleSection);
                break;
            }
            case "SuggestedInsertPeople": {
                if (!hasSearchQuery) {
                    if (suggestedSection) itemSections.push(suggestedSection);
                    if (insertSection) itemSections.push(insertSection);
                    if (peopleSection) itemSections.push(peopleSection);
                } else {
                    // If there's a search query, put the insert section first. Since insert matches
                    // are near exact matches.
                    if (insertSection) itemSections.push(insertSection);

                    if (suggestedSection) itemSections.push(suggestedSection);
                    if (peopleSection) itemSections.push(peopleSection);
                }
                break;
            }
            default:
                throw exhaustive(sectionOrder);
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
        sectionOrder,
    ]);

    const items = useMemo(() => itemSections.flatMap(section => section.items), [itemSections]);

    const [actualSelectionState, setSelectionState] = useState<
        | {searchKey: string; index: null; isPressedFromKeyboard: false}
        | {searchKey: string; index: number; isPressedFromKeyboard: boolean}
    >({
        searchKey: searchMentionOutput.key,
        index: null,
        isPressedFromKeyboard: false,
    });

    const selectionState =
        actualSelectionState.searchKey !== searchMentionOutput.key ||
        (actualSelectionState.index !== null && actualSelectionState.index >= items.length)
            ? {
                  searchKey: searchMentionOutput.key,
                  // Automatically select the first item if the user has started typing a search
                  // query and there's at least one item.
                  index: searchMentionOutput.queryText.length > 0 && items.length > 0 ? 0 : null,
                  isPressedFromKeyboard: false as const,
              }
            : actualSelectionState;

    if (selectionState !== actualSelectionState) setSelectionState(selectionState);

    const hasSelection: boolean = selectionState.index !== null;

    const originalInteractionModalityRef = useRef<Modality | null>(null);

    // When we lose our selection (usually because we unmounted) return the interaction
    // modality to whatever it was before we started keyboard navigating.
    //
    // When this component loses its selection (or unmounts) restore interaction
    // modality to whatever it was before we set it to `keyboard`. While editing, the
    // user may hit @ to mention then arrow keys to select an account. Only keep them
    // in `keyboard` interaction modality if that's the state they were previously in.
    // Since keyboard navigation within this component is a pretty common pattern even
    // for a user that predominantly uses `pointer` navigation. Showing focus rings for
    // new elements the user focuses (e.g. the link input when the user hits Cmd+K)
    // will likely confuse them since they didn't intend to enter keyboard navigation
    // mode.
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
            // Moves focus to the next item, optionally wrapping from the last to the first.
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
                        isPressedFromKeyboard: false,
                    });
                }
                break;
            }
            // Moves focus to the previous item, optionally wrapping from the first to the
            // last.
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
                        isPressedFromKeyboard: false,
                    });
                }
                break;
            }
            // Moves focus to the first item in the current menu. Technically, the spec says
            // only implement if arrow key wrapping is not supported but it's easy to support
            // so why not.
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
                        isPressedFromKeyboard: false,
                    });
                }
                break;
            }
            // Moves focus to the last item in the current menu. Technically, the spec says
            // only implement if arrow key wrapping is not supported but it's easy to support
            // so why not.
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
                        isPressedFromKeyboard: false,
                    });
                }
                break;
            }
            // Escape closes the menu with focus and returns focus to the context the menu was
            // opened. Given focus always stays in the content editor we just close the
            // floater.
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

                setSelectionState({
                    searchKey: selectionState.searchKey,
                    index: selectionState.index,
                    isPressedFromKeyboard: true,
                });
                break;
            }
        }
    });

    useImperativeHandle(handleKeyUpRef, () => event => {
        switch (event.key) {
            // When focus is on an item activate the item and close the menu.
            //
            // Space may also do this in the menu ARIA pattern but because we are in a text
            // editor, space inserts...well...a space.
            //
            // https://www.w3.org/WAI/ARIA/apg/patterns/menubar/
            case "Enter": {
                event.preventDefault();
                event.stopPropagation();

                if (selectionState.index !== null && selectionState.isPressedFromKeyboard) {
                    items[selectionState.index]!.onPress();
                }
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

    // Suppress hover styles until the pointer moves. That way if the user's pointer
    // just happens to be over the mention floater while they're typing it doesn't
    // appear like you're about to select the item the pointer is coincidentally
    // hovering over.
    const [suppressHover, setSuppressHover] = useState(true);

    useEffect(() => {
        // Wait until we're done loading to unsuppress hover styles.
        if (isLoading && !shouldShowLoadingIndicatorIfLoading) return;

        // Hovering has been unsuppressed! We don't need to listen for `pointermove` events
        // anymore.
        if (!suppressHover) return;

        const handlePointerMove = () => {
            setSuppressHover(false);
        };

        document.addEventListener("pointermove", handlePointerMove, true);
        return () => {
            document.removeEventListener("pointermove", handlePointerMove, true);
        };
    }, [isLoading, shouldShowLoadingIndicatorIfLoading, suppressHover]);

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
                                                isSelected={selectionState.index === index}
                                                isPressedFromKeyboard={
                                                    selectionState.index === index &&
                                                    selectionState.isPressedFromKeyboard
                                                }
                                                suppressHover={suppressHover}
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
                                                isSelected={selectionState.index === index}
                                                isPressedFromKeyboard={
                                                    selectionState.index === index &&
                                                    selectionState.isPressedFromKeyboard
                                                }
                                                suppressHover={suppressHover}
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
                                                isSelected={selectionState.index === index}
                                                isPending={pendingEntityId === item.entity.id}
                                                isPressedFromKeyboard={
                                                    selectionState.index === index &&
                                                    selectionState.isPressedFromKeyboard
                                                }
                                                suppressHover={suppressHover}
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
            // Set a constant `overflowBottom` value instead of relying on the current keyboard
            // height (which will be updated asynchronously after `isEditing` is true). This
            // stops the overlay placement from jumping around while the keyboard opens. The
            // value was calculated based on the keyboard height in iOS. We may need to change
            // this constant if the keyboard height for iOS changes or the Android keyboard
            // height is bigger.
            overflowBottom={platform === "mobile" ? "18rem" : undefined}
            offset="2.5"
            overlay={
                <Box
                    data-testid="ContentEditorMentionFloater"
                    ref={mergedMenuRef}
                    position="relative"
                    width={Menu.sizeConstants.lg[platform].width}
                    // Hide the scrollbar while animating closed by setting overflow to `hidden` while
                    // animating.
                    overflowX="hidden"
                    overflowY={!isClosing ? "auto" : "hidden"}
                    borderRadius="1.5"
                    padding="1"
                    className={greyElevated2ClassName}
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    style={{
                        // On mobile the height needs to be less than half of the available space when the
                        // keyboard and navigation bar are open.
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
    isClosing,
    isPressedFromKeyboard,
    suppressHover,
    children,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isClosing: boolean;
    isPressedFromKeyboard: boolean;
    suppressHover: boolean;
    children: ReactNode | ((props: {isPressed: boolean}) => ReactNode);
    onPress: () => void;
}) {
    const spacingScale = useSpacingScale();

    const itemRef = useRef<HTMLDivElement>(null);

    const {isHovered: isHoveredFromState, hoverProps} = useHover({});

    const isHovered = isHoveredFromState && !suppressHover;

    const {isPressed: isPressedFromState, pressProps} = usePress({
        onPress,
    });

    // Combine press state from usePress hook and keyboard shortcut
    const isPressed = isPressedFromState || isPressedFromKeyboard;

    // Scroll our item into view when it is focused using the keyboard. We manually
    // implement scrolling since `scrollIntoView()` has weird behavior.
    const wasScrolledInRef = useRef(false);
    useLayoutEffect(() => {
        const run = () => {
            const menuElement = assertExists(menuRef.current);
            const itemElement = assertExists(itemRef.current);
            assert(itemElement.offsetParent === menuElement);

            if (!isSelected) {
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
    }, [isFirst, isLast, isSelected, menuRef]);

    return (
        <FocusRing
            offset="inset"
            isVisible={isSelected && !isClosing}
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
    isClosing,
    isPressedFromKeyboard,
    accountData,
    suppressHover,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isClosing: boolean;
    isPressedFromKeyboard: boolean;
    accountData: AccountModelData;
    suppressHover: boolean;
    onPress: () => void;
}) {
    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isClosing={isClosing}
            isPressedFromKeyboard={isPressedFromKeyboard}
            suppressHover={suppressHover}
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
    isClosing,
    isPending,
    isPressedFromKeyboard,
    suppressHover,
    entity,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isClosing: boolean;
    isPending: boolean;
    isPressedFromKeyboard: boolean;
    suppressHover: boolean;
    entity: SearchEntityModel;
    onPress: () => void;
}) {
    const spacingScale = useSpacingScale();

    const entityData = useSearchEntityModel(entity);

    const fontSize = "75";

    const lineHeightPx = fontSizesBySpacingScale[fontSize][spacingScale].fontSize * 1.5;

    const paddingYPx = (searchEntityViewTitleLineHeightPx[spacingScale] - lineHeightPx) / 2;

    // Delay showing the spinner to avoid flicker for fast operations.
    const shouldShowPendingSpinner = useDelayLoadingIndicator(isPending);

    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isClosing={isClosing}
            isPressedFromKeyboard={isPressedFromKeyboard}
            suppressHover={suppressHover}
            onPress={onPress}
        >
            <Box display="flex" alignItems="flex-start" width="full">
                <SearchEntityViewTitlePrefix
                    entityData={entityData}
                    isDeleted={entityData.title === null}
                />
                <Box
                    fontSize={fontSize}
                    overflow="hidden"
                    flexGrow="1"
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
                        // eslint-disable-next-line cyberworlds/string-quotes
                        fontFeatureSettings: '"calt" on',
                    }}
                >
                    {renderAuthorShortNameIfNecessary(entityData)}
                    {entityData.title !== null
                        ? renderTextWithEmojiFontFamily(entityData.title)
                        : isSearchDynamicEntityType(entityData.type)
                          ? // If `title` is null then we assume the entity was deleted. Otherwise, all
                            // mentionable entities should have a non-null title.
                            `${deletedSearchEntityTitle} ${getSearchEntityNoun(entityData.type)}`
                          : null}
                </Box>
                {shouldShowPendingSpinner && (
                    <Box
                        display="flex"
                        alignItems="center"
                        paddingLeft="2"
                        style={{height: searchEntityViewTitleLineHeightPx[spacingScale]}}
                    >
                        <SpinnerGap
                            className={spinAnimationClassName}
                            size={spacing["4"]}
                            color={colorSchemeVars["grey-70"]}
                        />
                    </Box>
                )}
            </Box>
        </ContentEditorMentionFloaterItemBase>
    );
}

function ContentEditorMentionFloaterInsertItem({
    menuRef,
    isFirst,
    isLast,
    isSelected,
    isClosing,
    isPressedFromKeyboard,
    action,
    suppressHover,
    onPress,
}: {
    menuRef: RefObject<HTMLDivElement | null>;
    isFirst: boolean;
    isLast: boolean;
    isSelected: boolean;
    isClosing: boolean;
    isPressedFromKeyboard: boolean;
    action: ContentEditorInsertMenuAction;
    suppressHover: boolean;
    onPress: () => void;
}) {
    return (
        <ContentEditorMentionFloaterItemBase
            menuRef={menuRef}
            isFirst={isFirst}
            isLast={isLast}
            isSelected={isSelected}
            isClosing={isClosing}
            isPressedFromKeyboard={isPressedFromKeyboard}
            suppressHover={suppressHover}
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

function renderAuthorShortNameIfNecessary(entityData: SearchEntityModelDataWithAccount) {
    if (entityData.type === "Account") return null;

    const author = getAuthorFromSearchEntityIfExists(entityData);
    if (!author) return null;

    return (
        <>
            <AccountShortName account={author} isTooltipDisabled={true} />
            {entityData.type === "Post" ? " " : ": "}
        </>
    );
}
