import {useRef, useState} from "react";
import {usePress} from "react-aria";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useLazyLoadRpc} from "~/client/web/rpc/use_lazy_load_rpc.js";
import {getSearchEntityPath} from "~/client/web/search/core/get_search_entity_path.js";
import {useSearchEntityModel} from "~/client/web/search/core/search_entity_registry_context.js";
import {SearchAffinityEntityView} from "~/client/web/search/search_affinity_entity_view.js";
import {useSetSearchQueryText} from "~/client/web/search/use_set_search_query_text.js";
import {CreateWidgetPrimaryMenuBar} from "~/client/web/spaces/layout/create_widget_primary_menu_bar.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    createWidgetPrimaryMenuBarItemBackgroundInsetY,
    createWidgetPrimaryMenuBarItemDesktopPaddingX,
    feedCreateSectionForYouHeadingMarginBottom,
    feedCreateSectionGap,
    feedCreateSectionHeadingFontSize,
    feedCreateSectionHeadingLineHeight,
    feedCreateSectionMinHeight,
    feedCreateSectionSearchBarContainerPaddingX,
    feedCreateSectionSearchBarContainerPaddingY,
    feedCreateSectionSuggestedHeadingMarginBottom,
} from "~/client/web/styles/feed_shared_styles.js";
import {peekMaxHeight} from "~/client/web/styles/peek_shared_styles.js";
import {searchAffinityEntityViewMinHeightPx} from "~/client/web/styles/search_shared_styles.js";
import {spaceLayoutWebMobileTabBarHeight} from "~/client/web/styles/space_layout_shared_styles.js";
import {inputPlaceholderStyles} from "~/client/web/styles/styles.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/core/spacing.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {generateId} from "~/shared/id/id.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {
    markSearchAffinityEntityInteraction,
    searchByAffinity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchAffinityEntityResultModel} from "~/shared/search/search_entity_result_model.js";

