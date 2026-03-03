import {ReactElement, useEffect} from "react";
import {usePress} from "react-aria";
import {useLocation} from "react-router";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {Overlay} from "~/client/web/design/overlay.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useLocalStorage} from "~/client/web/helpers/use_local_storage.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Schema for the search sidebar onboarding hint state.
 *
 * - `null`: Initial state, user hasn't visited feed yet
 * - `true`: User has visited feed view with suggested sidebar, hint is "armed"
 * - `false`: User has dismissed the hint, never show again
 */
const SpaceLayoutSideBarSearchHintSchema = Schema.boolean.nullable();

/**
 * Wraps the search `IconButton` and shows an onboarding hint overlay when the user
 * navigates away from the feed view for the first time. This teaches users about
 * Command-P to access their suggested items.
 */
export function SpaceLayoutSideBarSearchHint({
    isSearchModalOpen,
    children,
}: {
    isSearchModalOpen: boolean;
    children: (isHintVisible: boolean) => ReactElement;
}) {
    const location = useLocation();
    const {space} = useSpaceContext();

    const [hintState, setHintState, isLoadingHintState] = useLocalStorage(
        "cyberworlds/spaceLayoutSideBarSearchHint",
        SpaceLayoutSideBarSearchHintSchema,
        null,
    );

    // Detect feed view from current route. The feed view is the space home page.
    const isOnFeedView = location.pathname === `/s/${space.id}`;

    // Update state when on feed view: arm the hint if it hasn't been dismissed. We
    // check localStorage directly to avoid a race condition where `useLocalStorage`
    // returns the default value before loading from storage.
    useEffect(() => {
        // Only set to true if `hintState` is null after we've loaded from storage.
        // `hintState` will always be null on initial app render because we don't have
        // `localStorage` on the server.
        if (isLoadingHintState) return;

        if (isOnFeedView && hintState === null) {
            setHintState(true);
        }
    }, [isOnFeedView, hintState, setHintState, isLoadingHintState]);

    // Show overlay when armed and not on feed view.
    const shouldShowHint = hintState === true && !isOnFeedView;

    // If the user opens the search modal while the hint is visible then hide the hint.
    useLayoutEffectWithoutServerSideWarning(() => {
        if (shouldShowHint && isSearchModalOpen && hintState === true) {
            setHintState(false);
        }
    }, [hintState, isSearchModalOpen, setHintState, shouldShowHint]);

    if (!shouldShowHint) return children(false);

    return (
        <SpaceLayoutSideBarSearchActualHint setHintState={setHintState}>
            {children(true)}
        </SpaceLayoutSideBarSearchActualHint>
    );
}

function SpaceLayoutSideBarSearchActualHint({
    setHintState,
    children,
}: {
    setHintState: (hintState: false) => void;
    children: ReactElement;
}) {
    const {isAppleDevice} = useClientInfo();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            setHintState(false);
        },
    });

    const keyboardShortcut = isAppleDevice ? "\u2318+P" : "Ctrl+P";

    return (
        <Overlay
            isVisible
            placement="right"
            offset="2.5"
            overlay={
                <Box
                    backgroundColor="grey-0"
                    boxShadow="elevation-20"
                    className={greyElevated2ClassName}
                    borderRadius="1.5"
                    paddingX="4"
                    paddingY="3"
                    display="flex"
                    alignItems="center"
                    gap="4"
                >
                    <Box fontSize="400" fontStyle="semi-bold">
                        {keyboardShortcut}
                    </Box>
                    <Box fontSize="50">
                        Everything from your sidebar is in search
                        <br />
                        Try opening search with {keyboardShortcut}{" "}
                        <FocusRing offset="0">
                            <Box
                                {...pressProps}
                                as="span"
                                tabIndex={0}
                                cursor="pointer"
                                color="grey-50"
                                opacity={isPressed ? "60" : undefined}
                            >
                                (<span style={{textDecoration: "underline"}}>dismiss</span>)
                            </Box>
                        </FocusRing>
                    </Box>
                </Box>
            }
        >
            {children}
        </Overlay>
    );
}
