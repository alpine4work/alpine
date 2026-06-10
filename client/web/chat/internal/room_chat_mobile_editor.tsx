import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
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
import {
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function RoomChatMobileEditor({
    title,
    initiallyFocus,
    initialName,
    onCloseWithAnimation,
    onSave,
}: {
    title: string;
    initiallyFocus: "Name" | null;
    initialName: string;
    onCloseWithAnimation: (options: {hasSaved: boolean}) => void;
    onSave: (name: string) => Promise<void>;
}) {
    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: initialName,
        hasNameChanged: false,
    }));

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
                    fontSize="100"
                    isDisabled={!hasNameChanged || name.trim().length === 0}
                    pressErrorTitle="Couldn&#x2019;t save chat"
                    onPress={async () => {
                        await onSave(name.trim());
                        onCloseWithAnimation({hasSaved: true});
                    }}
                >
                    Save
                </Button>
            </Box>
        ),
        onMobileCancel: () => onCloseWithAnimation({hasSaved: false}),
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
                        paddingTop={channelCreatorMarginTop}
                        paddingBottom="24"
                        paddingX={screenPaddingX}
                    >
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
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
