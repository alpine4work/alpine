import {ArrowLeft} from "phosphor-react";
import {useMemo} from "react";
import {useLocation} from "react-router";
import {Box} from "~/client/design/box.js";
import {ErrorBodyRenderer} from "~/client/design/error_body_renderer.js";
import {IconButton} from "~/client/design/icon_button.js";
import {
    mobileNavigationBarGap,
    navigationBarHeight,
} from "~/client/design/navigation_bar_helpers.js";
import {useStableValue} from "~/client/helpers/use_stable_value.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {getWebMobileTabFromPathname} from "~/client/spaces/layout/space_layout_web_mobile_tab_bar.js";
import {useRouteErrorTitle} from "~/client/spaces/route_error_title.js";
import {
    spaceLayoutErrorRendererPaddingX,
    spaceLayoutErrorRendererPaddingY,
} from "~/client/styles/space_layout_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";

export function SpaceRouteErrorRenderer({error: _error}: {error: unknown}) {
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const location = useLocation();

    // Is this the initial location for a tab? If so we don't want to render the
    // back button since there's nothing to go back to.
    //
    // The `getWebMobileTabFromPathname()` returns a tab if the pathname is a root
    // tab location and null otherwise. Even though the function was not made for
    // this purpose it still gets the job done.
    const isTabRootLocation = useMemo(
        () => !!(isMobile ? getWebMobileTabFromPathname(location.pathname) : null),
        [isMobile, location.pathname],
    );

    // It appears that Remix does not `useMemo()` its error object. So stabilize
    // the object reference here. Our error rendering components use referential
    // identity to determine whether we need to log the error.
    const error = useStableValue(ErrorSchema, _error);

    return (
        <Box width="full" paddingY="safe-area-inset">
            {isMobile && (
                <Box
                    height={navigationBarHeight}
                    paddingX={mobileNavigationBarGap}
                    display="flex"
                    alignItems="center"
                >
                    {!isTabRootLocation && (
                        <IconButton
                            size="base"
                            description="Go back"
                            withoutTooltip={true}
                            pressErrorTitle="Couldn’t go back"
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
