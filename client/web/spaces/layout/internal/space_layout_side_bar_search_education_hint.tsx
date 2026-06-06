import {ReactElement, useEffect, useRef} from "react";
import {useLocation} from "react-router";
import {Box} from "~/client/web/design/box.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useHintOracle} from "~/client/web/design/use_hint_oracle.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {pingAnimationClassName} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";

/**
 * Wraps the search `IconButton` and shows an onboarding hint overlay when the user
 * navigates away from the feed view for the first time. This teaches users about
 * Command-P to access their suggested items.
 */
export function SpaceLayoutSideBarSearchEducationHint({
    isSearchModalOpen,
    children,
}: {
    isSearchModalOpen: boolean;
    children: (isHintVisible: boolean) => ReactElement;
}) {
    const location = useLocation();
    const {space, currentAccountSettings, updateCurrentAccountSettings} = useSpaceContext();

    // Detect feed view from current route. The feed view is the space home page.
    const isOnFeedView = location.pathname === `/home/${space.id}`;

    // Update state when on feed view: arm the hint if it hasn't been dismissed. We
    // check localStorage directly to avoid a race condition where `useLocalStorage`
    // returns the default value before loading from storage.
    {
        const isOnFeedViewRef = useRef(false);

        useEffect(() => {
            // Only update settings when we navigate to the feed view.
            if (isOnFeedViewRef.current === isOnFeedView) return;
            isOnFeedViewRef.current = isOnFeedView;

            if (!isOnFeedView) return;

            if (
                currentAccountSettings.searchEducationHint &&
                !currentAccountSettings.searchEducationHint.hasOpenedFeed
            ) {
                updateCurrentAccountSettings({type: "OpenFeedForSearchEducationHint"});
            }
        }, [isOnFeedView, currentAccountSettings, updateCurrentAccountSettings]);
    }

    const isHintVisible = useHintOracle(
        // We only show the search education hint if the user has opened their feed then
        // navigate back to a non-feed page.
        currentAccountSettings.searchEducationHint?.hasOpenedFeed && !isOnFeedView
            ? "a1#SearchEducationHint"
            : null,
    );

    // If the user opens the search modal while the hint is visible then hide the hint.
    {
        const isSearchModalOpenRef = useRef(false);

        useLayoutEffectWithoutServerSideWarning(() => {
            // Only update settings when we open the search modal.
            if (isSearchModalOpenRef.current === isSearchModalOpen) return;
            isSearchModalOpenRef.current = isSearchModalOpen;

            if (!isSearchModalOpen) return;

            if (isHintVisible) {
                updateCurrentAccountSettings({type: "HideSearchEducationHint"});
            }
        }, [isHintVisible, isSearchModalOpen, updateCurrentAccountSettings]);
    }

    if (!isHintVisible) return children(false);

    return (
        <SpaceLayoutSideBarSearchActualHint>{children(true)}</SpaceLayoutSideBarSearchActualHint>
    );
}

function SpaceLayoutSideBarSearchActualHint({children}: {children: ReactElement}) {
    const clientInfo = useClientInfo();

    return (
        <OverlayAnimated
            isVisible
            disableAnimationOut
            placement="right"
            offset="2.5"
            overlay={
                <Box
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    className={greyElevated2ClassName}
                    borderRadius="1.5"
                    paddingX="3"
                    paddingY="2"
                    display="flex"
                    alignItems="center"
                    gap="4"
                >
                    <Box fontSize="50">
                        Everything from your home sidebar is in
                        <br />
                        search. Try opening search with{" "}
                        {renderKeyboardShortcutHint(clientInfo, "mod", "p")}
                    </Box>
                </Box>
            }
        >
            <Box position="relative" zIndex="0">
                <Box
                    position="absolute"
                    zIndex="10"
                    width="2"
                    height="2"
                    style={{
                        top: `${parseRemLength("0.5") / 2}rem`,
                        right: `${parseRemLength("0.5") / 2}rem`,
                    }}
                >
                    <Box
                        className={pingAnimationClassName}
                        position="absolute"
                        inset="0"
                        borderRadius="full"
                        backgroundColor="theme-30-const"
                    />
                    <Box
                        position="absolute"
                        inset="0"
                        borderRadius="full"
                        backgroundColor="theme-40-const"
                    />
                </Box>
                {children}
            </Box>
        </OverlayAnimated>
    );
}
