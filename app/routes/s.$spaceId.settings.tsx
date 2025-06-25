import {Outlet, useLocation, useNavigation} from "@remix-run/react";
import {IconContext, Users} from "phosphor-react";
import {ReactNode} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {navigationBarHeight} from "~/client/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {SpaceRouteScrollView} from "~/client/navigation/space_route_scroll_view.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useRootNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {
    spaceSettingsDesktopSidebarWidth,
    spaceSettingsMaxDesktopContentWidth,
} from "~/client/styles/space_settings_shared_styles.js";
import {colorSchemeVars, grey5SemiTransparentColorVar} from "~/client/styles/styles.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";

const titleBySettingsRoute = {
    general: "General settings",
    people: "People settings",
} as const;
type SettingsRoute = keyof typeof titleBySettingsRoute;

function parseSettingsRouteFromPathname(pathname: string): SettingsRoute {
    const match = pathname.match(/^\/s\/([^/]+)\/settings\/([^/]+)/);

    // NOTE: The match should always be defined because we're using a (route loader)[1]
    // to redirect to the general settings page.
    //
    // If it is not defined then we should throw an error to make sure it breaks loudly.
    //
    // [1]: app/routes/s.$spaceId.settings._index.tsx
    assert(match);
    assert(match[2]);

    assert(hasOwnProperty(titleBySettingsRoute, match[2]));

    // NOTE(rohit/16-05-25): The above assertions should ensure that this cast is safe.
    return match[2] as SettingsRoute;
}

export function meta({location}: {location: Location}) {
    const pathname = location.pathname;
    const currentRoute = parseSettingsRouteFromPathname(pathname);
    const title = currentRoute ? titleBySettingsRoute[currentRoute] : "Settings";

    return [{title: `${title}${metaTitlePostfix}`}];
}

function SettingsNavigationItem({
    icon,
    label,
    isActive,
    onPressStart,
}: {
    icon: ReactNode;
    label: string;
    isActive?: boolean;
    onPressStart: () => void;
}) {
    const {pressProps} = usePress({
        onPressStart,
    });

    return (
        <li>
            <FocusRing offset="inset">
                <Box
                    {...pressProps}
                    tabIndex={0}
                    position="relative"
                    zIndex="0"
                    paddingX="2.5"
                    paddingY="2"
                    display="flex"
                    alignItems="center"
                    gap="1.5"
                    backgroundColor={isActive ? "grey-5" : undefined}
                    borderRadius="1"
                    aria-label={label}
                    aria-current={isActive ? "page" : undefined}
                    fontSize="75"
                    role="link"
                >
                    <IconContext.Provider
                        value={{
                            size: spacing["4"],
                            color: colorSchemeVars[isActive ? "grey-100" : "grey-70"],
                        }}
                    >
                        {icon}
                    </IconContext.Provider>
                    <Box color={isActive ? "grey-100" : "grey-90"}>{label}</Box>
                </Box>
            </FocusRing>
        </li>
    );
}

export default function SettingsLayout() {
    if (process.env.NODE_ENV === "production")
        throw new UnimplementedError("Shouldn’t be able to open settings in production");

    const platform = usePlatform();

    const location = useLocation();
    const navigation = useNavigation();
    const isMobile = platform === "mobile";

    const currentPathname = location.pathname;
    const nextPathname = (navigation.location ?? location)?.pathname;

    const currentRoute = parseSettingsRouteFromPathname(currentPathname);

    // First check if we're actually trying to parse a settings route
    // If this isn't a settings route at all (e.g., navigating to /home),
    // then just use "general" as a default to avoid throwing errors.
    //
    // FYI, it doesn't matter what we use here because we'll always
    // redirect to the non-settings route.
    const isSettingsRoute = nextPathname.match(/^\/s\/([^/]+)\/settings(?:\/|$)/);
    let nextRoute: SettingsRoute = currentRoute;
    if (isSettingsRoute) {
        nextRoute = parseSettingsRouteFromPathname(nextPathname);
    }

    const title = titleBySettingsRoute[currentRoute];

    if (isMobile) {
        return (
            <SpaceRouteScrollView
                title={title}
                titleJustifyContent="center"
                desktopMaxWidth={spaceSettingsMaxDesktopContentWidth}
                withoutDisappearingTitle
            >
                <Box width="full" paddingX={screenPaddingX}>
                    <Outlet />
                </Box>
            </SpaceRouteScrollView>
        );
    }

    return <SettingsDesktopLayout nextRoute={nextRoute} title={title} />;
}

