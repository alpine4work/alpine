import {SpinnerGap, X} from "phosphor-react";
import {useCallback, useRef} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/web/design/text_area_with_auto_growing_height.js";
import {useDelayLoadingIndicator} from "~/client/web/design/use_delay_loading_indicator.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {getSearchEntityPath} from "~/client/web/search/core/get_search_entity_path.js";
import {SearchEntityView} from "~/client/web/search/search_entity_view.js";
import {useSearchState} from "~/client/web/search/use_search_state.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    searchEntityHeaderFontSize,
    searchEntityHeaderLineHeight,
    searchEntityHeaderPaddingTop,
    searchEntityViewMinHeightPx,
    searchMobileInputBorderRadius,
    searchMobileInputFontSize,
    searchMobileInputMarginBottom,
    searchMobileInputMarginTop,
    searchMobileInputMinHeight,
    searchMobileInputPaddingX,
    searchMobileInputPaddingY,
} from "~/client/web/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/web/virtualized/virtualized_scroll_view.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {searchByAffinity} from "~/shared/rpc/search_rpc_definitions.js";
import {
    SearchAffinityEntityResultModel,
    SearchEntityResultModel,
} from "~/shared/search/search_entity_result_model.js";

export function SearchMobileView({
    initialAffinitySearch,
}: {
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {space} = useSpaceContext();
    const navigate = useNavigate();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const maxWidth = platform !== "mobile" ? "96" : undefined;

    const {output, queryText, onQueryTextChange} = useSearchState({
        isSearchParamControlled: false,
        debugOptions: null,
        initialAffinitySearch,
    });

    const results = output.results ?? emptyArray;

    const hasFavorites =
        output.type === "EmptyQuery" &&
        output.favoriteResults !== null &&
        (output.hasMoreFavoriteResults || output.favoriteResults.length > 0);
    const hasMoreFavoriteResults = hasFavorites && output.hasMoreFavoriteResults;
    const favoriteResults = hasFavorites ? output.favoriteResults : emptyArray;

    const shouldShowLoadingIndicator = useDelayLoadingIndicator(output.isPending);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: "Search",
        withoutDisappearingTitle: true,
        titleJustifyContent: "center",
        desktopMaxWidth: maxWidth,
        // This is a route for a root tab in our mobile app so don't show the back
        // button. It wouldn't work.
        withoutMobileBackButton: true,
    });

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (index === 0) {
                return {
                    key: "Header",
                    minHeight: addRemLengths(
                        navigationBarHeight,
                        searchMobileInputMarginTop,
                        searchMobileInputMinHeight,
                        searchMobileInputMarginBottom,
                    ),
                    node: (
                        <>
                            <Box height="safe-area-inset-top" />
                            <Box height={navigationBarHeight} />
                            <Box height={searchMobileInputMarginTop} />
                            <Box
                                width="full"
                                maxWidth={maxWidth}
                                paddingX={screenPaddingX}
                                marginX="center"
                            >
                                <Box position="relative">
                                    <TextAreaWithAutoGrowingHeight
                                        className={sprinkles({
                                            width: "full",
                                            paddingLeft: searchMobileInputPaddingX,
                                            paddingRight: "9",
                                            paddingY: searchMobileInputPaddingY,
                                            backgroundColor: "grey-0",
                                            boxShadow: "elevation-5-with-grey-10-border",
                                            fontSize: searchMobileInputFontSize,
                                            fontStyle: "normal",
                                        })}
                                        style={{
                                            borderRadius: searchMobileInputBorderRadius,
                                        }}
                                        placeholder={`Search ${space.name}…`}
                                        value={queryText}
                                        onChange={event =>
                                            onQueryTextChange(event.currentTarget.value)
                                        }
                                    />
                                    {shouldShowLoadingIndicator && (
                                        <Box
                                            position="absolute"
                                            zIndex="30"
                                            width="4"
                                            height="4"
                                            right="2.5"
                                            top="2.5"
                                            // Cover clear button while loading with loading indicator. If we are on two
                                            // lines then the loading indicator will show at the top and the clear button
                                            // will show at the bottom.
                                            backgroundColor="grey-0"
                                            display="flex"
                                            justifyContent="center"
                                            alignItems="center"
                                        >
                                            <SpinnerGap
                                                className={spinAnimationClassName}
                                                color={colorSchemeVars["grey-70"]}
                                                size={spacing["6"]}
                                            />
                                        </Box>
                                    )}
                                    {queryText.length > 0 && (
                                        <Box position="absolute" zIndex="20" right="2" bottom="2">
                                            <IconButton
                                                size="xs"
                                                description="Clear"
                                                onPress={() => onQueryTextChange("")}
                                            >
                                                <X />
                                            </IconButton>
                                        </Box>
                                    )}
                                </Box>
                            </Box>
                            <Box height={searchMobileInputMarginBottom} />
                            {!hasFavorites && results.length === 0 && (
                                <Box
                                    color="grey-50"
                                    paddingX={screenPaddingX}
                                    paddingTop="1"
                                    style={contentStyles.paragraphFontSize}
                                >
                                    {queryText.trim().length === 0 ? (
                                        <>
                                            As you explore, content you&#x2019;ve recently visited
                                            will show up here. For now, try searching.
                                        </>
                                    ) : (
                                        <>
                                            Couldn&#x2019;t find anything matching &#x201C;
                                            <span
                                                className={sprinkles({
                                                    color: "grey-70",
                                                    fontStyle: "bold",
                                                })}
                                            >
                                                {queryText}
                                            </span>
                                            .&#x201D; Try a different search?
                                        </>
                                    )}
                                </Box>
                            )}
                        </>
                    ),
                };
            }

            index -= 1;

            if (hasFavorites) {
                if (index === 0) {
                    return {
                        key: "FavoritesHeader",
                        minHeight: addRemLengths(
                            searchEntityHeaderPaddingTop,
                            searchEntityHeaderLineHeight,
                        ),
                        node: (
                            <Box
                                width="full"
                                maxWidth={maxWidth}
                                marginX="center"
                                paddingTop={searchEntityHeaderPaddingTop}
                                paddingX={screenPaddingX}
                                color="grey-50"
                                fontSize={searchEntityHeaderFontSize}
                                style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
                            >
                                Favorites
                                {hasMoreFavoriteResults && (
                                    // Intentionally using [U+2219 (bullet operator)][1] instead of
                                    // [U+2022 (bullet)][2] since the former is thinner.
                                    //
                                    // A bullet separator here is nicer than parentheses like "(see all)"
                                    // since the parentheses draw a lot of attention.
                                    //
                                    // [1]: https://graphemica.com/%E2%88%99
                                    // [2]: https://graphemica.com/%E2%80%A2
                                    <>
                                        {"\u2009\u2219\u2009"}
                                        <SearchMobileViewFavoritesHeaderSeeMoreButton
                                            onPress={() => {
                                                navigate(`/s/${space.id}/favorites`);
                                            }}
                                        />
                                    </>
                                )}
                            </Box>
                        ),
                    };
                }

                index -= 1;

                if (index < favoriteResults.length) {
                    const result = favoriteResults[index]!;

                    return {
                        key: result.id,
                        minHeight: searchEntityViewMinHeightPx[spacingScale],
                        node: (
                            <Box width="full" maxWidth={maxWidth} marginX="center">
                                <SearchMobileEntityView
                                    spaceId={space.id}
                                    searchKey={output.key}
                                    searchTime={output.queryTime}
                                    result={result}
                                    isFirstItem={false}
                                    isLastItem={false}
                                />
                            </Box>
                        ),
                    };
                }

                index -= favoriteResults.length;

                if (index === 0) {
                    return {
                        key: "SuggestedHeader",
                        minHeight: addRemLengths(
                            searchEntityHeaderPaddingTop,
                            searchEntityHeaderLineHeight,
                        ),
                        node: (
                            <Box
                                width="full"
                                maxWidth={maxWidth}
                                marginX="center"
                                paddingX={screenPaddingX}
                                paddingTop={searchEntityHeaderPaddingTop}
                                color="grey-50"
                                fontSize={searchEntityHeaderFontSize}
                                style={{lineHeight: spacing[searchEntityHeaderLineHeight]}}
                            >
                                Suggested
                            </Box>
                        ),
                    };
                }

                index -= 1;
            }

            const result = results[index]!;

            const isFirstItem = !hasFavorites && index === 0;
            const isLastItem = index === results.length - 1;

            return {
                key: result.id,
                minHeight: searchEntityViewMinHeightPx[spacingScale],
                node: (
                    <Box width="full" maxWidth={maxWidth} marginX="center">
                        <SearchMobileEntityView
                            spaceId={space.id}
                            searchKey={output.key}
                            searchTime={output.queryTime}
                            result={result}
                            isFirstItem={isFirstItem}
                            isLastItem={isLastItem}
                        />
                        {isLastItem && <Box height="safe-area-inset-bottom" />}
                    </Box>
                ),
            };
        },
        [
            favoriteResults,
            hasFavorites,
            hasMoreFavoriteResults,
            maxWidth,
            navigate,
            onQueryTextChange,
            output.key,
            output.queryTime,
            queryText,
            results,
            shouldShowLoadingIndicator,
            space.id,
            space.name,
            spacingScale,
        ],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            elementRef={scrollViewRef}
            scrollbarInsetTop={scrollbarInsetTop}
            extraChildren={navigationBar}
            itemCount={1 + (hasFavorites ? 2 + favoriteResults.length : 0) + results.length}
            bufferedItemHeight={searchEntityViewMinHeightPx[spacingScale]}
            renderItem={renderItem}
            extraChildrenOutsideContentElement={({contentHeight}) => (
                // Our items all have a bottom border. This is good when there's less content
                // than room to scroll since it creates a clear shape for the last item in the
                // list.
                //
                // However, if there are enough items to scroll then when the user has fully
                // scrolled we want the last item to *not* have a border bottom since the
                // bottom of the screen creates that boundary. We don't need to render an extra
                // line in the margins.
                //
                // This div covers the bottom border of the last item but only when there's
                // enough content to scroll. Otherwise the bottom border needs to be visible to
                // visually contain the last item. To debug this it's helpful to switch the
                // `backgroundColor` to `red-30` or something similar.
                <Box
                    position="absolute"
                    left="0"
                    right="0"
                    top="0"
                    style={{height: `max(100%, ${contentHeight}px)`}}
                >
                    <Box
                        position="absolute"
                        left="0"
                        right="0"
                        height="1"
                        backgroundColor="grey-0"
                        style={{bottom: "var(--safe-area-inset-bottom, 0px)"}}
                    />
                </Box>
            )}
        />
    );
}

