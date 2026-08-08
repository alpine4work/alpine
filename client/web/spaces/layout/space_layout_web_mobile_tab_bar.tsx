import {differenceInMinutes} from "date-fns/differenceInMinutes";
import {Bell, House, IconContext, List, MagnifyingGlass, Plus} from "phosphor-react";
import {ReactNode, useCallback, useContext, useMemo} from "react";
import {usePress} from "react-aria";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext, useLocation} from "react-router";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {useRynamoItem} from "~/client/web/dynamo/use_rynamo_item.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useSessionStorage} from "~/client/web/helpers/use_local_storage.js";
import {LoudNotificationBadge} from "~/client/web/inbox/loud_notification_badge.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useCurrentTimeRoundedToNearestTenMinutes} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useMyAccountWebSocket, useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {inboxSubtleNotificationBadgePeaceMinutes} from "~/client/web/spaces/layout/internal/inbox_subtle_notification_badge_peace_minutes.js";
import {
    WebMobileTab,
    WebMobileTabSchema,
    getWebMobileTabFromLocation,
} from "~/client/web/spaces/layout/web_mobile_tab.js";
import {spaceLayoutWebMobileTabBarHeight} from "~/client/web/styles/space_layout_shared_styles.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    spaceLayoutStyles,
} from "~/client/web/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {RynamoItem} from "~/shared/dynamo/rynamo_types.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {
    safe,
    safeAlphanumericString,
    safeIdentifierString,
    safeJoin,
} from "~/shared/helpers/string/safe_string.js";
import {InboxModel} from "~/shared/notifications/inbox_model.js";
import {getInboxWithStrongReadConsistency} from "~/shared/rpc/notifications_rpc_definitions.js";

