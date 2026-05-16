import {Link as LinkIcon} from "phosphor-react";
import {useId, useMemo, useState} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ContextMenuActions, useContextMenuActions} from "~/client/web/design/context_menu.js";
import {MenuAction} from "~/client/web/design/menu.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useGlobalContext} from "~/client/web/helpers/global_context.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {usePeekStackContext} from "~/client/web/peek/peek_stack_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {RpcCacheContext} from "~/client/web/rpc/rpc_cache.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {forceRevalidateSearchByAffinity} from "~/client/web/search/core/force_revalidate_search_by_affinity.js";
import {getSearchEntityPath} from "~/client/web/search/core/get_search_entity_path.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {
    useSearchEntityModel,
    useSearchEntityRegistry,
} from "~/client/web/search/core/search_entity_registry_context.js";
import {updateSearchFavoriteEntityMenuAction} from "~/client/web/search/core/use_search_favorite_affinity_entity_menu_action.js";
import {SearchAffinityEntityView} from "~/client/web/search/search_affinity_entity_view.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    feedViewSideBarPaddingX,
    feedViewSideBarSpaceNameFontSize,
    feedViewSideBarSpaceNameNegativeMarginBottom,
} from "~/client/web/styles/feed_shared_styles.js";
import {
    searchAffinityEntityViewMinHeightPx,
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
    searchEntityHeaderPaddingTop,
    searchEntityViewDefaultPaddingX,
} from "~/client/web/styles/search_shared_styles.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {
    clearSearchEntityAffinity,
    markSearchAffinityEntityInteraction,
    searchByAffinity,
    unfavoriteSearchEntity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {
    isSearchDynamicEntityId,
    parseSearchAffinityEntityId,
    parseSearchDynamicEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";
import {SearchAffinityEntityResultModel} from "~/shared/search/search_entity_result_model.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {Store} from "~/shared/store/store.js";

export function FeedViewSideBar({
    height,
    initialAffinitySearch,
}: {
    height: number;
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
}) {
    const context = useAppContext();
    const initialAppRenderId = useInitialAppRenderId();
    const spacingScale = useSpacingScale();
    const rpcCache = useGlobalContext(RpcCacheContext);
    const {space} = useSpaceContext();
    const searchEntityRegistry = useSearchEntityRegistry();

    const [randomSeed] = useState(() =>
        initialAppRenderId ? `${initialAppRenderId}-FeedViewSideBar` : generateId(),
    );

    // Even though we've already loaded the affinity search from the server, we call
    // `useLazyLoadRpc()` so that if you navigate away from the browser then navigate
    // back the affinity list is re-fetched. Also any time you favorite/unfavorite
    // something we revalidate the RPC cache for `searchByAffinity()` which will cause
    // this component to re-render.
    const {output} = useLazyLoadRpc(
        searchByAffinity,
        {spaceId: space.id},
        {initialOutput: initialAffinitySearch},
    );

    const hasFavorites =
        output && (output.hasMoreFavoriteResults || output.favoriteResults.length > 0);
    const hasMoreFavoriteResults = hasFavorites && output.hasMoreFavoriteResults;
    const favoriteResults = hasFavorites ? output.favoriteResults : emptyArray;

    const sectionHeaderHeight = convertRemLengthToPx(
        addRemLengths(searchEntityHeaderPaddingTop, searchEntityHeaderLineHeight),
        spacingScale,
    );

    const availableHeightWithoutSectionHeaders =
        height -
        (convertRemLengthToPx(navigationBarHeight, spacingScale) -
            convertRemLengthToPx(feedViewSideBarSpaceNameNegativeMarginBottom, spacingScale));

    // We estimate the available height assuming there's at least one non-favorites
    // section header. We won't know how many headers there actually are until after we
    // check the contents of the first `estimatedVisibleResultCount` results and
    // determine what groups we have.
    const estimatedAvailableHeight =
        availableHeightWithoutSectionHeaders -
        (hasFavorites ? sectionHeaderHeight : 0) -
        sectionHeaderHeight;

    // The feed search affinity list sidebar doesn't scroll. We render as many entities
    // as will fit on the screen and that's it. The feed post list does, however,
    // scroll.
    //
    // The search affinity list doesn't scroll because I want mouse wheel events to be
    // interpreted as scrolling the feed. Not the search affinity list. We could make
    // the search affinity list and feed scrollable separately that's probably fine but
    // I like that it's conceptually clean that there's no conflicting scrollbars on
    // the home page.
    const estimatedVisibleResultCount = Math.floor(
        estimatedAvailableHeight / searchAffinityEntityViewMinHeightPx[spacingScale],
    );

    const {peopleResults, suggestedResults} = useStore(
        useMemo(() => {
            return computeStore(get => {
                const peopleResults = [];
                const suggestedResults = [];

                if (output) {
                    for (const result of sliceIterable(
                        output.results,
                        0,
                        estimatedVisibleResultCount - favoriteResults.length,
                    )) {
                        if (
                            isSearchAffinityResultDirectChatOrAccount(
                                get,
                                searchEntityRegistry,
                                result,
                            )
                        ) {
                            peopleResults.push(result);
                        } else {
                            suggestedResults.push(result);
                        }
                    }
                }

                // We could have up to three section headers.
                const availableHeight =
                    availableHeightWithoutSectionHeaders -
                    (hasFavorites ? sectionHeaderHeight : 0) -
                    (peopleResults.length > 0 ? sectionHeaderHeight : 0) -
                    (suggestedResults.length > 0 ? sectionHeaderHeight : 0);

                const visibleResultCount = Math.floor(
                    availableHeight / searchAffinityEntityViewMinHeightPx[spacingScale],
                );

                const visibleResultCountWithoutFavorites = Math.floor(
                    visibleResultCount - favoriteResults.length,
                );

                // Remove the result with the lowest score from the "People" and "Suggested"
                // sections (not the "Favorites" section) until we have `visibleResultCount` items
                // in total.
                if (visibleResultCountWithoutFavorites > 0) {
                    while (
                        peopleResults.length + suggestedResults.length >
                        visibleResultCountWithoutFavorites
                    ) {
                        if (peopleResults.length === 0) {
                            suggestedResults.pop();
                        } else if (suggestedResults.length === 0) {
                            peopleResults.pop();
                        } else {
                            const lastPeopleResult = peopleResults[peopleResults.length - 1]!;
                            const lastSuggestedResult =
                                suggestedResults[suggestedResults.length - 1]!;

                            if (lastPeopleResult.score < lastSuggestedResult.score) {
                                peopleResults.pop();
                            } else {
                                suggestedResults.pop();
                            }
                        }
                    }
                }

                return {peopleResults, suggestedResults};
            });
        }, [
            availableHeightWithoutSectionHeaders,
            estimatedVisibleResultCount,
            favoriteResults.length,
            hasFavorites,
            output,
            searchEntityRegistry,
            sectionHeaderHeight,
            spacingScale,
        ]),
    );

    return (
        <Box pointerEvents="auto" width="full" paddingX={feedViewSideBarPaddingX}>
            <Box
                display="flex"
                alignItems="center"
                height={navigationBarHeight}
                paddingX={searchEntityViewDefaultPaddingX}
                marginBottom={`-${feedViewSideBarSpaceNameNegativeMarginBottom}`}
            >
                <Box
                    fontStyle="truncate-bold"
                    fontSize={feedViewSideBarSpaceNameFontSize}
                    minWidth="flex-fit"
                    userSelect="text"
                >
                    {space.name}
                </Box>
            </Box>
            {output && (
                <>
                    {hasFavorites && (
                        <Box
                            paddingTop={searchEntityHeaderPaddingTop}
                            paddingX={searchEntityViewDefaultPaddingX}
                            color="grey-50"
                            fontSize={searchEntityHeaderFontSize}
                            style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
                        >
                            Favorites
                            {hasMoreFavoriteResults && (
                                // Intentionally using [U+2219 (bullet operator)][1] instead of [U+2022
                                // (bullet)][2] since the former is thinner.
                                //
                                // A bullet separator here is nicer than parentheses like "(see all)" since the
                                // parentheses draw a lot of attention.
                                //
                                // [1]: https://graphemica.com/%E2%88%99
                                // [2]: https://graphemica.com/%E2%80%A2
                                <>
                                    {"\u2009\u2219\u2009"}
                                    <FeedViewFavoritesHeaderSeeMoreButton />
                                </>
                            )}
                        </Box>
                    )}
                    {mapIterable(
                        sliceIterable(favoriteResults, 0, estimatedVisibleResultCount),
                        result => (
                            <FeedSearchAffinityView
                                key={result.id}
                                result={result}
                                randomSeed={randomSeed}
                                onRemoveFromFavorites={async () => {
                                    await unfavoriteSearchEntity(context, {
                                        spaceId: space.id,
                                        entityId: result.id,
                                    });

                                    // This is very race condition prone. But it's good enough for this
                                    // non-collaborative use case. _Shrug_
                                    updateSearchFavoriteEntityMenuAction(
                                        space.id,
                                        result.id,
                                        false,
                                    );

                                    forceRevalidateSearchByAffinity(
                                        context,
                                        rpcCache,
                                        space.id,
                                        "removing favorite in feed side bar",
                                        output => {
                                            // Test that the item was removed from `favoriteResults`.
                                            return !output.favoriteResults.some(
                                                otherResult => otherResult.id === result.id,
                                            );
                                        },
                                    );
                                }}
                            />
                        ),
                    )}
                    {renderSuggestedSearchEntitySection("People", peopleResults)}
                    {renderSuggestedSearchEntitySection("Suggested", suggestedResults)}
                </>
            )}
        </Box>
    );

    function renderSuggestedSearchEntitySection(
        sectionTitle: "Suggested" | "People",
        results: ReadonlyArray<SearchAffinityEntityResultModel>,
    ) {
        if (results.length === 0) return null;

        return (
            <>
                <Box
                    paddingTop={searchEntityHeaderPaddingTop}
                    paddingX={searchEntityViewDefaultPaddingX}
                    color="grey-50"
                    fontSize={searchEntityHeaderFontSize}
                    style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
                >
                    {sectionTitle}
                </Box>
                {results.map(result => (
                    <FeedSearchAffinityView
                        key={result.id}
                        result={result}
                        randomSeed={randomSeed}
                        onRemoveFromSuggested={async () => {
                            await clearSearchEntityAffinity(context, {
                                spaceId: space.id,
                                entityId: result.id,
                            });

                            forceRevalidateSearchByAffinity(
                                context,
                                rpcCache,
                                space.id,
                                "removing suggestion in feed side bar",
                                output => {
                                    // Test that the item was removed from `results`.
                                    return !output.results.some(
                                        otherResult => otherResult.id === result.id,
                                    );
                                },
                            );
                        }}
                    />
                ))}
            </>
        );
    }
}

function FeedSearchAffinityView({
    result,
    randomSeed,
    onRemoveFromFavorites,
    onRemoveFromSuggested,
}: {
    result: SearchAffinityEntityResultModel;
    randomSeed: string;
    onRemoveFromFavorites?: () => MaybePromise<void>;
    onRemoveFromSuggested?: () => MaybePromise<void>;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const navigate = useNavigate();
    const {space} = useSpaceContext();
    const activeContextMenuActions = useContextMenuActions();
    const peekStackContext = usePeekStackContext();
    const entityData = useSearchEntityModel(result.model);

    const [isPendingNavigation, setIsPendingNavigation] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: event => {
            if (isPendingNavigation) return;

            const path = getSearchEntityPath({
                spaceId: space.id,
                entityData,
                randomSeed,
                currentTime: new Date(),
                routeLayout: "wide",
            });

            setIsPendingNavigation(true);

            // When clicking on a path from the feed sidebar, fully navigate the app to that
            // thing. Don't open it in a peek. The home page is your entrypoint into the rest
            // of the product. You won't be doing much work on the home page so we don't need
            // to open a peek that keeps you in context.
            //
            // If the user is holding shift then open in a peek.
            //
            // Chats and tasks always open in a peek. Because they're small and don't use the
            // fullscreen space effectively, so better to keep them in a peek.
            const shouldOpenInPeek = event.shiftKey || shouldOpenSearchAffinityResultInPeek(result);

            void navigate(path, {stopPropagation: !shouldOpenInPeek})
                .then(() => {
                    // Whenever the user selects a suggested (or favorite) result, we record a high
                    // intent affinity interaction. This is because the user opening a result from the
                    // feed view sidebar is super high signal that this is an entity they care about.
                    // In this way the suggested list is a self reinforcing system. The more a user
                    // selects an entity, the higher the entity will appear in the user's next search.
                    markSearchAffinityEntityInteraction(context, {
                        spaceId: space.id,
                        entityId: result.id,
                        interaction: {type: "HighIntentUpdate"},
                    }).catch(error => {
                        // Silently fail. This doesn't affect anything the user sees so we don't need to
                        // report the error to the user.
                        reporter.logErrorWithoutDisplaying(
                            "Couldn\u2019t mark search result select affinity interaction",
                            error,
                        );
                    });
                })
                .finally(() => {
                    setIsPendingNavigation(false);
                });
        },
    });

    const id = useId();

    const hasActiveContextMenu = useMemo(
        () =>
            activeContextMenuActions?.some(section =>
                ("actions" in section ? section.actions : section).some(
                    action => !action.withCustomLayout && action.key === id,
                ),
            ) ?? false,
        [activeContextMenuActions, id],
    );

    const contextMenuActions: Array<Array<MenuAction>> = [];

    contextMenuActions.push([
        {
            key: id,
            label: "Copy link",
            icon: <LinkIcon />,
            iconPlacement: "end",
            pressErrorTitle: "Couldn\u2019t copy link",
            onPress: async () => {
                const path = getSearchEntityPath({
                    spaceId: space.id,
                    entityData,
                    randomSeed,
                    currentTime: new Date(),
                    routeLayout: "wide",
                });

                const url = new URL(path, window.location.href);
                await writeTextToClipboard(url.toString());
            },
        },
        {
            label: "Open in peek",
            pressErrorTitle: "Couldn\u2019t open peek",
            onPress: async () => {
                const path = getSearchEntityPath({
                    spaceId: space.id,
                    entityData,
                    randomSeed,
                    currentTime: new Date(),
                    routeLayout: "wide",
                });

                await peekStackContext.push(path);
            },
        },
    ]);

    if (onRemoveFromFavorites) {
        contextMenuActions.push([
            {
                label: "Remove from favorites",
                pressErrorTitle: "Couldn\u2019t remove from favorites",
                onPress: onRemoveFromFavorites,
            },
        ]);
    }

    if (onRemoveFromSuggested) {
        contextMenuActions.push([
            {
                label: "Remove from suggested",
                pressErrorTitle: "Couldn\u2019t remove from suggested",
                onPress: onRemoveFromSuggested,
            },
        ]);
    }

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box
                {...pressProps}
                paddingLeft={searchEntityViewDefaultPaddingX}
                backgroundColor={isPressed || hasActiveContextMenu ? "grey-5" : undefined}
                borderRadius="1.5"
                // Don't extend to 100% width, instead fit whatever the title is. It feels weird to
                // click in open space and have that activate a suggested search entity. In other
                // surfaces where we show feed entities there's a clear right border so it makes
                // more sense the click target would extend to the end of that border.
                width="fit-content"
                style={{
                    // We use slightly more `paddingRight` so that the full entity looks visually
                    // balanced.
                    paddingRight: addRemLengths(searchEntityViewDefaultPaddingX, "1"),
                }}
            >
                <SearchAffinityEntityView result={result} lineClamp={1} />
            </Box>
        </ContextMenuActions>
    );
}

