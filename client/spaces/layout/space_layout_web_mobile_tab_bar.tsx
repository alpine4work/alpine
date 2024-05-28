import {Bell, House, IconContext, List, MagnifyingGlass, Plus} from "phosphor-react";
import {ReactNode, useContext, useMemo} from "react";
import {usePress} from "react-aria";
import {UNSAFE_DataRouterStateContext as DataRouterStateContext} from "react-router";
import {Box} from "~/client/design/box.js";
import {ScriptBeforeAppInitialRender} from "~/client/helpers/lifecycle/script_before_initial_app_render.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useSessionStorage} from "~/client/helpers/use_local_storage.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {safe, safeIdentifierString, safeJoin} from "~/shared/helpers/string/safe_string.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {colorSchemeVars, spaceLayoutStyles} from "~/shared/styles/styles.js";

// A little bigger than the native iOS toolbar which is around height spacing
// `10`. Spacing `10` just looks squished. In native iOS there's safe area at
// the bottom of the screen which helps make the bottom bar not look squished.
// We don't have that in web mobile so make the tab bar a little bigger.
export const spaceLayoutWebMobileTabBarHeight = "12";

type WebMobileTab = SchemaType<typeof WebMobileTabSchema>;
const WebMobileTabSchema = Schema.enum(spaceLayoutStyles.webMobileTabs);

const beforeAppInitialRenderScript = safe`var tabBar = document.currentScript.parentNode; var classNames = {${safeJoin(
    Object.entries(spaceLayoutStyles.selectedClassNameByTab).map(
        ([tab, className]) =>
            safe`${safeIdentifierString(tab)}: "${safeIdentifierString(className)}"`,
    ),
    safe`, `,
)}}; tabBar.className = (classNames[(sessionStorage.getItem("cyberworlds/webMobileTab") || "").slice(1, -1)] || classNames.Home) + " " + tabBar.className;`;

function getWebMobileTabFromPathname(pathname: string): WebMobileTab | null {
    const match = pathname.match(/^\/s\/(?:[a-zA-Z0-9]+)(\/search|\/create|\/inbox|\/more)?$/);
    if (!match) return null;

    switch (match[1]) {
        case undefined:
            return "Home";
        case "/search":
            return "Search";
        case "/create":
            return "Create";
        case "/inbox":
            return "Inbox";
        case "/more":
            return "More";
        default:
            return null;
    }
}

export function SpaceLayoutWebMobileTabBar() {
    const dataRouterStateContext = assertExists(useContext(DataRouterStateContext));

    const isInitialAppRender = useIsInitialAppRender();
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const pendingTab = useMemo(
        () =>
            dataRouterStateContext.navigation.state === "loading"
                ? getWebMobileTabFromPathname(dataRouterStateContext.navigation.location.pathname)
                : null,
        [
            dataRouterStateContext.navigation.location?.pathname,
            dataRouterStateContext.navigation.state,
        ],
    );
    const matchedTab = useMemo(
        () => getWebMobileTabFromPathname(dataRouterStateContext.location.pathname),
        [dataRouterStateContext.location.pathname],
    );

    const [selectedTab, setSelectedTab] = useSessionStorage(
        // If you go to the space switcher, the selected tab should be different in the
        // new space.
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
                    ? // Optimistically show `pendingTab` as the selected tab while loading. So the
                      // user gets immediate feedback to their press.
                      spaceLayoutStyles.selectedClassNameByTab[pendingTab ?? selectedTab]
                    : // Normally `typeof window !== "undefined"` checks in React render will break
                    // React server-side rendering hydration. However, it's ok in this case because
                    // we have a `<ScriptBeforeAppInitialRender>` that adds the right class to the
                    // server rendered HTML before the initial render.
                    typeof window !== "undefined"
                    ? cast<{[key: string]: string}>(spaceLayoutStyles.selectedClassNameByTab)[
                          (sessionStorage.getItem("cyberworlds/webMobileTab") ?? "").slice(1, -1)
                      ] ?? spaceLayoutStyles.selectedClassNameByTab.Home
                    : undefined
            }
            display="flex"
            alignItems="stretch"
            height={spaceLayoutWebMobileTabBarHeight}
            style={{
                boxShadow: [
                    `inset 0 1px 0 0 ${colorSchemeVars["grey-10"]}`,
                    // This border is visible on web mobile when the keyboard opens/closes
                    // leaving empty white space on the page while it animates. We use `box-shadow`
                    // instead of border so it renders outside the bounds of the outlet. Usually
                    // offscreen (with the exception of web mobile keyboarding).
                    `0 1px 0 0 ${colorSchemeVars["grey-5"]}`,
                ].join(", "),
            }}
        >
            <ScriptBeforeAppInitialRender
                // To avoid a flash where the wrong tab is selected, we have a script that runs
                // before initial render to add a class which will render the right tab as
                // selected from `sessionStorage`.
                script={beforeAppInitialRenderScript}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Home"
                icon={<House />}
                onPress={() => {
                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${space.id}`);
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Search"
                icon={<MagnifyingGlass />}
                onPress={() => {
                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${space.id}/search`);
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Create"
                icon={<Plus />}
                onPress={() => {
                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${space.id}/create`);
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="Inbox"
                icon={<Bell />}
                onPress={() => {
                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${space.id}/inbox`);
                }}
            />
            <SpaceLayoutWebMobileTabBarButton
                tab="More"
                icon={<List />}
                onPress={() => {
                    // TODO(calebmer, #global-loading-indicator): Some global loading indicator?
                    void navigate(`/s/${space.id}/more`);
                }}
            />
        </Box>
    );
}

function SpaceLayoutWebMobileTabBarButton({
    tab,
    icon,
    onPress,
}: {
    tab: WebMobileTab;
    icon: ReactNode;
    onPress: () => void;
}) {
    const {pressProps} = usePress({onPress});

    return (
        <Box
            {...pressProps}
            flexGrow="1"
            display="flex"
            justifyContent="center"
            alignItems="center"
            color="grey-30"
            data-tab={tab}
        >
            <IconContext.Provider value={{size: spacing["5"]}}>{icon}</IconContext.Provider>
        </Box>
    );
}