export function FeedCreateSection({
    initialAffinitySearch,
}: {
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const initialAppRenderId = useInitialAppRenderId();
    const {space} = useSpaceContext();
    const clientInfo = useClientInfo();

    const [randomSeed] = useState(() =>
        initialAppRenderId ? `${initialAppRenderId}-FeedCreateSection` : generateId(),
    );

    // Even though we've already loaded the affinity search from the server, we call
    // `useLazyLoadRpc()` so that if you navigate away from the browser then navigate
    // back the affinity list is re-fetched. Also any time you favorite/unfavorite
    // something we revalidate the RPC cache for `searchByAffinity()` which will cause
    // this component to re-render.
    const {output: affinitySearchOutput} = useLazyLoadRpc(
        searchByAffinity,
        routeLayout === "narrow" ? {spaceId: space.id} : null,
        {initialOutput: initialAffinitySearch},
    );

    const availableHeight =
        Math.min(clientInfo.screenHeight, convertRemLengthToPx(peekMaxHeight, spacingScale)) -
        (convertRemLengthToPx(navigationBarHeight, spacingScale) +
            convertRemLengthToPx(feedCreateSectionMinHeight[platform], spacingScale) +
            (NativeMobileBridge?.tabBar.height ??
                convertRemLengthToPx(spaceLayoutWebMobileTabBarHeight, spacingScale)) +
            // This is the amount of space we want to allocate for the beginning of the "For
            // you" feed.
            convertRemLengthToPx("16", spacingScale));

    // Show as many search affinity results as we can while also showing the beginning
    // of the for you feed above the fold so the user knows the for you feed exists if
    // they start scrolling.
    const visibleSearchAffinityResultCount = Math.max(
        3,
        Math.floor(availableHeight / searchAffinityEntityViewMinHeightPx[spacingScale]),
    );

    return (
        <Box
            style={
                routeLayout !== "narrow"
                    ? {height: feedCreateSectionMinHeight[platform]}
                    : {minHeight: feedCreateSectionMinHeight[platform]}
            }
        >
            {platform === "desktop" && <FeedCreateSectionSearchBar />}
            {platform !== "desktop" && (
                <Box
                    paddingX={screenPaddingX}
                    paddingBottom={feedCreateSectionSuggestedHeadingMarginBottom}
                    fontSize={feedCreateSectionHeadingFontSize[platform]}
                    fontStyle="normal"
                    color="grey-50"
                    style={{lineHeight: feedCreateSectionHeadingLineHeight[platform]}}
                >
                    Create
                </Box>
            )}
            <Box
                paddingX={platform === "desktop" ? screenPaddingX : undefined}
                marginX={
                    platform === "desktop"
                        ? `-${createWidgetPrimaryMenuBarItemDesktopPaddingX}`
                        : undefined
                }
                marginTop={`-${createWidgetPrimaryMenuBarItemBackgroundInsetY}`}
                marginBottom={
                    platform !== "desktop"
                        ? `-${createWidgetPrimaryMenuBarItemBackgroundInsetY}`
                        : undefined
                }
            >
                <CreateWidgetPrimaryMenuBar
                    withOwnKeyboardShortcut={false}
                    withRootNavigateToCreatedDocument={true}
                    onCloseWithAnimation={noop}
                    onCloseWithoutAnimation={noop}
                    onFocusSecondaryMenuBar={noop}
                />
            </Box>
            {platform === "mobile" && (
                <>
                    <Box height={feedCreateSectionGap[platform]} />
                    <Box
                        paddingX={screenPaddingX}
                        paddingBottom={feedCreateSectionSuggestedHeadingMarginBottom}
                        fontSize={feedCreateSectionHeadingFontSize[platform]}
                        fontStyle="normal"
                        color="grey-50"
                        style={{lineHeight: feedCreateSectionHeadingLineHeight[platform]}}
                    >
                        Suggested
                    </Box>
                    {mapIterable(
                        sliceIterable(
                            affinitySearchOutput?.results ?? emptyArray,
                            0,
                            visibleSearchAffinityResultCount,
                        ),
                        result => (
                            <FeedCreateSectionMobileSearchAffinityView
                                key={result.id}
                                result={result}
                                randomSeed={randomSeed}
                            />
                        ),
                    )}
                </>
            )}
            <Box height={feedCreateSectionGap[platform]} />
            <Box
                paddingX={screenPaddingX}
                paddingBottom={feedCreateSectionForYouHeadingMarginBottom}
                fontSize={feedCreateSectionHeadingFontSize[platform]}
                fontStyle={routeLayout !== "narrow" ? "bold" : "normal"}
                color={routeLayout !== "narrow" ? undefined : "grey-50"}
                style={{lineHeight: feedCreateSectionHeadingLineHeight[platform]}}
            >
                For you
            </Box>
        </Box>
    );
}

function FeedCreateSectionSearchBar() {
    const clientInfo = useClientInfo();
    const {space} = useSpaceContext();

    const setSearchQueryText = useSetSearchQueryText();

    const {pressProps} = usePress({
        onPressStart: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType === "mouse") {
                setSearchQueryText("");
            }
        },
        onPress: event => {
            // Focus on `pointerdown` if this is the mouse. Focus on `pointerup` if this is
            // touch. Because a touch press gesture might actually be a scroll. If the user
            // starts scrolling that cancels our press.
            if (event.pointerType !== "mouse") {
                setSearchQueryText("");
            }
        },
    });

    return (
        <Box
            height={navigationBarHeight}
            paddingX={feedCreateSectionSearchBarContainerPaddingX}
            paddingY={feedCreateSectionSearchBarContainerPaddingY}
        >
            <Box
                {...pressProps}
                position="relative"
                display="flex"
                alignItems="center"
                height="full"
                paddingX="4"
                boxShadow="elevation-5-with-grey-10-border"
                fontSize="75"
                fontStyle="truncate"
                borderRadius="full"
                cursor="text"
                style={{...inputPlaceholderStyles}}
            >
                Search {space.name}
                <Box position="absolute" right="4" color="grey-50" fontSize="50">
                    {renderKeyboardShortcutHint(clientInfo, "mod", "p")}
                </Box>
            </Box>
        </Box>
    );
}

function FeedCreateSectionMobileSearchAffinityView({
    result,
    randomSeed,
}: {
    result: SearchAffinityEntityResultModel;
    randomSeed: string;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const navigate = useNavigate();
    const {space} = useSpaceContext();
    const entityData = useSearchEntityModel(result.model);

    const hasMarkedAffinityInteractionRef = useRef(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            const path = getSearchEntityPath({
                spaceId: space.id,
                entityData,
                randomSeed,
                currentTime: new Date(),
                routeLayout: "narrow",
            });

            void navigate(path, {
                // When clicking on a path from the home sidebar, fully navigate the app to that
                // thing. Don't open it in a peek. The home page is your entrypoint into the rest
                // of the product. You won't be doing much work on the home page so we don't need
                // to open a peek that keeps you in context.
                stopPropagation: true,
            }).then(() => {
                // If user spam clicks an item, only mark affinity interaction once.
                if (hasMarkedAffinityInteractionRef.current) return;
                hasMarkedAffinityInteractionRef.current = true;

                // Whenever the user selects a suggested (or favorite) result, we record a high
                // intent affinity interaction. This is because the user opening a result from the
                // home view sidebar is super high signal that this is an entity they care about.
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
            });
        },
    });

    return (
        <Box
            {...pressProps}
            paddingX={screenPaddingX}
            backgroundColor={isPressed ? "grey-10" : undefined}
        >
            <SearchAffinityEntityView result={result} lineClamp={1} />
        </Box>
    );
}