function FeedViewFavoritesHeaderSeeMoreButton() {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const [isPending, setIsPending] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            if (isPending) return;

            runPromiseWithoutAwaiting(async () => {
                setIsPending(true);
                try {
                    navigate(`/s/${space.id}/favorites`);
                } finally {
                    setIsPending(false);
                }
            });
        },
    });

    return (
        <Box
            {...pressProps}
            display="inline"
            // We don't usually use a pointer cursor for pressable things but in this case it's
            // not obvious this text is interactive without it.
            cursor="pointer"
            opacity={isPressed ? "60" : undefined}
            paddingX="1"
            paddingY="1"
            borderRadius="1"
            position="relative"
            left="-1"
        >
            see all
        </Box>
    );
}

function isSearchAffinityResultDirectChatOrAccount(
    get: <Value>(store: Store<Value>) => Value,
    searchEntityRegistry: SearchEntityRegistry,
    result: SearchAffinityEntityResultModel,
): boolean {
    if (!isSearchDynamicEntityId(result.id)) return false;

    const {type: entityType} = parseSearchDynamicEntityId(result.id);

    if (entityType === "Account") return true;

    if (entityType === "Chat" && result.model instanceof SearchEntityModel) {
        const entity = get(searchEntityRegistry.getEntityStore(result.model));
        assert(entity.type === "Chat");

        // HACK: Room chats have a null `accountCount` whereas direct chats have an integer
        // `accountCount`. So check `accountCount === null` to tell if this is a room chat.
        if (entity.chat.media?.type === "AccountPile" && entity.chat.media.accountCount !== null) {
            return true;
        }
    }

    return false;
}

function shouldOpenSearchAffinityResultInPeek(result: SearchAffinityEntityResultModel): boolean {
    if (!isSearchDynamicEntityId(result.id)) return false;

    const {type: entityType} = parseSearchAffinityEntityId(result.id);

    switch (entityType) {
        case "Chat":
        case "Account":
        case "Task":
            return true;
        case "Document":
        case "Channel":
        case "TaskCollection":
        case "Site":
            return false;
        default:
            throw exhaustive(entityType);
    }
}
