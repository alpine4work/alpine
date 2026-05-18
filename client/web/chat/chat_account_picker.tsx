import {
    getInteractionModality,
    isFocusVisible,
    setInteractionModality,
    usePress,
} from "@react-aria/interactions";
import {Node} from "@react-types/shared";
import classNames from "classnames";
import _Fuse from "fuse.js";
import {CaretDown, MagnifyingGlass, SpinnerGap, X} from "phosphor-react";
import {
    Dispatch,
    KeyboardEvent,
    ReactNode,
    RefObject,
    SetStateAction,
    cloneElement,
    createRef,
    isValidElement,
    useEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {AriaListBoxOptions, useComboBox, useListBox, useOption} from "react-aria";
import {ComboBoxState, ComboBoxStateOptions, Item, useComboBoxState} from "react-stately";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    fontSizes,
    overlayFadeInAnimationDurationMs,
    overlayFadeOutAnimationDurationMs,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ChatModel} from "~/shared/chat/chat_model.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    addRemLengths,
    parseRemLength,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {assertId} from "~/shared/id/id.js";
import {AccountId, ChatId} from "~/shared/id/types/id_types.js";
import {getChat} from "~/shared/rpc/chat_rpc_definitions.js";
import {searchByAffinity, searchRoomChatsByKeywords} from "~/shared/rpc/search_rpc_definitions.js";
import {expensivelyGetAllSpaceAccounts} from "~/shared/rpc/spaces_rpc_definitions.js";
import {parseSearchAffinityEntityId} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";

// Node.js ESM interop (#node-esm-migration)
const Fuse = typeof _Fuse === "function" ? _Fuse : _Fuse.default;

export type ChatAccountPickerSelectionState =
    | {readonly type: "Accounts"; readonly accounts: ReadonlyArray<AccountModel>}
    | {readonly type: "RoomChat"; readonly id: ChatId; readonly name: string};

type ChatAccountPickerItem =
    | {
          readonly type: "Account";
          readonly key: `Account:${AccountId}`;
          readonly textValue: string;
          readonly accountData: AccountModelData;
      }
    | {
          readonly type: "SuggestedDirectChat";
          readonly key: `Chat:${ChatId}`;
          readonly textValue: string;
          readonly chat: ChatModel;
          readonly otherAccountDatas: ReadonlyArray<AccountModelData>;
      }
    | {
          // Could either be a direct chat or a room chat. We're not sure!
          readonly type: "SearchUnknownChat";
          readonly key: `Chat:${ChatId}`;
          readonly textValue: string;
          readonly media:
              | {
                    readonly type: "Account";
                    readonly accountData: AccountModelData;
                }
              | {
                    readonly type: "AccountPile";
                    readonly previewAccountDatas: ReadonlyArray<AccountModelData>;
                    readonly accountCount: number | null;
                }
              | null;
      };

function createChatAccountPickerSearchUnknownChatItemStore(
    get: <Value>(store: Store<Value>) => Value,
    accountRegistry: AccountRegistry,
    searchEntityRegistry: SearchEntityRegistry,
    entityModel: SearchEntityModel,
): ChatAccountPickerItem {
    const entity = get(searchEntityRegistry.getEntityStore(entityModel));

    assert(entity.type === "Chat");
    const chat = entity.chat;
    return {
        type: "SearchUnknownChat",
        key: `Chat:${chat.id}`,
        textValue: entity.title ?? "Unknown chat",
        media: (() => {
            if (chat.media.type === "Account") {
                const accountData = get(accountRegistry.getAccountStore(chat.media.account));

                return {type: "Account", accountData};
            }

            if (chat.media.type === "AccountPile") {
                const previewAccountDatas = chat.media.previewAccounts.map(account =>
                    get(accountRegistry.getAccountStore(account)),
                );

                return {
                    type: "AccountPile",
                    previewAccountDatas,
                    accountCount: chat.media.accountCount,
                };
            }

            return null;
        })(),
    };
}

/**
 * Limit of search results we'll fetch on the client. We don't lazy load more when
 * the user scrolls, instead the user needs to narrow their search.
 *
 * This is enough to give the user some choice while they scroll while not using
 * too many resources.
 */
const searchRoomChatsByKeywordsLimit = 20;

