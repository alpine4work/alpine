import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {Link} from "~/client/web/design/link.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {ShareSwitchCreatorInput} from "~/client/web/navigation/share_switch_creator_input.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    channelCreatorFieldHelpMarginTop,
    channelCreatorGap,
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {generateId} from "~/shared/id/id.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function RoomChatCreator({
    title,
    initiallyFocus,
    initialName,
}: {
    title: string;
    initiallyFocus: "Name" | null;
    initialName: string;
}) {
    const navigate = useNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: initialName,
        hasNameChanged: false,
    }));

    const [isPublic, setIsPublic] = useState(true);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (initiallyFocus === null) return;

        const nameInputElement = assertExists(nameInputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            switch (initiallyFocus) {
                case "Name": {
                    nameInputElement.focus();

                    nameInputElement.selectionStart = nameInputElement.selectionEnd =
                        nameInputElement.value.length;
                    break;
                }
                default:
                    throw exhaustive(initiallyFocus);
            }
        });
    }, [initiallyFocus]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title,
        withoutDisappearingTitle: true,
        desktopTitleFontSize: channelCreatorNavigationBarDesktopTitleFontSize,
        desktopTitleFontWeight: "bold",
        replaceActions: (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                <Button
                    ref={saveButtonRef}
                    variant="neutral"
                    fontSize="100"
                    isDisabled={!hasNameChanged || name.trim().length === 0}
                    pressErrorTitle="Couldn&#x2019;t save chat room"
                    onPress={async () => {
                        await navigate(
                            `/chat/${generateId()}?create=${space.id}+${encodeURIComponent(name)}${!isPublic ? "&private" : ""}`,
                            {
                                replace: true,
                                // In our native mobile app, we want to call
                                // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                                // push animation while replacing in the history stack.
                                state: NativeMobileBridge ? {withPushAnimation: true} : undefined,
                            },
                        );
                    }}
                >
                    Create
                </Button>
            </Box>
        ),
        defaultPreviousRoute: `/create/${space.id}`,
    });

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
                containerRef,
                scrollViewRef,
                useScrollbar({insetTop: scrollbarInsetTop}),
            )}
            flexGrow="1"
            width="full"
            height="full"
            position="relative"
            zIndex="0"
            overflowX="hidden"
            overflowY="auto"
        >
            <OverlayScopeContextProvider>
                <Box
                    position="relative"
                    paddingY="safe-area-inset"
                    width="full"
                    maxWidth={peekNarrowLayoutWidth}
                    marginX="auto"
                >
                    {navigationBar}
                    <Box height={navigationBarHeight} />
                    <Box
                        display="flex"
                        flexDirection="column"
                        gap={channelCreatorGap}
                        paddingTop={channelCreatorMarginTop}
                        paddingBottom="24"
                        paddingX={screenPaddingX}
                    >
                        <Box>
                            <TextInput
                                ref={nameInputRef}
                                maxLength={maxLabelStringLength}
                                fontSize="100"
                                label="Name"
                                placeholder="My Team&#x2019;s Chat"
                                value={name}
                                onChange={name => setNameState({name, hasNameChanged: true})}
                                onEnter={() => assertExists(saveButtonRef.current).press()}
                            />
                            <Box
                                paddingTop={channelCreatorFieldHelpMarginTop}
                                fontSize="50"
                                color="grey-50"
                                userSelect="text"
                            >
                                Chat rooms are for live conversations where all participants are
                                present and engaged.{" "}
                                <Link color="inherit" url={`/channel/new/${space.id}`}>
                                    Channels
                                </Link>{" "}
                                are better for decision making.
                            </Box>
                        </Box>
                        <ShareSwitchCreatorInput
                            isPublic={isPublic}
                            onIsPublicChange={setIsPublic}
                        />
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
