import {useCallback, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextAreaWithAutoGrowingHeight} from "~/client/design/text_area_with_auto_growing_height.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {SearchInstructionalPlaceholder} from "~/client/search/search_instructional_placeholder.js";
import {useSearchState} from "~/client/search/use_search_state.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {
    addRemLengths,
    parseRemLengthNumber,
    screenPaddingX,
    spacing,
} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {fontSizes, sprinkles} from "~/shared/styles/styles.js";

export function meta() {
    return [{title: `Search${metaTitlePostfix}`}];
}

const searchInputFontSize = "100";
const searchInputPaddingX = "3";
const searchInputPaddingY = "2";

const minSearchInputHeight = addRemLengths(
    spacing[searchInputPaddingY],
    fontSizes[searchInputFontSize].lineHeight,
    spacing[searchInputPaddingY],
);

const searchInputBorderRadius = `${parseRemLengthNumber(minSearchInputHeight) / 2}rem`;

export default function SearchRoute() {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const scrollViewRef = useRef<HTMLDivElement>(null);

    const maxWidth = !isMobile ? "96" : undefined;

    const {output, queryText, onQueryTextChange} = useSearchState({
        initialQueryText: "",
        getResultListHeight: useCallback(
            () => assertExists(scrollViewRef.current).clientHeight,
            [],
        ),
        debugOptions: null,
    });

    return (
        <SpaceRouteScrollView
            ref={scrollViewRef}
            withMobileLayout={isMobile}
            title="Search"
            withoutDisappearingTitle={true}
            titleJustifyContents="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
            // Needs to be a direct child so absolute positioning can be relative to the
            // scrollable element, not the content element.
            directChildren={
                <Box
                    position="absolute"
                    inset="0"
                    pointerEvents="none"
                    display="flex"
                    justifyContent="center"
                    alignItems="flex-end"
                >
                    <Box
                        pointerEvents="auto"
                        width="full"
                        maxWidth={maxWidth}
                        paddingX={screenPaddingX}
                        paddingBottom={screenPaddingX}
                    >
                        <SearchInstructionalPlaceholder />
                        <Box
                            style={{height: "var(--safe-area-inset-bottom-without-keyboard, 0px)"}}
                        />
                    </Box>
                </Box>
            }
        >
            <Box width="full" maxWidth={maxWidth} paddingX={screenPaddingX} marginX="center">
                <Spacer
                    // Make sure the iOS text selection lollipops the cursor doesn't get clipped by
                    // the navbar.
                    space="1"
                />
                <TextAreaWithAutoGrowingHeight
                    className={sprinkles({
                        width: "full",
                        paddingX: searchInputPaddingX,
                        paddingY: searchInputPaddingY,
                        backgroundColor: "grey-0",
                        border: "grey-10",
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
        </SpaceRouteScrollView>
    );
}