function useChatAccountPickerItems({
    loaderSelectedChatId,
    selectionState,
    suggestedChats,
    searchQuery,
    isComboBoxOpen,
}: {
    loaderSelectedChatId: ChatId | null;
    selectionState: ChatAccountPickerSelectionState;
    suggestedChats: ReadonlyArray<ChatModel>;
    searchQuery: string;
    isComboBoxOpen: boolean;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const {space, currentAccount} = useSpaceContext();

    const selectedAccounts =
        selectionState.type === "Accounts" ? selectionState.accounts : emptyArray;

    const selectedAccountDatas = useStore(
        useMemo(
            () =>
                Store.mapMany(
                    selectedAccounts.map(account => accountRegistry.getAccountStore(account)),
                    accounts => accounts,
                ),
            [accountRegistry, selectedAccounts],
        ),
    );

    const selectedItems = useMemo((): ReadonlyArray<
        | {type: "Account"; accountData: AccountModelData}
        | {type: "RoomChat"; id: ChatId; name: string}
    > => {
        if (selectionState.type === "Accounts") {
            return selectedAccountDatas.map(accountData => ({type: "Account", accountData}));
        } else {
            return [{type: "RoomChat", id: selectionState.id, name: selectionState.name}];
        }
    }, [selectedAccountDatas, selectionState]);

    const {isLoading: isLoadingAllAccounts, output: allAccountsOutput} = useLazyLoadRpc(
        expensivelyGetAllSpaceAccounts,
        selectedItems.length === 0 || isComboBoxOpen ? {spaceId: space.id} : null,
    );

    const allAccounts = allAccountsOutput?.accounts ?? emptyArray;

    const {isLoading: isLoadingSearchByAffinity, output: searchByAffinityOutput} = useLazyLoadRpc(
        searchByAffinity,
        selectedItems.length === 0 || isComboBoxOpen ? {spaceId: space.id} : null,
    );

    const isLoadingInitialItems = isLoadingAllAccounts || isLoadingSearchByAffinity;

    const selectedAccountIds = useMemo(
        () => new Set(mapIterable(selectedAccounts, account => account.id)),
        [selectedAccounts],
    );

    const trimmedSearchQuery = searchQuery.trim();

    const [currentlyLoadingSearchQuery, setCurrentlyLoadingSearchQuery] =
        useState<string>(trimmedSearchQuery);

    const {isLoading: originalIsSearchLoading, output: searchByKeywordsOutput} = useLazyLoadRpc(
        searchRoomChatsByKeywords,
        (selectedItems.length === 0 || isComboBoxOpen) && currentlyLoadingSearchQuery.length > 0
            ? {
                  spaceId: space.id,
                  limit: searchRoomChatsByKeywordsLimit,
                  queryText: currentlyLoadingSearchQuery,
                  contributorIds: selectedAccountIds,
              }
            : null,
        {keepPreviousData: true},
    );

    let isSearchLoading = originalIsSearchLoading;

    // Throttle our RPC call. Only load search results for a new input value after
    // we're done loading search results for the old one.
    if (!isSearchLoading && currentlyLoadingSearchQuery !== trimmedSearchQuery) {
        isSearchLoading = true;
        setCurrentlyLoadingSearchQuery(trimmedSearchQuery);
    }

    const shouldShowSearchLoadingIndicator = useDelayLoadingIndicator(isSearchLoading);

    // We sort locally by the search query that corresponds to
    // `searchByKeywordsOutput`.
    const activeSearchQuery = searchByKeywordsOutput?.input.queryText ?? "";

    const allItemsStore = useMemo(() => {
        const itemStores: Array<Store<ChatAccountPickerItem>> = [];

        const seenDirectChatIds = new Set<ChatId>();

        for (const chat of suggestedChats) {
            if (chat.definition.type !== "Direct") continue;

            seenDirectChatIds.add(chat.id);

            const chatAccounts = chat.definition.accounts;
            assert(chatAccounts.length > 0);

            const otherAccounts = chatAccounts.filter(account => account.id !== currentAccount?.id);

            itemStores.push(
                Store.mapMany(
                    otherAccounts.map(account => accountRegistry.getAccountStore(account)),
                    (otherAccountDatas): ChatAccountPickerItem => {
                        const sortedOtherAccountDatas = Array.from(otherAccountDatas);

                        // Selected accounts go to the end. We should prefer showing accounts that haven't
                        // been selected yet.
                        sortedOtherAccountDatas.sort((a, b) => {
                            if (selectedAccountIds.has(a.id) && selectedAccountIds.has(b.id))
                                return 0;
                            if (selectedAccountIds.has(a.id)) return 1;
                            if (selectedAccountIds.has(b.id)) return -1;
                            return 0;
                        });

                        const otherAccountNames = joinPrettyConjunctionList(
                            sortedOtherAccountDatas.map(accountData =>
                                getAccountShortNameWithoutFullNameTooltip(accountData),
                            ),
                        );

                        return {
                            type: "SuggestedDirectChat",
                            key: `Chat:${chat.id}`,
                            textValue: otherAccountNames,
                            chat,
                            otherAccountDatas: sortedOtherAccountDatas,
                        };
                    },
                ),
            );
        }

        for (const account of allAccounts) {
            itemStores.push(
                accountRegistry
                    .getAccountStore(account)
                    .map((accountData): ChatAccountPickerItem => {
                        return {
                            type: "Account",
                            key: `Account:${account.id}`,
                            textValue: accountData.name,
                            accountData,
                        };
                    }),
            );
        }

        const affinityScoreByKey = new Map<ChatAccountPickerItem["key"], number>();

        // Include chats from our affinity list. So the user can quickly select a chat they
        // have an affinity for.
        if (searchByAffinityOutput) {
            for (const result of concatIterables(
                searchByAffinityOutput.results,
                searchByAffinityOutput.favoriteResults,
            )) {
                if (result.id === "TaskPersonal") continue;

                const entityIdObject = parseSearchAffinityEntityId(result.id);

                switch (entityIdObject.type) {
                    case "Account": {
                        affinityScoreByKey.set(`Account:${entityIdObject.accountId}`, result.score);
                        break;
                    }
                    case "Chat": {
                        affinityScoreByKey.set(`Chat:${entityIdObject.chatId}`, result.score);

                        // If this direct chat was already in `suggestedChats` then don't include it again
                        // as an `UnknownChat`.
                        if (seenDirectChatIds.has(entityIdObject.chatId)) break;

                        itemStores.push(
                            computeStore(get => {
                                assert(result.model instanceof SearchEntityModel);

                                return createChatAccountPickerSearchUnknownChatItemStore(
                                    get,
                                    accountRegistry,
                                    searchEntityRegistry,
                                    result.model,
                                );
                            }),
                        );
                        break;
                    }
                }
            }
        }

        return Store.mapMany(itemStores, items =>
            items.slice().sort((item1, item2) => {
                // Suggested direct chats always go first. If you're typing in account names we
                // want to help you create a direct group chat.
                if (item1.type === "SuggestedDirectChat" && item2.type === "SuggestedDirectChat")
                    return 0;
                if (item1.type === "SuggestedDirectChat") return -1;
                if (item2.type === "SuggestedDirectChat") return 1;

                const score1 = affinityScoreByKey.get(item1.key);
                const score2 = affinityScoreByKey.get(item2.key);

                // If the item is in our affinity list then rank by score in the affinity list.
                // This makes sure accounts/chats are ranked next to each other properly.
                if (score1 !== undefined && score2 !== undefined) return score2 - score1;
                if (score1 !== undefined) return -1;
                if (score2 !== undefined) return 1;

                // Use the sort order from the server. The server returns accounts in affinity
                // order.
                return 0;
            }),
        );
    }, [
        accountRegistry,
        allAccounts,
        currentAccount?.id,
        searchByAffinityOutput,
        searchEntityRegistry,
        selectedAccountIds,
        suggestedChats,
    ]);

    const allItems = useStore(allItemsStore);

    // Remove items that match our selection. Items should help the user autocomplete.
    // Items that won't add to their selection are not useful.
    const itemsWithoutSelection = useMemo(() => {
        return allItems.filter(item => {
            switch (item.type) {
                // If an account has been selected, don't show it anymore.
                case "Account": {
                    return !selectedAccountIds.has(item.accountData.id);
                }
                // At least one account in the recommended chat should not already be selected for
                // it to show up.
                case "SuggestedDirectChat": {
                    return item.otherAccountDatas.some(
                        accountData => !selectedAccountIds.has(accountData.id),
                    );
                }
                case "SearchUnknownChat": {
                    // If this is the currently selected chat then filter it out. Otherwise, leave
                    // chats from `searchByAffinity` in even if it's a direct chat where all accounts
                    // are selected. Since it has a high affinity score, we think it's good to give the
                    // user a shortcut to return back to this chat.

                    if (loaderSelectedChatId && item.key === `Chat:${loaderSelectedChatId}`)
                        return false;

                    if (selectionState.type === "RoomChat" && item.key === `${selectionState.id}`)
                        return false;

                    return true;
                }
                default:
                    throw exhaustive(item);
            }
        });
    }, [allItems, loaderSelectedChatId, selectedAccountIds, selectionState]);

    const itemsSearchIndex = useMemo(
        () => new Fuse(itemsWithoutSelection, {includeScore: true, keys: ["textValue"]}),
        [itemsWithoutSelection],
    );

    const searchedItems = useStore(
        useMemo(() => {
            if (activeSearchQuery === "") {
                // Don't include removed accounts in the initial rendered account list.
                //
                // TODO(calebmer): When searching, removed accounts should rank lower. How do we
                // give them a lower score while still allowing users to find them?
                return new ConstStore(
                    itemsWithoutSelection.filter(
                        item =>
                            item.type !== "Account" ||
                            item.accountData.space.state.type === "Active" ||
                            item.accountData.space.state.type === "InvitePending",
                    ),
                );
            }

            const locallySearchedItems = itemsSearchIndex.search(activeSearchQuery);
            const locallySearchedItemsAboveThreshold: Array<ChatAccountPickerItem> = [];
            const locallySearchedItemsBelowThreshold: Array<ChatAccountPickerItem> = [];

            // Pick an arbitrary threshold at which locally searched items are rendered above
            // our `searchRoomChatsByKeywords` results and which locally searched items are
            // rendered below our `searchRoomChatsByKeywords` results.
            for (const {item, score} of locallySearchedItems) {
                if (score! >= 0.2) {
                    locallySearchedItemsBelowThreshold.push(item);
                } else {
                    locallySearchedItemsAboveThreshold.push(item);
                }
            }

            return computeStore(get => {
                const seenKeys = new Set<ChatAccountPickerItem["key"]>();

                const searchedItems: Array<ChatAccountPickerItem> = [];

                for (const item of locallySearchedItemsAboveThreshold) {
                    if (seenKeys.has(item.key)) continue;
                    seenKeys.add(item.key);
                    searchedItems.push(item);
                }

                if (searchByKeywordsOutput) {
                    for (const entity of searchByKeywordsOutput.results) {
                        const item = createChatAccountPickerSearchUnknownChatItemStore(
                            get,
                            accountRegistry,
                            searchEntityRegistry,
                            entity,
                        );

                        if (seenKeys.has(item.key)) continue;
                        seenKeys.add(item.key);
                        searchedItems.push(item);
                    }
                }

                for (const item of locallySearchedItemsBelowThreshold) {
                    if (seenKeys.has(item.key)) continue;
                    seenKeys.add(item.key);
                    searchedItems.push(item);
                }

                return searchedItems;
            });
        }, [
            accountRegistry,
            activeSearchQuery,
            itemsSearchIndex,
            itemsWithoutSelection,
            searchByKeywordsOutput,
            searchEntityRegistry,
        ]),
    );

    const searchedItemByKey = useMemo(() => {
        const searchedItemByKey = new Map<string, ChatAccountPickerItem>();

        for (const item of searchedItems) {
            searchedItemByKey.set(item.key, item);
        }

        return searchedItemByKey;
    }, [searchedItems]);

    return {
        selectedItems,
        searchedItems,
        searchedItemByKey,
        isLoadingInitialItems,
        shouldShowSearchLoadingIndicator,
    };
}

export function ChatAccountPicker({
    loaderSelectedChatId,
    selectionState,
    onUpdateSelectedAccounts,
    onSelectRoomChat,
    shouldShowPendingSpinner,
    suggestedChats,
    shouldInitiallyFocus,
    focusMessageInput,
}: {
    loaderSelectedChatId: ChatId | null;
    selectionState: ChatAccountPickerSelectionState;
    onUpdateSelectedAccounts: (
        update: (selectedAccounts: ReadonlyArray<AccountModel>) => ReadonlyArray<AccountModel>,
    ) => void;
    onSelectRoomChat: (roomChat: {id: ChatId; name: string} | null) => void;
    shouldShowPendingSpinner: boolean;
    suggestedChats: ReadonlyArray<ChatModel>;
    shouldInitiallyFocus: boolean;
    focusMessageInput: () => void;
}) {
    const context = useAppContext();
    const platform = usePlatform();
    const {currentAccount} = useSpaceContext();
    const reporter = useReporter();

    const inputRef = useRef<HTMLInputElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const listBoxRef = useRef<HTMLUListElement>(null);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const inputElement = assertExists(inputRef.current);

        if (!shouldInitiallyFocus) return;

        return scheduleAfterNavigationAnimation(() => {
            inputElement.focus();
        });
    }, [shouldInitiallyFocus]);

    const [isComboBoxOpen, setIsComboBoxOpen] = useState(false);

    const [{searchQuery, shouldCloseComboBox}, setSearchQuery] = useState<{
        searchQuery: string;
        shouldCloseComboBox: boolean;
    }>({searchQuery: "", shouldCloseComboBox: false});

    const {
        selectedItems,
        searchedItems,
        searchedItemByKey,
        isLoadingInitialItems,
        shouldShowSearchLoadingIndicator,
    } = useChatAccountPickerItems({
        loaderSelectedChatId,
        selectionState,
        suggestedChats,
        searchQuery,
        isComboBoxOpen,
    });

    const selectedItemsLength = selectedItems.length;
    const selectedItemRefs = useMemo(
        () => createArrayWithLength(selectedItemsLength, () => createRef<HTMLDivElement>()),
        [selectedItemsLength],
    );

    // When this is set to true we allow the next animation then no more animations.
    // Most interactions that control whether the picker is open/close are direct
    // interactions that shouldn't be animated.
    const [shouldOverlayAnimate, setShouldOverlayAnimate] = useState(false);
    useEffect(() => {
        if (!shouldOverlayAnimate) return;

        const timeout = createTimeout(
            () => {
                setShouldOverlayAnimate(false);
            },
            Math.max(overlayFadeInAnimationDurationMs, overlayFadeOutAnimationDurationMs),
        );
        return () => {
            timeout.clear();
        };
    }, [shouldOverlayAnimate]);

    const [pendingItemState, setPendingItemState] = useState<{
        key: string;
        abortController: AbortController;
    } | null>(null);

    // If the search changed such that the item is no longer visible or the combobox
    // has closed then cancel our request.
    if (pendingItemState && (!isComboBoxOpen || !searchedItemByKey.has(pendingItemState.key))) {
        pendingItemState.abortController.abort();
        setPendingItemState(null);
    }

    const comboBoxProps: ComboBoxStateOptions<ChatAccountPickerItem> = {
        // We need to know whether the combobox is open or not to decide whether we should
        // load accounts.
        onOpenChange: setIsComboBoxOpen,

        label: "To",
        menuTrigger: "manual",
        // Don't try to close on blur when there are no selected accounts since the
        // combobox should state open.
        shouldCloseOnBlur: selectedItems.length > 0,
        // Don't close when there are no items.
        allowsEmptyCollection: true,

        inputValue: searchQuery,
        onInputChange: searchQuery => {
            // Don't allow changing the query text while a room chat is selected. You're only
            // allowed to press backspace.
            if (selectionState.type === "RoomChat") return;

            setSearchQuery({searchQuery, shouldCloseComboBox: false});

            if (!comboBoxState.isOpen) {
                comboBoxState.open();
            }
        },

        items: searchedItems,
        children: item => (
            <Item textValue={item.textValue}>
                <ChatAccountPickerListBoxOptionItem item={item} />
            </Item>
        ),

        onFocus: () => {
            // Open the combobox on focus.
            if (selectionState.type !== "RoomChat") {
                comboBoxState.open();
            }
        },

        onBlur: event => {
            // Chrome dispatches a "fake" blur event when the user has an element focused but
            // then clicks on another window, focusing that window but leaving our current
            // window visible. `blur` is dispatched but `document.activeElement` doesn't
            // change!
            //
            // Detect this case. If we receive a `blur` event but `document.activeElement`
            // hasn't changed then escalate to a real blur.
            if (event.target === document.activeElement) {
                event.target.blur();
            }

            // Animate when the combobox loses focus. Losing focus is typically not a direct
            // user interaction. e.g. Clicking outside of the text box. Tabbing out of the text
            // box we consider an indirect interaction since the animation can highlight to the
            // user that their state is going away.
            setShouldOverlayAnimate(true);
        },

        // No key is ever selected by the combobox. Instead when a selection occurs we add
        // it to a list of selected values.
        selectedKey: null,
        onSelectionChange: key => {
            setSearchQuery({searchQuery: "", shouldCloseComboBox: true});

            // Abort any pending calls.
            if (pendingItemState) {
                pendingItemState.abortController.abort();
                setPendingItemState(null);
            }

            if (typeof key !== "string") return;

            const item = searchedItemByKey.get(key);
            if (!item) return;

            switch (item.type) {
                case "Account": {
                    onUpdateSelectedAccounts(selectedAccounts => {
                        const accountId = item.accountData.id;

                        // If the account already exists in the selection, don't add it a second time.
                        if (selectedAccounts.some(otherAccount => otherAccount.id === accountId)) {
                            return selectedAccounts;
                        }
                        return [...selectedAccounts, new AccountModel(item.accountData)];
                    });

                    comboBoxState.close();
                    break;
                }
                case "SuggestedDirectChat": {
                    onUpdateSelectedAccounts(selectedAccounts => {
                        const selectedAccountIds = new Set(
                            selectedAccounts.map(account => account.id),
                        );
                        if (item.chat.definition.type !== "Direct") return selectedAccounts;

                        return [
                            ...selectedAccounts,
                            // Select accounts from the chat object that haven't been selected yet, preserving
                            // the order of already selected accounts.
                            ...item.chat.definition.accounts.filter(
                                account =>
                                    account.id !== currentAccount?.id &&
                                    !selectedAccountIds.has(account.id),
                            ),
                        ];
                    });

                    comboBoxState.close();
                    break;
                }
                case "SearchUnknownChat": {
                    const chatId = assertId<ChatId>(key.slice("Chat:".length));

                    // Direct chats have an `AccountPile` media type with a non-null `accountCount`.
                    // Assume the chat is a room chat otherwise.
                    //
                    // - For direct chats we want to set selected accounts to all members in the chat.
                    //
                    // - For room chats we want to set the selection state to just our one room chat.
                    //   You can't add people after the room chat, you can only clear the room chat.
                    if (item.media?.type !== "AccountPile" || item.media.accountCount === null) {
                        onSelectRoomChat({id: chatId, name: item.textValue});
                    } else {
                        const abortController = new AbortController();

                        setPendingItemState(oldPendingItemState => {
                            // Make absolutely sure we abort any previous pending item. We should abort above
                            // in this function but we're scared of strange concurrent React race conditions.
                            if (oldPendingItemState) oldPendingItemState.abortController.abort();

                            return {key, abortController};
                        });

                        getChat(context, {chatId})
                            .then(({chat}) => {
                                if (abortController.signal.aborted) return;

                                // This is actually a room chat! This could happen during a race condition where a
                                // direct chat is turned into a room chat.
                                if (chat.definition.type !== "Direct") {
                                    onSelectRoomChat({id: chatId, name: chat.definition.name});
                                    return;
                                }

                                const newSelectedAccounts = chat.definition.accounts.filter(
                                    account => account.id !== currentAccount?.id,
                                );

                                onUpdateSelectedAccounts(() => newSelectedAccounts);

                                // Make sure we close the combobox after updating our selected accounts.
                                comboBoxState.close();
                            })
                            .catch(error => {
                                if (abortController.signal.aborted) return;

                                reporter.displayError("Couldn\u2019t choose chat", error);
                            })
                            .finally(() => {
                                // Make sure we clear our pending item state.
                                setPendingItemState(oldPendingItemState => {
                                    if (oldPendingItemState?.abortController !== abortController)
                                        return oldPendingItemState;

                                    return null;
                                });
                            });
                    }
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        },
    };

    const comboBoxState = useComboBoxState(comboBoxProps);

    // The combobox must always be closed when we have a room chat selected. Since you
    // can't add anything new into the combobox.
    if (selectionState.type === "RoomChat" && comboBoxState.isOpen) {
        comboBoxState.close();
    }

    // We can only close the combobox after we render with our new search query. So
    // watch our state for when a close is requested and perform it.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!shouldCloseComboBox) return;

        // If there are no selected accounts, we don't ever want to close the combobox.
        if (selectedItems.length > 0) {
            comboBoxState.close();
        }

        setSearchQuery({searchQuery, shouldCloseComboBox: false});
    }, [comboBoxState, searchQuery, selectedItems.length, shouldCloseComboBox]);

    // If there are no selected accounts, we should always consider the combobox to be
    // open. Our `<Overlay>` component is set to always be visible if
    // `selectedItems.length === 0` even if `comboBoxState.isOpen` is false. Catch up
    // `comboBoxState` to this reality in an effect.
    //
    // NOTE(calebmer): Admittedly, this is pretty hacky! I think we've outgrown
    // `react-aria`'s `useCombobox()`. Ideally we'd write our own combobox logic which
    // has first-class support for always-open comboboxes.
    useEffect(() => {
        if (!comboBoxState.isOpen && selectedItems.length === 0) {
            comboBoxState.open();
            comboBoxState.selectionManager.setFocusedKey(null);
            if (listBoxRef.current?.parentElement) listBoxRef.current.parentElement.scrollTop = 0;
        }
    }, [comboBoxState, selectedItems.length]);

    // Auto-focus the first result when the user is typing a search query. This allows
    // the user to press Enter immediately to select the first result instead of having
    // to press the down arrow first.
    //
    // TODO: This causes an inperceivable flash where the focus ring isn't visible on
    // the first paint. Using `useLayoutEffectWithoutServerSideWarning` doesn't help
    // because `useComboBoxState` resets `focusedKey` to null during render when items
    // change. Our effect sets it back, but the re-render with the correct focusedKey
    // is preempted by the next keystroke. Fixing this is deeper than this component.
    useEffect(() => {
        if (searchQuery !== "" && searchedItems.length > 0) {
            const firstItem = searchedItems[0];
            if (firstItem && comboBoxState.selectionManager.focusedKey == null) {
                setInteractionModality("keyboard");
                comboBoxState.selectionManager.setFocusedKey(firstItem.key);
            }
        }
    }, [comboBoxState.selectionManager, searchQuery, searchedItems]);

    const {labelProps, inputProps, buttonProps, listBoxProps} = useComboBox(
        {
            ...comboBoxProps,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            inputRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            buttonRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            popoverRef,
            // @ts-expect-error: NOTE(calebmer, #react-v19-upgrade): `react-aria` handles
            // the ref correctly but the type is wrong after upgrading to React v19.
            listBoxRef,
            onKeyDown: event => {
                assert(event.currentTarget instanceof HTMLInputElement);

                switch (event.key) {
                    case "ArrowDown":
                    case "ArrowUp":
                    case "Home":
                    case "End": {
                        setInteractionModality("keyboard");
                        break;
                    }

                    // If we are at the beginning of the combobox text input, the backspace key will
                    // delete the last selected account.
                    case "Backspace": {
                        if (
                            selectedItems.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            event.stopPropagation();

                            switch (selectionState.type) {
                                case "RoomChat": {
                                    onSelectRoomChat(null);
                                    break;
                                }
                                case "Accounts": {
                                    onUpdateSelectedAccounts(selectedAccounts => {
                                        if (selectedAccounts.length === 0) return selectedAccounts;
                                        return selectedAccounts.slice(0, -1);
                                    });
                                    break;
                                }
                                default:
                                    throw exhaustive(selectionState);
                            }
                        }
                        break;
                    }
                    // If we are at the beginning of the combobox text input, the arrow left key will
                    // focus a previously selected account if we have one.
                    case "ArrowLeft": {
                        if (
                            selectedItems.length > 0 &&
                            event.currentTarget.selectionStart ===
                                event.currentTarget.selectionEnd &&
                            event.currentTarget.selectionStart === 0
                        ) {
                            event.preventDefault();
                            event.stopPropagation();
                            setInteractionModality("keyboard");
                            selectedItemRefs[selectedItemRefs.length - 1]?.current?.focus();
                        }
                        break;
                    }

                    case "Tab": {
                        event.preventDefault();
                        event.stopPropagation();

                        // HACK: We're programmatically moving focus, but we're just hijacking the tab key
                        // here, so we should make sure we maintain the correct interaction modality, but
                        // NOT show the focus ring for this action. Focus rings do not show in pointer
                        // modality.
                        const interactionModality = getInteractionModality();
                        setInteractionModality("pointer");
                        focusMessageInput();
                        setInteractionModality(interactionModality);
                        break;
                    }
                }
            },
        },
        comboBoxState,
    );

    const selectedItemsChildren = selectedItems.map((item, index) => {
        return (
            <ChatAccountPickerSelectedItem
                key={item.type === "Account" ? item.accountData.id : item.id}
                index={index}
                item={item}
                inputRef={inputRef}
                selectedItemRefs={selectedItemRefs}
                setSearchQuery={setSearchQuery}
                onUpdateSelectedAccounts={onUpdateSelectedAccounts}
                onSelectRoomChat={onSelectRoomChat}
            />
        );
    });

    const {pressProps: backdropPressProps} = usePress({
        // Backdrop doesn't receive focus.
        preventFocusOnPress: true,

        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                assertExists(inputRef.current).focus();

                // As a convenience, if you tap on this element while it's already focused but the
                // combobox isn't open then open the combobox. After you select an option the
                // combobox closes but the user may want to select another account.
                if (!comboBoxState.isOpen && selectionState.type !== "RoomChat") {
                    comboBoxState.open();
                }
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                assertExists(inputRef.current).focus();

                // As a convenience, if you tap on this element while it's already focused but the
                // combobox isn't open then open the combobox. After you select an option the
                // combobox closes but the user may want to select another account.
                if (!comboBoxState.isOpen && selectionState.type !== "RoomChat") {
                    comboBoxState.open();
                }
            }
        },
    });

    return (
        <OverlayAnimated
            // Force the overlay to be open if there are no selected accounts. In an effect we
            // call `comboBoxState.open()` even when `selectedItems.length` is 0 but before
            // that we want to make sure the overlay is visible so it doesn't flash in.
            isVisible={comboBoxState.isOpen || selectedItems.length === 0}
            disableAnimationIn={true}
            disableAnimationOut={!shouldOverlayAnimate}
            placement="bottom-start"
            sameWidth={true}
            offset="-1"
            overlay={
                <Box ref={popoverRef} position="relative">
                    <ChatAccountPickerListBox
                        comboBoxState={comboBoxState}
                        listBoxRef={listBoxRef}
                        listBoxProps={listBoxProps}
                        isLoadingInitialItems={isLoadingInitialItems}
                        pendingItemKey={pendingItemState?.key ?? null}
                    />
                </Box>
            }
        >
            <FocusRing
                offset="inset"
                isVisibleWhenFocusWithin={true}
                // Render below the listbox overlay.
                overlayZIndex="-10"
                // If we are selecting an item within the combobox show a focus ring there, not
                // here.
                isDisabled={
                    comboBoxState.isOpen && comboBoxState.selectionManager.focusedKey !== null
                }
            >
                <Box data-testid="ChatAccountPickerInput" display="flex" alignItems="flex-start">
                    <label
                        {...labelProps}
                        className={sprinkles({
                            flexShrink: "0",
                            display: "flex",
                            alignItems: "center",
                            // Smaller on mobile since we render the navigation bar above.
                            height: platform !== "mobile" ? "12" : "10",
                            paddingLeft: {desktop: "4", mobile: "2"},
                            paddingRight: {desktop: "3", mobile: "1.5"},
                            fontSize: {desktop: "100", mobile: "50"},
                            color: "grey-50",
                        })}
                    >
                        {comboBoxProps.label}
                        <span aria-hidden={true}>:</span>
                    </label>
                    <Box
                        position="relative"
                        zIndex="0"
                        flexGrow="1"
                        display="flex"
                        flexWrap="wrap"
                        rowGap="1.5"
                        columnGap={{desktop: "1.5", mobile: "1"}}
                        // Smaller on mobile since we render the navigation bar above.
                        paddingY={platform !== "mobile" ? "3" : "2"}
                        cursor="text"
                    >
                        <div
                            {...backdropPressProps}
                            className={sprinkles({
                                position: "absolute",
                                zIndex: "-10",
                                inset: "0",
                                cursor: "text",
                            })}
                        />
                        {selectedItemsChildren}
                        <input
                            {...inputProps}
                            ref={inputRef}
                            className={sprinkles({
                                flexGrow: "1",
                                display: "block",
                                minWidth: searchQuery.length > 0 ? "48" : "4",
                                fontSize: "100",
                            })}
                            style={{
                                background: "none",
                                paddingTop: `${
                                    (parseRemLength("6") -
                                        parseRemLength(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                                paddingBottom: `${
                                    (parseRemLength("6") -
                                        parseRemLength(fontSizes["100"].lineHeight)) /
                                    2
                                }rem`,
                            }}
                            placeholder={
                                selectedItems.length === 0 ? "Search for people…" : undefined
                            }
                            // By default `<input>` elements have a `min-width` determined by the `size`
                            // property. We want our `<input>`s `min-width` to be determined by our CSS so set
                            // it to a small value as not to matter.
                            // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                            size={1}
                            // Allow iOS and MacOS autocorrect and spell checking. By default `react-aria`
                            // disables these capabilities because the user has combobox suggestions. However,
                            // fixing typos at the OS level when typos are common (like on iOS) is really
                            // useful.
                            autoCorrect={undefined}
                            spellCheck={undefined}
                            onKeyDown={event => {
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
                                } else if (event.key === "Escape" && selectedItems.length === 0) {
                                    // Since the combobox will never close when there are no selected accounts, let the
                                    // escape key press propagate up. If we're in a peek that means closing the peek.
                                } else {
                                    inputProps.onKeyDown?.(event);
                                }
                            }}
                            onPointerDown={event => {
                                // As a convenience, if you tap on this element while it's already focused but the
                                // combobox isn't open then open the combobox. After you select an option the
                                // combobox closes but the user may want to select another account.
                                //
                                // We have to be a little careful and make sure this doesn't break the default
                                // browser behavior of focusing the input if it's unfocused.
                                if (
                                    document.activeElement === event.target &&
                                    !comboBoxState.isOpen &&
                                    selectionState.type !== "RoomChat"
                                ) {
                                    comboBoxState.open();
                                }
                            }}
                        />
                    </Box>
                    <Box
                        flexShrink="0"
                        // Smaller on mobile since we render the navigation bar above.
                        height={platform !== "mobile" ? "12" : "10"}
                        paddingLeft={{desktop: "3", mobile: "1.5"}}
                        paddingRight={{mobile: screenPaddingX.mobile, desktop: "4"}}
                        display="flex"
                        alignItems="center"
                        gap="2"
                    >
                        <Box width="4" height="4">
                            {(shouldShowPendingSpinner || shouldShowSearchLoadingIndicator) && (
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    color={colorSchemeVars["grey-70"]}
                                    size={spacing["4"]}
                                />
                            )}
                        </Box>
                        <Box
                            // Redundant and takes up too much space on mobile. The user can tap on the input
                            // to open the dropdown.
                            //
                            // We still need it in the DOM, though, or else `react-aria` gets confused.
                            display={platform === "mobile" ? "none" : undefined}
                        >
                            <IconButton
                                {...buttonProps}
                                // The button has its own label so we don't need one from `react-aria`.
                                aria-labelledby={undefined}
                                ref={buttonRef}
                                size="sm"
                                description="Toggle"
                                withoutTooltip={true}
                            >
                                <CaretDown />
                            </IconButton>
                        </Box>
                    </Box>
                </Box>
            </FocusRing>
        </OverlayAnimated>
    );
}

function ChatAccountPickerSelectedItem({
    index,
    item,
    inputRef,
    selectedItemRefs,
    setSearchQuery,
    onUpdateSelectedAccounts,
    onSelectRoomChat,
}: {
    index: number;
    item:
        | {type: "Account"; accountData: AccountModelData}
        | {type: "RoomChat"; id: ChatId; name: string};
    inputRef: RefObject<HTMLInputElement | null>;
    selectedItemRefs: Array<RefObject<HTMLDivElement | null>>;
    setSearchQuery: Dispatch<SetStateAction<{searchQuery: string; shouldCloseComboBox: boolean}>>;
    onUpdateSelectedAccounts: (
        update: (selectedAccounts: ReadonlyArray<AccountModel>) => ReadonlyArray<AccountModel>,
    ) => void;
    onSelectRoomChat: (roomChat: {id: ChatId; name: string} | null) => void;
}) {
    const platform = usePlatform();
    const {space} = useSpaceContext();
    const navigate = useNavigate();

    const deleteItem = () => {
        switch (item.type) {
            case "RoomChat": {
                onSelectRoomChat(null);
                break;
            }
            case "Account": {
                onUpdateSelectedAccounts(selectedAccounts => {
                    const newSelectedAccounts = selectedAccounts.filter(
                        otherAccount => otherAccount.id !== item.accountData.id,
                    );
                    return newSelectedAccounts.length !== selectedAccounts.length
                        ? newSelectedAccounts
                        : selectedAccounts;
                });
                break;
            }
            default:
                throw exhaustive(item);
        }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
        switch (event.key) {
            // Backspace or delete will remove our selected account.
            case "Backspace":
            case "Delete": {
                event.preventDefault();
                event.stopPropagation();
                setInteractionModality("keyboard");
                deleteItem();
                if (index + 1 < selectedItemRefs.length) {
                    selectedItemRefs[index + 1]?.current?.focus();
                } else {
                    inputRef.current?.focus();
                }
                break;
            }
            // Arrow keys navigate through selected accounts. Only the first selected account
            // is focusable since you use arrow keys to navigate between accounts.
            case "ArrowLeft": {
                event.preventDefault();
                event.stopPropagation();
                setInteractionModality("keyboard");
                selectedItemRefs[index - 1]?.current?.focus();
                break;
            }
            // Arrow keys navigate through selected accounts. Only the first selected account
            // is focusable since you use arrow keys to navigate between accounts.
            case "ArrowRight": {
                event.preventDefault();
                event.stopPropagation();
                setInteractionModality("keyboard");
                if (index + 1 < selectedItemRefs.length) {
                    selectedItemRefs[index + 1]?.current?.focus();
                } else {
                    inputRef.current?.focus();
                }
                break;
            }
            default: {
                // If the user presses a letter then interpret that as the user trying to replace
                // the focused account. So delete the selected account and add the text to our
                // search input.
                if (/^[0-9a-zA-Z]$/.test(event.key)) {
                    event.preventDefault();
                    event.stopPropagation();
                    deleteItem();
                    setSearchQuery(({searchQuery}) => ({
                        searchQuery: searchQuery + event.key,
                        shouldCloseComboBox: false,
                    }));
                    inputRef.current?.focus();
                }
                break;
            }
        }
    };

    const [isNavigatePending, setIsNavigatePending] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            switch (item.type) {
                case "Account": {
                    if (isNavigatePending) return;
                    setIsNavigatePending(true);
                    navigate(`/s/${space.id}/chat/with/${item.accountData.id}?focus`, {
                        // Don't open in peek. Navigate the window we're in.
                        stopPropagation: true,
                    }).finally(() => setIsNavigatePending(false));
                    break;
                }
                case "RoomChat": {
                    if (isNavigatePending) return;
                    setIsNavigatePending(true);
                    navigate(`/s/${space.id}/chat/${item.id}?focus`, {
                        // Don't open in peek. Navigate the window we're in.
                        stopPropagation: true,
                    }).finally(() => setIsNavigatePending(false));
                    break;
                }
                default:
                    throw exhaustive(item);
            }
        },
    });

    return (
        <FocusRing>
            <Box
                {...pressProps}
                ref={selectedItemRefs[index]}
                cursor="default"
                height="6"
                backgroundColor={isPressed ? "grey-10" : "grey-5"}
                borderRadius="full"
                display="flex"
                alignItems="center"
                tabIndex={index === 0 ? 0 : -1}
                // On mobile we want taps to fallthrough and focus the combobox input instead of
                // selecting the account. On mobile you can only press backspace to delete the last
                // account, you can't delete a specific account (unless you have an external
                // keyboard, then you can use arrow keys).
                pointerEvents={platform !== "mobile" ? undefined : "none"}
                onKeyDown={handleKeyDown}
            >
                {item.type !== "Account" ? (
                    <Box
                        paddingLeft="2.5"
                        paddingRight={platform !== "mobile" ? "0.5" : "2"}
                        fontSize={{desktop: "100", mobile: "50"}}
                    >
                        {item.name}
                    </Box>
                ) : (
                    <>
                        <Box paddingLeft="0.5">
                            <AccountAvatar size="5" account={item.accountData} />
                        </Box>
                        <Box
                            paddingLeft="1.5"
                            paddingRight={platform !== "mobile" ? "0.5" : "2"}
                            fontSize={{desktop: "100", mobile: "50"}}
                        >
                            {item.accountData.name}
                        </Box>
                    </>
                )}
                {platform !== "mobile" && (
                    // On mobile this button is too small. So the only way to delete people is via
                    // pressing backspace on the keyboard.
                    <Box paddingRight="0.5">
                        <IconButton
                            size="xs"
                            variant="quiet-above-grey-5-background"
                            // The user focuses the pill as a whole and hits the delete key to delete using the
                            // keyboard.
                            isTabbable={false}
                            description="Remove"
                            withoutTooltip={true}
                            onPress={deleteItem}
                        >
                            <X size={spacing["2.5"]} />
                        </IconButton>
                    </Box>
                )}
            </Box>
        </FocusRing>
    );
}

function ChatAccountPickerListBox({
    comboBoxState,
    listBoxRef,
    listBoxProps: _listBoxProps,
    isLoadingInitialItems,
    pendingItemKey,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    listBoxRef: RefObject<HTMLUListElement | null>;
    listBoxProps: AriaListBoxOptions<ChatAccountPickerItem>;
    isLoadingInitialItems: boolean;
    pendingItemKey: string | null;
}) {
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
            // `useScrollbar()` is on a `<div>` wrapping the `<ul>` so `useScrollbar()` doesn't
            // need to add a resize listener to every child. This means we need to provide
            // `useListBox()` a `scrollRef` if we want to scroll to the focused option.
            ref={useMergedRefs(useScrollbar(), scrollRef)}
            className={classNames(
                greyElevated2ClassName,
                sprinkles({
                    borderRadius: "1.5",
                    padding: "1",
                    marginX: "2",
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-20",
                    maxHeight: {desktop: "64", mobile: "48"},
                    overflowX: "hidden",
                    overflowY: "auto",
                    position: "relative",
                }),
            )}
        >
            <ul {...listBoxProps} ref={listBoxRef}>
                {isLoadingInitialItems ? (
                    // Normally the initial items are preloaded and we shouldn't need to show a loading
                    // spinner. But just in case we have this fallback.
                    <Box
                        padding="1.5"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            // Height calculated so
                            height: addRemLengths("1.5", "6", "1.5"),
                        }}
                    >
                        <SpinnerGap className={spinAnimationClassName} size={spacing["4"]} />
                    </Box>
                ) : comboBoxState.collection.size === 0 ? (
                    <Box padding="1.5" display="flex" alignItems="center" gap="2" color="grey-70">
                        <Box padding="1">
                            <MagnifyingGlass size={spacing["4"]} />
                        </Box>
                        <Box>No results</Box>
                    </Box>
                ) : (
                    Array.from(comboBoxState.collection, item => (
                        <ChatAccountPickerListBoxOption
                            key={item.key}
                            comboBoxState={comboBoxState}
                            item={item}
                            pendingItemKey={pendingItemKey}
                        />
                    ))
                )}
            </ul>
        </div>
    );
}

function ChatAccountPickerListBoxOption({
    comboBoxState,
    item,
    pendingItemKey,
}: {
    comboBoxState: ComboBoxState<ChatAccountPickerItem>;
    item: Node<ChatAccountPickerItem>;
    pendingItemKey: string | null;
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
                {cloneElement(item.rendered, {isPressed, pendingItemKey} as any)}
            </li>
        </FocusRing>
    );
}

function ChatAccountPickerListBoxOptionItem({
    item,
    pendingItemKey,
    isPressed,
}: {
    item: ChatAccountPickerItem;
    pendingItemKey?: string | null;
    isPressed?: boolean;
}) {
    assert(
        typeof isPressed === "boolean" && pendingItemKey !== undefined,
        "Expected to be rendered by `<ChatAccountMemberPickerListBoxOption>` which provides extra props",
    );

    const isPending = item.key === pendingItemKey;
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(isPending);

    let media: ReactNode;

    switch (item.type) {
        case "Account": {
            media = <AccountAvatar account={item.accountData} size="6" />;
            break;
        }
        case "SuggestedDirectChat": {
            const {otherAccountDatas} = item;
            assert(otherAccountDatas.length > 0);

            media = (
                <ChatAccountPickerListBoxOptionItemAccountAvatarPileWithKnownCount
                    accountData={otherAccountDatas[0]!}
                    accountCount={otherAccountDatas.length}
                    isPressed={isPressed}
                />
            );
            break;
        }
        case "SearchUnknownChat": {
            if (item.media === null) {
                media = <Box width="6" height="6" />;
                break;
            }

            switch (item.media.type) {
                case "Account": {
                    // Render a grey circle for chats that don't have an `AccountPile` media. We want
                    // to communicate it's a multi-person chat so we don't want to render one account.
                    // This case should happen rarely. Just `RoomChat`s that only a single person has
                    // messaged so far.
                    media = (
                        <ChatAccountPickerListBoxOptionItemAccountAvatarPileWithUnknownCount
                            accountData1={null}
                            accountData2={item.media.accountData}
                            isPressed={isPressed}
                        />
                    );
                    break;
                }
                case "AccountPile": {
                    if (item.media.accountCount !== null) {
                        media = (
                            <ChatAccountPickerListBoxOptionItemAccountAvatarPileWithKnownCount
                                accountData={item.media.previewAccountDatas[0]!}
                                accountCount={
                                    // Subtract one because we assume our actor is in this chat (safe assumption since
                                    // you can't see a direct chat you're not in) and we want the count to be non-actor
                                    // accounts.
                                    item.media.accountCount - 1
                                }
                                isPressed={isPressed}
                            />
                        );
                        break;
                    } else {
                        media = (
                            <ChatAccountPickerListBoxOptionItemAccountAvatarPileWithUnknownCount
                                accountData1={item.media.previewAccountDatas[1]!}
                                // The second account covers the first. So use whichever was ranked first as
                                // `accountData2`.
                                accountData2={item.media.previewAccountDatas[0]!}
                                isPressed={isPressed}
                            />
                        );
                        break;
                    }
                }
                default:
                    throw exhaustive(item.media);
            }
            break;
        }
        default:
            throw exhaustive(item);
    }

    return (
        <Box display="flex" alignItems="center" gap="2">
            {media}
            <Box fontStyle="truncate" flexGrow="1">
                {item.textValue}
            </Box>
            {shouldShowLoadingIndicator && (
                <SpinnerGap
                    className={spinAnimationClassName}
                    size={spacing["4"]}
                    color={colorSchemeVars["grey-70"]}
                />
            )}
        </Box>
    );
}

function ChatAccountPickerListBoxOptionItemAccountAvatarPileWithKnownCount({
    accountData,
    accountCount,
    isPressed,
}: {
    accountData: AccountModelData;
    accountCount: number;
    isPressed: boolean;
}) {
    return (
        <Box position="relative" width="6" height="6">
            <Box position="absolute" top="0" left="-1">
                <AccountAvatar account={accountData} size="5" />
            </Box>
            <Box
                position="absolute"
                bottom="-1"
                right="-1"
                width="5"
                height="5"
                borderRadius="full"
                style={{
                    boxShadow: `0px 0px 0px 2px ${backgroundColorVar}`,
                }}
            >
                <Box
                    width="5"
                    height="5"
                    borderRadius="full"
                    backgroundColor={isPressed ? "grey-20" : "grey-10"}
                    color="grey-70"
                    fontSize="50"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box style={{transform: "scale(0.8)"}}>+{accountCount - 1}</Box>
                </Box>
            </Box>
        </Box>
    );
}

function ChatAccountPickerListBoxOptionItemAccountAvatarPileWithUnknownCount({
    accountData1,
    accountData2,
    isPressed,
}: {
    accountData1: AccountModelData | null;
    accountData2: AccountModelData;
    isPressed: boolean;
}) {
    return (
        <Box position="relative" width="6" height="6">
            <Box position="absolute" top="0" left="-1">
                {accountData1 ? (
                    <AccountAvatar account={accountData1} size="5" />
                ) : (
                    <Box
                        as="span"
                        display="block"
                        height="5"
                        width="5"
                        borderRadius="full"
                        backgroundColor={isPressed ? "grey-20" : "grey-10"}
                    />
                )}
            </Box>
            <Box position="absolute" bottom="-1" right="-1" width="5" height="5">
                <AccountAvatar account={accountData2} size="5" backgroundBorderWidth={2} />
            </Box>
        </Box>
    );
}
