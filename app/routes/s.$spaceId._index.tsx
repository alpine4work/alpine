import {ArrowRight} from "phosphor-react";
import {useEffect, useRef} from "react";
import {useSearchParams} from "react-router-dom";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {SpaceRouteScrollView} from "~/client/spaces/space_route_scroll_view.js";
import {screenPaddingX} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export function meta() {
    return [{title: `Home${metaTitlePostfix}`}];
}

export default function HomeRoute() {
    const isMobile = useIsMobile();
    const rootNavigate = useRootNavigate();
    const {space} = useSpaceContext();
    const [searchParams, setSearchParams] = useSearchParams();

    const maxWidth = !isMobile ? "96" : undefined;

    useEffect(() => {
        if (space.alphaAccessDefaultChannelId && searchParams.get("navigated") !== "yes") {
            const newSearchParams = new URLSearchParams(searchParams);
            newSearchParams.set("navigated", "yes");
            setSearchParams(newSearchParams, {replace: true});
        }
    }, [searchParams, setSearchParams, space.alphaAccessDefaultChannelId]);

    const lastSearchParamsRef = useRef(searchParams);
    useEffect(() => {
        if (lastSearchParamsRef.current === searchParams) return;
        const lastSearchParams = lastSearchParamsRef.current;
        lastSearchParamsRef.current = searchParams;

        if (
            space.alphaAccessDefaultChannelId &&
            lastSearchParams.get("navigated") !== "yes" &&
            searchParams.get("navigated") === "yes"
        ) {
            void rootNavigate(`/s/${space.id}/channels/${space.alphaAccessDefaultChannelId}`);
        }
    }, [rootNavigate, searchParams, space.alphaAccessDefaultChannelId, space.id]);

    return (
        <SpaceRouteScrollView
            withMobileLayout={isMobile}
            title="Home"
            withoutDisappearingTitle={true}
            titleJustifyContent="center"
            desktopMaxWidth={maxWidth}
            // This is a route for a root tab in our mobile app so don't show the back
            // button. It wouldn't work.
            withoutMobileBackButton={true}
        >
            <Box width="full" maxWidth={maxWidth} marginX="center">
                <Box
                    paddingX={contentSchemaStyles.screenPaddingXWithoutBlockPaddingX}
                    userSelect="text"
                >
                    <p className={contentSchemaStyles.paragraphClassName}>
                        Eventually, we’ll have something smart for you here in the home tab but
                        nothing’s been implemented yet. All the other tabs work. Try creating
                        something from the create tab or searching for content from the search tab.
                    </p>
                    <p className={contentSchemaStyles.paragraphClassName}>
                        Thanks for being an alpha user! We appreciate you.
                    </p>
                </Box>
                {space.alphaAccessDefaultChannelId && (
                    <Box paddingTop="4" paddingX={screenPaddingX}>
                        <Button
                            fullWidth
                            icon={<ArrowRight weight="bold" />}
                            iconPlacement="end"
                            variant="accent"
                            pressErrorTitle="Couldn’t go to welcome channel"
                            onPress={() =>
                                rootNavigate(
                                    `/s/${space.id}/channels/${assertExists(
                                        space.alphaAccessDefaultChannelId,
                                    )}`,
                                )
                            }
                        >
                            <Box fontStyle="semi-bold">Go to welcome channel</Box>
                        </Button>
                    </Box>
                )}
            </Box>
        </SpaceRouteScrollView>
    );
}
