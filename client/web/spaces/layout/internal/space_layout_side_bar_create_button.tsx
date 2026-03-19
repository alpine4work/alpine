import {Modality, getInteractionModality, setInteractionModality} from "@react-aria/interactions";
import {Plus} from "phosphor-react";
import {Ref, useRef} from "react";
import {FocusScope} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonRef,
} from "~/client/web/design/overlay_trigger_button.js";
import {renderKeyboardShortcutHint} from "~/client/web/design/render_keyboard_shortcut_hint.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {allowShareOverlayEscapeGlobalKeyDownDefault} from "~/client/web/navigation/allow_share_overlay_escape_global_key_down_default.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    CreateWidgetPrimaryMenuBar,
    CreateWidgetPrimaryMenuBarRef,
} from "~/client/web/spaces/layout/create_widget_primary_menu_bar.js";
import {
    CreateWidgetSecondaryMenuBar,
    CreateWidgetSecondaryMenuBarRef,
} from "~/client/web/spaces/layout/create_widget_secondary_menu_bar.js";
import {createWidgetPrimaryMenuBarItemHeight} from "~/client/web/styles/feed_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// NOTE(calebmer): The icons used here for create actions are the same icons used
// in `<SearchEntityView/>`'s `getSearchEntityTypeDisplay()`. If you change an icon
// here you should also change it there.
export function SpaceLayoutSideBarCreateButton() {
    const clientInfo = useClientInfo();

    const triggerRef = useRef<OverlayTriggerButtonRef>(null);
    const originalInteractionModalityRef = useRef<Modality | null>(null);

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                // NOTE(calebmer): I'd really like to use Ctrl+N as the keyboard shortcut to open
                // the create menu but unfortunately we can't override that shortcut in Chrome.
                // When we ship a desktop app we should bind Ctrl+N to the create menu.
                if (
                    event.key === "m" &&
                    (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Restore the interaction modality from before the create menu opened when the
                    // create menu closes.
                    originalInteractionModalityRef.current = getInteractionModality();
                    setInteractionModality("keyboard");

                    assertExists(triggerRef.current).open({
                        initiallyFocus: "FirstFocusableElement",
                    });
                }
            }}
        >
            <OverlayTriggerButton
                ref={triggerRef}
                aria-haspopup="true"
                placement="right-start"
                // Centers the first item with the create button.
                offsetAlong="-4"
                onClose={() => {
                    if (originalInteractionModalityRef.current !== null) {
                        setInteractionModality(originalInteractionModalityRef.current);
                        originalInteractionModalityRef.current = null;
                    }
                }}
                onOverlayEscapeGlobalKeyDown={event => {
                    if (allowShareOverlayEscapeGlobalKeyDownDefault(event)) {
                        return {allowDefault: true};
                    }
                }}
                onOverlayTabGlobalKeyDown={() => {
                    // Don't close the overlay when tab is pressed. Tab is needed to navigate
                    // internally within the share overlay.
                    return {allowDefault: true};
                }}
                overlay={({isVisible, onCloseWithAnimation, onCloseWithoutAnimation}) => (
                    <SpaceLayoutSideBarCreateOverlay
                        isVisible={isVisible}
                        onCloseWithAnimation={onCloseWithAnimation}
                        onCloseWithoutAnimation={onCloseWithoutAnimation}
                    />
                )}
            >
                <IconButton
                    size="lg"
                    description="Create"
                    tooltipPlacement="right"
                    keyboardShortcutHint={renderKeyboardShortcutHint(clientInfo, "mod", "m")}
                >
                    <Plus />
                </IconButton>
            </OverlayTriggerButton>
        </GlobalKeyDownEvent>
    );
}

function SpaceLayoutSideBarCreateOverlay({
    ref: foreignRef = null,
    isVisible,
    onCloseWithAnimation,
    onCloseWithoutAnimation,
}: {
    ref?: Ref<HTMLDivElement>;
    isVisible: boolean;
    onCloseWithAnimation: () => void;
    onCloseWithoutAnimation: () => void;
}) {
    const localRef = useRef<HTMLDivElement>(null);

    const primaryMenuBarRef = useRef<CreateWidgetPrimaryMenuBarRef>(null);
    const secondaryMenuBarRef = useRef<CreateWidgetSecondaryMenuBarRef>(null);

    return (
        <FocusScope
            // If we're animating closed then don't contain focus since we need to move focus
            // back to the overlay trigger button element.
            contain={isVisible}
        >
            <Box
                ref={useMergedRefs(
                    foreignRef,
                    localRef,
                    useScrollbar({insetTop: createWidgetPrimaryMenuBarItemHeight}),
                )}
                position="relative"
                overflowX="hidden"
                overflowY="auto"
                className={greyElevated2ClassName}
                width={contentStyles.contentMaxWidth}
                borderRadius="1.5"
                backgroundColor="grey-0"
                boxShadow="elevation-20"
                style={{
                    // This height is carefully picked to clip ~25% of the third item to make it clear
                    // this overlay is scrollable.
                    maxHeight: addRemLengths("96", "20", "1"),
                }}
            >
                <OverlayScopeContextProvider>
                    <Box
                        onKeyDown={event => {
                            switch (event.key) {
                                // Prevent the browser from scrolling on these common key bindings. We'll scroll
                                // ourselves when we move focus.
                                case "ArrowUp":
                                case "ArrowDown":
                                case "Home":
                                case "End": {
                                    event.preventDefault();
                                    event.stopPropagation();
                                    break;
                                }
                            }
                        }}
                    >
                        <CreateWidgetPrimaryMenuBar
                            ref={primaryMenuBarRef}
                            withOwnKeyboardShortcut={true}
                            withRootNavigateToCreatedDocument={false}
                            onCloseWithAnimation={onCloseWithAnimation}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            onFocusSecondaryMenuBar={() =>
                                assertExists(secondaryMenuBarRef.current).focusFirstItem()
                            }
                        />
                        <Spacer space="10" />
                        <CreateWidgetSecondaryMenuBar
                            ref={secondaryMenuBarRef}
                            scrollRef={localRef}
                            headingType="Explore"
                            withCreateVerbBeforeItemName={false}
                            withRootNavigateToCreatedDocument={false}
                            withDocumentAndProjectTaskStartHereBadges={false}
                            onCloseWithAnimation={onCloseWithAnimation}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            onFocusPrimaryMenuBar={() =>
                                assertExists(primaryMenuBarRef.current).focusFirstItem()
                            }
                        />
                    </Box>
                </OverlayScopeContextProvider>
            </Box>
        </FocusScope>
    );
}