function SearchMobileEntityView({
    spaceId,
    searchKey,
    searchTime,
    result,
    isFirstItem,
    isLastItem,
}: {
    spaceId: SpaceId;
    searchKey: string;
    searchTime: Date;
    result: SearchEntityResultModel | SearchAffinityEntityResultModel;
    isFirstItem: boolean;
    isLastItem: boolean;
}) {
    const navigate = useNavigate();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            navigate(
                getSearchEntityPath({
                    spaceId: spaceId,
                    entityId: result.id,
                    randomSeed: searchKey,
                    currentTime: searchTime,
                    routeLayout: "narrow",
                }),
            );
        },
    });

    return (
        <Box {...pressProps}>
            <SearchEntityView
                paddingX={screenPaddingX}
                marginX="0"
                isPressed={isPressed}
                result={result}
                withMarginTop={isFirstItem}
                withMarginBottom={isLastItem}
            />
        </Box>
    );
}

function SearchMobileViewFavoritesHeaderSeeMoreButton({onPress}: {onPress: () => void}) {
    const {isPressed, pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            display="inline"
            // We don't usually use a pointer cursor for pressable things but in this case
            // it's not obvious this text is interactive without it.
            cursor="pointer"
            // Additional padding Y to get to 44px in height of touch slop.
            paddingY="3"
            position="relative"
            left="-1"
        >
            <Box
                display="inline"
                color={isPressed ? "grey-100" : undefined}
                backgroundColor={isPressed ? "grey-10" : undefined}
                paddingX="1"
                paddingY="1"
                borderRadius="1"
            >
                see all
            </Box>
        </Box>
    );
}
