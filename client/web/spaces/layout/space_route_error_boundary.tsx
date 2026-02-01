import {ArrowLeft} from "phosphor-react";
import {useMemo} from "react";
import {useLocation, useRouteError} from "react-router";
import {Box} from "~/client/web/design/box.js";
import {ErrorBodyRenderer} from "~/client/web/design/error_body_renderer.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {
    navigationBarHeight,
    navigationBarMobileGap,
} from "~/client/web/design/navigation_bar_helpers.js";
import {useStableValue} from "~/client/web/helpers/use_stable_value.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {getWebMobileTabFromLocation} from "~/client/web/spaces/layout/web_mobile_tab.js";
import {useRouteErrorTitle} from "~/client/web/spaces/route_metadata.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    spaceLayoutErrorRendererPaddingX,
    spaceLayoutErrorRendererPaddingY,
} from "~/client/web/styles/space_layout_shared_styles.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";

export function SpaceRouteErrorBoundary() {
    const platform = usePlatform();
    const {isNativeMobile} = useClientInfo();
    const navigate = useNavigate();
    const location = useLocation();
    const {currentAccount} = useSpaceContext();

    // Is this the initial location for a tab? If so we don't want to render the
    // back button since there's nothing to go back to.
    //
    // The `getWebMobileTabFromPathname()` returns a tab if the pathname is a root
    // tab location and null otherwise. Even though the function was not made for
    // this purpose it still gets the job done.
    const isTabRootLocation = useMemo(
        () => !!(platform === "mobile" ? getWebMobileTabFromLocation(location) : null),
        [platform, location],
    );

    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, useRouteError());

    return (
        <Box width="full" paddingY="safe-area-inset">
            {platform === "mobile" && (
                <Box
                    height={navigationBarHeight}
                    paddingX={navigationBarMobileGap}
                    display="flex"
                    alignItems="center"
                >
                    {!isTabRootLocation &&
                        // Don't show the back button if the actor doesn't have space access. If the
                        // actor doesn't have space access they're probably looking at a shared URL in
                        // their web browser. So they're not in an application context. A back button
                        // doesn't make sense in a non-application context.
                        (currentAccount || isNativeMobile) && (
                            <IconButton
                                size="base"
                                description="Go back"
                                withoutTooltip={true}
                                pressErrorTitle="Couldn&#x2019;t go back"
                                onPress={() => navigate(-1)}
                            >
                                <ArrowLeft />
                            </IconButton>
                        )}
                </Box>
            )}
            <Box display="flex" justifyContent="center">
                <Box
                    width="full"
                    maxWidth="128"
                    paddingX={spaceLayoutErrorRendererPaddingX}
                    paddingY={spaceLayoutErrorRendererPaddingY}
                >
                    <ErrorBodyRenderer title={useRouteErrorTitle()} error={error} />
                </Box>
            </Box>
        </Box>
    );
}
