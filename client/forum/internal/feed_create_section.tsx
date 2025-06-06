import {IconContext} from "phosphor-react";
import {ReactNode, useRef, useState} from "react";
import {PressEvent, usePress} from "react-aria";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {useReporter} from "~/client/design/reporter.js";
import {useInitialAppRenderId} from "~/client/helpers/lifecycle/initial_app_render.js";
import {ChatBrandBigIcon} from "~/client/icons/brand/chat_brand_big_icon.js";
import {DocumentBrandBigIcon} from "~/client/icons/brand/document_brand_big_icon.js";
import {PostBrandBigIcon} from "~/client/icons/brand/post_brand_big_icon.js";
import {TaskBrandBigIcon} from "~/client/icons/brand/task_brand_big_icon.js";
import {peekMaxHeight} from "~/client/peek/peek_stack.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useLazyLoadRpc} from "~/client/rpc/use_lazy_load_rpc.js";
import {getSearchEntityPath} from "~/client/search/get_search_entity_path.js";
import {SearchAffinityEntityView} from "~/client/search/search_affinity_entity_view.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    feedCreateSectionButtonFontSize,
    feedCreateSectionButtonHeight,
    feedCreateSectionButtonNarrowRouteLayoutGap,
    feedCreateSectionButtonPaddingY,
    feedCreateSectionButtonSize,
    feedCreateSectionCreateHeadingMarginBottom,
    feedCreateSectionForYouHeadingMarginBottom,
    feedCreateSectionGap,
    feedCreateSectionHeadingFontSize,
    feedCreateSectionHeadingLineHeight,
    feedCreateSectionMarginTop,
    feedCreateSectionMinHeight,
    feedCreateSectionSuggestedHeadingMarginBottom,
} from "~/client/styles/feed_shared_styles.js";
import {searchAffinityEntityViewMinHeightPx} from "~/client/styles/search_shared_styles.js";
import {spaceLayoutWebMobileTabBarHeight} from "~/client/styles/space_layout_shared_styles.js";
import {colorSchemeVars} from "~/client/styles/styles.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.js";
import {generateId} from "~/shared/id/id.js";
import {RpcDefinitionOutputType} from "~/shared/rpc/rpc_definition.js";
import {
    markSearchAffinityEntityInteraction,
    searchByAffinity,
} from "~/shared/rpc/search_rpc_definitions.js";
import {SearchAffinityEntityResult} from "~/shared/search/search_affinity_entity_result.js";

