import {useCallback, useRef} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {navigationBarHeight, useNavigationBar} from "~/client/design/navigation_bar.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/design/text_area_with_auto_growing_height.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {getSearchResultDestinationPath} from "~/client/search/internal/get_search_result_destination_path.js";
import {
    SearchResultView,
    minSearchResultViewHeight,
} from "~/client/search/internal/search_result_view.js";
import {useSearchState} from "~/client/search/use_search_state.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    VirtualizedScrollView,
    VirtualizedScrollViewItem,
    VirtualizedScrollViewRef,
} from "~/client/virtualized/virtualized_scroll_view.js";
import {
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {SearchResult} from "~/shared/search/search_result.js";
import {fontSizes, sprinkles} from "~/shared/styles/styles.js";

const searchInputFontSize = "100";
const searchInputPaddingX = "3";
const searchInputPaddingY = "2";

const minSearchInputHeight = addRemLengths(
    spacing[searchInputPaddingY],
    fontSizes[searchInputFontSize].lineHeight,
    spacing[searchInputPaddingY],
);

const searchInputBorderRadius = `${parseRemLengthNumber(minSearchInputHeight) / 2}rem`;

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

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout: isMobile,
        title: "Search",
        withoutDisappearingTitle: true,
        titleJustifyContents: "center",
        desktopMaxWidth: maxWidth,
        // This is a route for a root tab in our mobile app so don't show the back
        // button. It wouldn't work.
        withoutMobileBackButton: true,
    });

    const renderItem = useCallback(
        (index: number): VirtualizedScrollViewItem => {
            if (index === 0) {
                const navigationBarMarginBottom = "1";
                const inputMarginBottom = "3";

                return {
                    key: "Header",
                    minHeight: addRemLengths(
                        spacing[navigationBarHeight[isMobile ? "mobile" : "desktop"]],
                        spacing[navigationBarMarginBottom],
                        minSearchInputHeight,
                        spacing[inputMarginBottom],
                    ),
                    node: (
                        <>
                            <Box height="safe-area-inset-top" />
                            <Box height={navigationBarHeight} />
                            <Box
                                // Make sure the iOS text selection lollipops the cursor doesn't get clipped by
                                // the navbar.
                                height={navigationBarMarginBottom}
                            />
                            <Box
                                width="full"
                                maxWidth={maxWidth}
                                paddingX={screenPaddingX}
                                marginX="center"
                            >
                                <TextAreaWithAutoGrowingHeight
                                    className={sprinkles({
                                        width: "full",
                                        paddingX: searchInputPaddingX,
                                        paddingY: searchInputPaddingY,
                                        backgroundColor: "grey-0",
                                        border: "grey-20",
                                        fontSize: searchInputFontSize,
                                        fontStyle: "normal",
                                    })}
                                    style={{
                                        borderRadius: searchInputBorderRadius,
                                    }}
                                    placeholder={`Search ${space.name}…`}
                                    value={queryText}
                                    onChange={event => onQueryTextChange(event.currentTarget.value)}
                                />
                            </Box>
                            <Box height={inputMarginBottom} />
                        </>
                    ),
                };
            }

            index -= 1;

            const result = (output.results ?? [])[index]!;

            const isFirstEntry = index === 0;
            const isLastEntry = index === (output.results ?? []).length - 1;

            return {
                key: `Loaded:${result.id}`,
                minHeight: minSearchResultViewHeight,
                node: (
                    <Box width="full" maxWidth={maxWidth} marginX="center">
                        <SearchMobileViewResult
                            spaceId={space.id}
                            searchKey={output.key}
                            result={result}
                            isFirstEntry={isFirstEntry}
                            isLastEntry={isLastEntry}
                        />
                        {isLastEntry && <Box height="safe-area-inset-bottom" />}
                    </Box>
                ),
            };
        },
        [
            isMobile,
            maxWidth,
            onQueryTextChange,
            output.key,
            output.results,
            queryText,
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
            itemCount={1 + (output.results?.length ?? 0)}
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
    isFirstEntry,
    isLastEntry,
}: {
    spaceId: SpaceId;
    searchKey: string;
    result: SearchResult;
    isFirstEntry: boolean;
    isLastEntry: boolean;
}) {
    const navigate = useNavigate();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            // TODO(calebmer, #global-loading-indicator): Some kind of global loading
            // indicator.
            void navigate(getSearchResultDestinationPath(spaceId, result.id, searchKey));
        },
    });

    return (
        <Box {...pressProps}>
            <SearchResultView
                paddingX={screenPaddingX}
                marginX="0"
                isPressed={isPressed}
                result={result}
                isFirstEntry={isFirstEntry}
                isLastEntry={isLastEntry}
                withBorderTop={isFirstEntry}
            />
        </Box>
    );
}