function SettingsDesktopLayout({nextRoute, title}: {nextRoute: SettingsRoute; title: string}) {
    const {space} = useSpaceContextAndRequireSpaceAccess();
    const rootNavigate = useRootNavigate();

    const renderRowLayout = (sidebarChildren: ReactNode, contentChildren: ReactNode) => (
        <Box display="flex" justifyContent="center" paddingX={screenPaddingX}>
            <Box flexShrink="0" width={spaceSettingsDesktopSidebarWidth}>
                {sidebarChildren}
            </Box>
            <Box
                width="full"
                maxWidth={spaceSettingsMaxDesktopContentWidth}
                style={{flexShrink: 1}}
            >
                {contentChildren}
            </Box>
            <Box
                // This element centers our content on large screens and then is shrinkable so
                // it'll shrink to nothing on small screens.
                width={spaceSettingsDesktopSidebarWidth}
                style={{flexShrink: 1_000_000}}
            />
        </Box>
    );

    return (
        <Box
            position="relative"
            zIndex="0"
            flexGrow="1"
            width="full"
            height="full"
            display="flex"
            flexDirection="column"
        >
            <Box position="relative" zIndex="20" flexShrink="0" paddingTop="safe-area-inset">
                <Box height={navigationBarHeight}>
                    {renderRowLayout(
                        null,
                        <Box
                            position="relative"
                            fontSize="400"
                            fontStyle="bold"
                            height="14"
                            display="flex"
                            alignItems="center"
                            userSelect="text"
                        >
                            {title}
                            <Box
                                pointerEvents="none"
                                position="absolute"
                                height="border"
                                style={{
                                    bottom: -1,
                                    // It's subtle, but `grey5SemiTransparentColorVar` ends up looking a lot nicer
                                    // than if we used `grey-5` directly. This is because the border operates more
                                    // like a shadow. When rendered over some other content (e.g. an image) the
                                    // image's colors show through the border but a little darker.
                                    backgroundColor: grey5SemiTransparentColorVar,
                                    left: `max(-${spacing["3"]}, (100% - ${spacing[spaceSettingsMaxDesktopContentWidth]}) / 2 - ${spacing["3"]})`,
                                    right: `max(-${spacing["3"]}, (100% - ${spacing[spaceSettingsMaxDesktopContentWidth]}) / 2 - ${spacing["3"]})`,
                                    maskImage: `linear-gradient(to right, transparent, black ${spacing["3"]} calc(100% - ${spacing["3"]}), transparent)`,
                                }}
                            />
                        </Box>,
                    )}
                </Box>
            </Box>
            <Box
                pointerEvents="none"
                position="absolute"
                zIndex="10"
                left="0"
                right="0"
                style={{
                    top: `calc(${spacing[navigationBarHeight]} + var(--safe-area-inset-top, 0px))`,
                }}
            >
                {renderRowLayout(
                    <Box pointerEvents="auto" paddingRight="8">
                        <nav aria-label="Settings navigation">
                            <ul style={{listStyle: "none", margin: 0, padding: 0}}>
                                <SettingsNavigationItem
                                    icon={<BuildingsIcon />}
                                    label="General"
                                    isActive={nextRoute === "general"}
                                    onPressStart={() => {
                                        rootNavigate(`/s/${space.id}/settings/general`);
                                    }}
                                />
                                <SettingsNavigationItem
                                    icon={<Users />}
                                    label="People"
                                    isActive={nextRoute === "people"}
                                    onPressStart={() => {
                                        rootNavigate(`/s/${space.id}/settings/people`);
                                    }}
                                />
                            </ul>
                        </nav>
                    </Box>,
                    null,
                )}
            </Box>
            <Box
                ref={useScrollbar()}
                flexGrow="1"
                position="relative"
                zIndex="0"
                overflowX="hidden"
                overflowY="auto"
            >
                <OverlayScopeContextProvider>
                    {renderRowLayout(
                        null,
                        <>
                            <Box paddingY="8">
                                <Outlet />
                            </Box>
                            <Box height="safe-area-inset-bottom" />
                        </>,
                    )}
                </OverlayScopeContextProvider>
            </Box>
        </Box>
    );
}