export function FeedCreateSection({
    initialAffinitySearch,
}: {
    initialAffinitySearch: RpcDefinitionOutputType<typeof searchByAffinity>;
}) {
    const navigate = useNavigate();
    const initialAppRenderId = useInitialAppRenderId();
    const spacingScale = useSpacingScale();
    const routeLayout = useRouteLayout();
    const {space} = useSpaceContext();
    const clientInfo = useClientInfo();

    const [randomSeed] = useState(() =>
        initialAppRenderId ? `${initialAppRenderId}-FeedCreateSection` : generateId(),
    );

    // Even though we've already loaded the affinity search from the server, we
    // call `useLazyLoadRpc()` so that if you navigate away from the browser
    // then navigate back the affinity list is re-fetched. Also any time you
    // favorite/unfavorite something we revalidate the RPC cache for
    // `searchByAffinity()` which will cause this component to re-render.
    const {output: affinitySearchOutput} = useLazyLoadRpc(
        searchByAffinity,
        routeLayout === "narrow" ? {spaceId: space.id} : null,
        {initialOutput: initialAffinitySearch},
    );

    const availableHeight =
        Math.min(clientInfo.screenHeight, convertRemLengthToPx(peekMaxHeight, spacingScale)) -
        (convertRemLengthToPx(navigationBarHeight, spacingScale) +
            convertRemLengthToPx(feedCreateSectionMinHeight[routeLayout], spacingScale) +
            (NativeMobileBridge?.tabBar.height ??
                convertRemLengthToPx(spaceLayoutWebMobileTabBarHeight, spacingScale)) +
            // This is the amount of space we want to allocate for the beginning of the "For
            // you" feed.
            convertRemLengthToPx("16", spacingScale));

    // Show as many search affinity results as we can while also showing the
    // beginning of the for you feed above the fold so the user knows the for you
    // feed exists if they start scrolling.
    const visibleSearchAffinityResultCount = Math.max(
        3,
        Math.floor(availableHeight / searchAffinityEntityViewMinHeightPx[spacingScale]),
    );

    return (
        <Box
            style={
                routeLayout !== "narrow"
                    ? {height: feedCreateSectionMinHeight[routeLayout]}
                    : {minHeight: feedCreateSectionMinHeight[routeLayout]}
            }
        >
            <Box
                paddingX={screenPaddingX}
                paddingTop={feedCreateSectionMarginTop[routeLayout]}
                paddingBottom={feedCreateSectionCreateHeadingMarginBottom}
                fontSize={feedCreateSectionHeadingFontSize[routeLayout]}
                fontStyle={routeLayout !== "narrow" ? "bold" : "normal"}
                color={routeLayout !== "narrow" ? undefined : "grey-50"}
                style={{lineHeight: feedCreateSectionHeadingLineHeight[routeLayout]}}
            >
                Create
            </Box>
            <Box paddingX={screenPaddingX}>
                <Box
                    display="flex"
                    alignItems="center"
                    justifyContent="space-between"
                    style={{
                        // This is pretty brittle. We've carefully selected margin values that align
                        // our create buttons with surrounding UI elements.
                        //
                        // - Desktop (`routeLayout === "wide"`): We want to align the left edge of the
                        //   document icon with the section header text ("Create" and "For you").
                        //
                        // - Mobile (`routeLayout === "narrow"`): We want to align the text of our
                        //   first button ("Document") with the section header text ("Create" and
                        //   "Suggested").
                        margin:
                            routeLayout !== "narrow"
                                ? `0 -${addRemLengths(
                                      spacing["3"],
                                      spacing["1.5"],
                                      `${1 / remPxBySpacingScale.small}rem`,
                                  )}`
                                : `0 -${spacing["2.5"]}`,
                    }}
                >
                    <FeedCreateSectionButton
                        icon={<DocumentBrandBigIcon size={feedCreateSectionButtonSize} />}
                        label="Document"
                        description="Write stuff"
                        onPress={event => {
                            const documentId = generateId();

                            navigate(`/s/${space.id}/documents/${documentId}?create&focus`, {
                                // Don't open the new document in a peek. Instead open the new document full
                                // screen (unless shift is held). This is the only create button with this
                                // behavior. Ideally the create buttons get you off the home page and into
                                // precisely where you want to be in the product. We don't do this for tasks,
                                // posts, and messages since their designs all look better in a peek.
                                stopPropagation: !event.shiftKey,
                            });
                        }}
                    />
                    <FeedCreateSectionDivider />
                    <FeedCreateSectionButton
                        icon={<TaskBrandBigIcon size={feedCreateSectionButtonSize} />}
                        label="Task"
                        description="Track work"
                        onPress={() => {
                            const taskId = generateId();

                            navigate(`/s/${space.id}/tasks/${taskId}?create&focus`);
                        }}
                    />
                    <FeedCreateSectionDivider />
                    <FeedCreateSectionButton
                        icon={<PostBrandBigIcon size={feedCreateSectionButtonSize} />}
                        label="Post"
                        description="Share ideas"
                        onPress={() => {
                            const draftId = generateChronologicalId();

                            navigate(`/s/${space.id}/posts/new/${draftId}?focus=content`);
                        }}
                    />
                    <FeedCreateSectionDivider />
                    <FeedCreateSectionButton
                        icon={<ChatBrandBigIcon size={feedCreateSectionButtonSize} />}
                        label="Message"
                        description="Start a chat"
                        onPress={() => {
                            navigate(`/s/${space.id}/chat/new?focus=picker`);
                        }}
                    />
                </Box>
            </Box>
            {routeLayout === "narrow" && (
                <>
                    <Box height={feedCreateSectionGap[routeLayout]} />
                    <Box
                        paddingX={screenPaddingX}
                        paddingBottom={feedCreateSectionSuggestedHeadingMarginBottom}
                        fontSize={feedCreateSectionHeadingFontSize[routeLayout]}
                        fontStyle="normal"
                        color="grey-50"
                        style={{lineHeight: feedCreateSectionHeadingLineHeight[routeLayout]}}
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
            <Box height={feedCreateSectionGap[routeLayout]} />
            <Box
                paddingX={screenPaddingX}
                paddingBottom={feedCreateSectionForYouHeadingMarginBottom}
                fontSize={feedCreateSectionHeadingFontSize[routeLayout]}
                fontStyle={routeLayout !== "narrow" ? "bold" : "normal"}
                color={routeLayout !== "narrow" ? undefined : "grey-50"}
                style={{lineHeight: feedCreateSectionHeadingLineHeight[routeLayout]}}
            >
                For you
            </Box>
        </Box>
    );
}

function FeedCreateSectionDivider() {
    const routeLayout = useRouteLayout();
    if (routeLayout === "narrow") return null;

    return (
        <Box
            flexShrink="0"
            width="0"
            position="relative"
            style={{height: feedCreateSectionButtonHeight[routeLayout]}}
        >
            <Box
                position="absolute"
                top="0"
                bottom="0"
                left="0"
                width="border"
                backgroundColor="grey-5"
            />
        </Box>
    );
}

function FeedCreateSectionButton({
    icon,
    label,
    description,
    onPress,
}: {
    icon: ReactNode;
    label: string;
    description: string;
    onPress: (event: PressEvent) => void;
}) {
    const routeLayout = useRouteLayout();

    const {isPressed, pressProps} = usePress({
        onPress,
    });

    return (
        <FocusRing offset="inset" insetX="1">
            <Box
                {...pressProps}
                tabIndex={0}
                aria-label={label}
                position="relative"
                zIndex="0"
                paddingX={routeLayout !== "narrow" ? "3" : undefined}
                paddingY={feedCreateSectionButtonPaddingY}
                borderRadius="1"
                display="flex"
                flexDirection={routeLayout === "narrow" ? "column" : "row"}
                gap={routeLayout === "narrow" ? feedCreateSectionButtonNarrowRouteLayoutGap : "2.5"}
                alignItems="center"
                flexGrow="1"
                style={{
                    flexBasis: 0,
                    height: feedCreateSectionButtonHeight[routeLayout],
                    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
                    // have `min-width: auto` which extends with content.
                    // https://stackoverflow.com/a/66689926/1568890
                    minWidth: 0,
                }}
            >
                {isPressed && (
                    <Box
                        position="absolute"
                        zIndex="-10"
                        top="0"
                        bottom="0"
                        left={routeLayout !== "narrow" ? "1" : "0"}
                        right={routeLayout !== "narrow" ? "1" : "0"}
                        borderRadius="1"
                        backgroundColor="grey-10"
                    />
                )}
                <Box flexShrink="0">
                    <IconContext.Provider
                        value={{
                            color: isPressed
                                ? colorSchemeVars["grey-90"]
                                : colorSchemeVars["grey-80"],
                        }}
                    >
                        {icon}
                    </IconContext.Provider>
                </Box>
                <Box flexGrow="1">
                    <Box
                        fontSize={feedCreateSectionButtonFontSize[routeLayout]}
                        style={{
                            whiteSpace: "nowrap",
                            // `semi-bold` is too bold so manually set weight to something between `normal`
                            // and `semi-bold`. As of 2025-05-23, this is the same weight
                            // `<Button variant="neutral">` uses.
                            fontWeight: 425,
                        }}
                    >
                        {label}
                    </Box>
                    {routeLayout !== "narrow" && (
                        <Box
                            fontSize="50"
                            color="grey-60"
                            marginBottom="-0.5"
                            style={{whiteSpace: "nowrap"}}
                        >
                            {description}
                        </Box>
                    )}
                </Box>
            </Box>
        </FocusRing>
    );
}

function FeedCreateSectionMobileSearchAffinityView({
    result,
    randomSeed,
}: {
    result: SearchAffinityEntityResult;
    randomSeed: string;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const hasMarkedAffinityInteractionRef = useRef(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            const path = getSearchEntityPath({
                spaceId: space.id,
                entityId: result.id,
                randomSeed,
                currentTime: new Date(),
                routeLayout: "narrow",
            });

            void navigate(path, {
                // When clicking on a path from the home sidebar, fully navigate the app to
                // that thing. Don't open it in a peek. The home page is your entrypoint into
                // the rest of the product. You won't be doing much work on the home page so we
                // don't need to open a peek that keeps you in context.
                stopPropagation: true,
            }).then(() => {
                // If user spam clicks an item, only mark affinity interaction once.
                if (hasMarkedAffinityInteractionRef.current) return;
                hasMarkedAffinityInteractionRef.current = true;

                // Whenever the user selects a suggested (or favorite) result, we record a high
                // intent affinity interaction. This is because the user opening a result from
                // the home view sidebar is super high signal that this is an entity they care
                // about. In this way the suggested list is a self reinforcing system. The more
                // a user selects an entity, the higher the entity will appear in the user's
                // next search.
                markSearchAffinityEntityInteraction(context, {
                    spaceId: space.id,
                    entityId: result.id,
                    interaction: {type: "HighIntentUpdate"},
                }).catch(error => {
                    // Silently fail. This doesn't affect anything the user sees so we don't need
                    // to report the error to the user.
                    reporter.logErrorWithoutDisplaying(
                        "Couldn't mark search result select affinity interaction",
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