export function SpaceLayoutWebMobileTabBar({initialInbox}: {initialInbox: RynamoItem<InboxModel>}) {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));

    const currentTimeRoundedToNearestTenMinutes = useCurrentTimeRoundedToNearestTenMinutes();
    const context = useAppContext();
    const isInitialAppRender = useIsInitialAppRender();
    const navigate = useNavigate();
    const {space} = useSpaceContext();
    const platform = usePlatform();
    const {isNativeMobile} = useClientInfo();
    const {isConnected, subscribeToEvents} = useMyAccountWebSocket();
    const location = useLocation();

    // In native mobile, we expect that this component shouldn't render. Instead
    // `<SpaceLayoutNativeMobileInboxController>` should render. This assert is a
    // sanity check since we don't want to maintain two separate inbox realtime items
    // which would be inefficient.
    assert(platform === "mobile" && !isNativeMobile);

    const {item: inbox} = useRynamoItem(initialInbox, {
        isConnected,
        subscribeToEvents: useCallback(
            subscriber => subscribeToEvents(event => subscriber(event.events)),
            [subscribeToEvents],
        ),
        reloadItemWithStrongReadConsistency: useCallback(async () => {
            const {inbox} = await getInboxWithStrongReadConsistency(context, {spaceId: space.id});
            return inbox;
        }, [context, space.id]),
    });

    const pendingTab = useMemo(
        () =>
            dataRouterStateContext.navigation.state === "loading"
                ? getWebMobileTabFromLocation(dataRouterStateContext.navigation.location)
                : null,
        [dataRouterStateContext.navigation.location, dataRouterStateContext.navigation.state],
    );

    const matchedTab = useMemo(
        () => getWebMobileTabFromLocation(dataRouterStateContext.location),
        [dataRouterStateContext.location],
    );

    const [selectedTab, setSelectedTab] = useSessionStorage(
        // If you go to the space switcher, the selected tab should be different in the new
        // space.
        `cyberworlds/webMobileTab/${space.id}`,
        WebMobileTabSchema,
        matchedTab ?? "Home",
    );

    if (matchedTab !== null && matchedTab !== selectedTab) {
        setSelectedTab(matchedTab);
    }

    return (
        <Box
            className={
                !isInitialAppRender
                    ? // Optimistically show `pendingTab` as the selected tab while loading. So the user
                      // gets immediate feedback to their press.
                      spaceLayoutStyles.selectedClassNameByTab[pendingTab ?? selectedTab]
                    : // Normally `typeof window !== "undefined"` checks in React render will break React
                      // server-side rendering hydration. However, it's ok in this case because we have a
                      // `<ScriptBeforeAppInitialRender>` that adds the right class to the server
                      // rendered HTML before the initial render.
                      typeof window !== "undefined"
                      ? (cast<{[key: string]: string}>(spaceLayoutStyles.selectedClassNameByTab)[
                            (
                                sessionStorage.getItem(`cyberworlds/webMobileTab/${space.id}`) ?? ""
                            ).slice(1, -1)
                        ] ?? spaceLayoutStyles.selectedClassNameByTab.Home)
                      : undefined
            }
            display="flex"
            alignItems="stretch"
            height={spaceLayoutWebMobileTabBarHeight}
            style={{
                // This border is visible on web mobile when the keyboard opens/closes leaving
                // empty white space on the page while it animates. We use `box-shadow` instead of
                // border so it renders outside the bounds of the outlet. Usually offscreen (with
                // the exception of web mobile keyboarding).
                boxShadow: `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
            }}
        >
            <ScriptBeforeAppInitialRender
                // To avoid a flash where the wrong tab is selected, we have a script that runs
                // before initial render to add a class which will render the right tab as selected
                // from `sessionStorage`.
                /* eslint-disable cyberworlds/string-quotes */
                script={() =>
                    safe`var tabBar = document.currentScript.parentNode; var classNames = {${safeJoin(
                        Object.entries(spaceLayoutStyles.selectedClassNameByTab).map(
                            ([tab, className]) =>
                                safe`${safeIdentifierString(tab)}: "${safeIdentifierString(
                                    className,
                                )}"`,
                        ),
                        safe`, `,
                    )}}; tabBar.className = (classNames[(sessionStorage.getItem("cyberworlds/webMobileTab/" + "${safeAlphanumericString(
                        space.id,
                    )}") || "").slice(1, -1)] || classNames.Home) + " " + tabBar.className`
                }
                /* eslint-enable cyberworlds/string-quotes */
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Home"
                label="Home"
                icon={<House />}
                onPress={() => {
                    const pathname = `/home/${space.id}`;

                    if (location.pathname !== pathname) {
                        navigate(pathname);
                    }
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Search"
                label="Search"
                icon={<MagnifyingGlass />}
                onPress={() => {
                    const pathname = `/search/${space.id}`;

                    if (location.pathname !== pathname) {
                        navigate(pathname);
                    }
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Create"
                label="Create"
                icon={<Plus />}
                onPress={() => {
                    const pathname = `/create/${space.id}`;

                    if (location.pathname !== pathname) {
                        navigate(pathname);
                    }
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Inbox"
                label="Inbox"
                icon={
                    <>
                        <Bell />
                        {inbox.model.loudNotificationCount > 0 ? (
                            <LoudNotificationBadge
                                top="0.1875rem"
                                right="0.6875rem"
                                count={inbox.model.loudNotificationCount}
                            />
                        ) : inbox.model.entryCount > 0 &&
                          (!inbox.model.lastZeroEntryCountTime ||
                              differenceInMinutes(
                                  currentTimeRoundedToNearestTenMinutes,
                                  inbox.model.lastZeroEntryCountTime,
                              ) > inboxSubtleNotificationBadgePeaceMinutes) ? (
                            <Box
                                zIndex="30"
                                position="absolute"
                                pointerEvents="none"
                                borderRadius="full"
                                width="1"
                                height="1"
                                style={{
                                    top: "0.5rem",
                                    right: "0.625rem",
                                    backgroundColor: "currentcolor",
                                    // On high pixel density displays we want 1.3px should to round up to 1.5px and on
                                    // low pixel density displays we want 1.3px to round down to 1px.
                                    //
                                    // That extra width is helpful when rendering this on top of a solid object like an
                                    // avatar. We don't want 2px since an avatar pile will use that for occluding other
                                    // avatars.
                                    boxShadow: `0 0 0 1.3px ${backgroundColorVar}`,
                                }}
                            />
                        ) : null}
                    </>
                }
                onPress={() => {
                    const pathname = `/inbox/${space.id}`;

                    if (location.pathname !== pathname) {
                        navigate(`/inbox/${space.id}`);
                    }
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="More"
                label="More"
                icon={<List />}
                onPress={() => {
                    const pathname = `/more/${space.id}`;

                    if (location.pathname !== pathname) {
                        navigate(pathname);
                    }
                }}
            />
        </Box>
    );
}

function SpaceLayoutWebMobileTabBarButton({
    tab,
    label,
    icon,
    onPress,
}: {
    tab: WebMobileTab;
    label: string;
    icon: ReactNode;
    onPress: () => void;
}) {
    const {pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            aria-label={label}
            flexGrow="1"
            display="flex"
            justifyContent="center"
            alignItems="center"
            color="grey-30"
            data-tab={tab}
        >
            <Box
                position="relative"
                zIndex="0"
                width="8"
                height="8"
                display="flex"
                justifyContent="center"
                alignItems="center"
            >
                <IconContext.Provider value={{size: spacing["5"]}}>{icon}</IconContext.Provider>
            </Box>
        </Box>
    );
}
