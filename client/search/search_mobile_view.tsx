import {SpinnerGap, X} from "phosphor-react";
import {useCallback, useRef} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/design/text_area_with_auto_growing_height.js";
import {useDelayLoadingIndicator} from "~/client/design/use_delay_loading_indicator.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {getSearchResultDestinationPath} from "~/client/search/internal/get_search_result_destination_path.js";
import {SearchResultView} from "~/client/search/internal/search_result_view.js";
import {useSearchState} from "~/client/search/use_search_state.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    minSearchMobileInputHeight,
    minSearchResultViewHeight,
    searchMobileInputBorderRadius,
    searchMobileInputFontSize,
    searchMobileInputMarginBottom,
    searchMobileInputMarginTop,
    searchMobileInputPaddingX,
    searchMobileInputPaddingY,
} from "~/client/styles/search_shared_styles.js";
import {
    colorSchemeVars,
    contentStyles,
    spinAnimationClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {addRemLengths, screenPaddingX, spacing} from "~/shared/design/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SearchResult} from "~/shared/search/search_result.js";

export function SearchMobileView({
    affinityResults,
}: {
    affinityResults: ReadonlyArray<SearchResult>;
}) {
    const isMobile = useIsMobile();
    const {space} = useSpaceContext();

    const viewRef = useRef<VirtualizedScrollViewRef>(null);

    const maxWidth = !isMobile ? "96" : undefined;

    const {output, queryText, onQueryTextChange} = useSearchState({
        initialQueryText: "",
        debugOptions: null,
        affinityResults,
    });

    const results = output.results ?? emptyArray;
    const shouldShowLoadingIndicator = useDelayLoadingIndicator(output.isPending);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout: isMobile,
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
                        spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]],
                        spacing[searchMobileInputMarginTop],
                        minSearchMobileInputHeight,
                        spacing[searchMobileInputMarginBottom],
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
                                            border: "grey-20",
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
                            {results.length === 0 && (
                                <Box
                                    color="grey-50"
                                    paddingX={screenPaddingX}
                                    paddingTop="1"
                                    style={contentStyles.paragraphFontSize}
                                >
                                    {queryText.trim().length === 0 ? (
                                        <>
                                            As you explore, content you’ve recently visited will
                                            show up here. For now, try searching.
                                        </>
                                    ) : (
                                        <>
                                            Couldn’t find anything matching “
                                            <span
                                                className={sprinkles({
                                                    color: "grey-70",
                                                    fontStyle: "bold",
                                                })}
                                            >
                                                {queryText}
                                            </span>
                                            .” Try a different search?
                                        </>
                                    )}
                                </Box>
                            )}
                        </>
                    ),
                };
            }

            index -= 1;

            const result = results[index]!;

            const isFirstItem = index === 0;
            const isLastItem = index === results.length - 1;

            return {
                key: `Loaded:${result.id}`,
                minHeight: minSearchResultViewHeight,
                node: (
                    <Box width="full" maxWidth={maxWidth} marginX="center">
                        <SearchMobileViewResult
                            spaceId={space.id}
                            searchKey={output.key}
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
            isMobile,
            maxWidth,
            onQueryTextChange,
            output.key,
            queryText,
            results,
            shouldShowLoadingIndicator,
            space.id,
            space.name,
        ],
    );

    return (
        <VirtualizedScrollView
            ref={viewRef}
            elementRef={scrollViewRef}
            scrollbarInsetTop={scrollbarInsetTop}
            extraChildren={navigationBar}
            itemCount={1 + results.length}
            bufferedItemHeight={minSearchResultViewHeight}
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

function SearchMobileViewResult({
    spaceId,
    searchKey,
    result,
    isFirstItem,
    isLastItem,
}: {
    spaceId: SpaceId;
    searchKey: string;
    result: SearchResult;
    isFirstItem: boolean;
    isLastItem: boolean;
}) {
    const navigate = useNavigate();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            navigate(
                getSearchResultDestinationPath({
                    spaceId: spaceId,
                    resultId: result.id,
                    options: {
                        searchKey,
                        withDesktopLayout: false,
                    },
                }),
            );
        },
    });

    return (
        <Box {...pressProps}>
            <SearchResultView
                paddingX={screenPaddingX}
                marginX="0"
                isPressed={isPressed}
                result={result}
                withMarginTop={isFirstItem}
                withMarginBottom={isLastItem}
                withBorderTop={isFirstItem}
            />
        </Box>
    );
}
