import {useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
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
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/context/space_context.js";
import {
    channelCreatorGap,
    channelCreatorMarginTop,
    channelCreatorNavigationBarDesktopTitleFontSize,
} from "~/client/web/styles/forum_shared_styles.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {createDatabaseTable} from "~/shared/rpc/database_tables_rpc_definitions.js";
import {maxLabelStringLength} from "~/shared/schema/helpers/label_string_schema.js";

export function DatabaseCreator({initiallyFocus}: {initiallyFocus: "Name" | null}) {
    const context = useAppContext();
    const navigate = useNavigate();
    const {space} = useSpaceContextAndRequireSpaceAccess();

    const nameInputRef = useRef<HTMLInputElement>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: "",
        hasNameChanged: false,
    }));

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (initiallyFocus === null) return;

        const nameInputElement = assertExists(nameInputRef.current);

        return scheduleAfterNavigationAnimation(() => {
            nameInputElement.focus();
        });
    }, [initiallyFocus]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        title: "New database",
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
                    pressErrorTitle="Couldn&#x2019;t create database"
                    onPress={async () => {
                        const {tableId} = await createDatabaseTable(context, {
                            spaceId: space.id,
                            name,
                        });

                        await navigate(`/databases/${space.id}/${tableId}`, {
                            replace: true,
                            state: NativeMobileBridge ? {withPushAnimation: true} : undefined,
                        });
                    }}
                >
                    Create
                </Button>
            </Box>
        ),
    });

    return (
        <Box
            ref={useMergedRefs<HTMLDivElement>(
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
                                placeholder="My Database"
                                value={name}
                                onChange={name => setNameState({name, hasNameChanged: true})}
                                onEnter={() => assertExists(saveButtonRef.current).press()}
                            />
                        </Box>
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
