import {useCallback, useEffect, useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getContentEditorScrollAnchorPosition} from "~/client/web/content/get_content_editor_scroll_anchor_position.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {
    useCurrentDate,
    useCurrentTimeRoundedToHour,
} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {peekNarrowLayoutWidth} from "~/client/web/styles/peek_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/core/spacing.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";

export function ChannelMobileEditor({
    title,
    initiallyFocus,
    initialName,
    initialDescription,
    onCloseWithAnimation,
    onSave,
}: {
    title: string;
    initiallyFocus: "Name" | "Description";
    initialName: string;
    initialDescription: MessageContentWithReferences;
    onCloseWithAnimation: (options: {hasSaved: boolean}) => void;
    onSave: (update: {name: string; description: MessageContent}) => Promise<void>;
}) {
    const spacingScale = useSpacingScale();
    const clientInfo = useClientInfo();
    const isInitialAppRender = useIsInitialAppRender();
    const currentDate = useCurrentDate();
    const currentTime = useCurrentTimeRoundedToHour();

    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const descriptionEditorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: initialName,
        hasNameChanged: false,
    }));

    const [{descriptionState, hasDescriptionChanged}, setDescriptionState] = useState(() => ({
        descriptionState: ContentEditorState.create(initialDescription, {selection: "start"}),
        hasDescriptionChanged: false,
    }));

    const descriptionPaddingX = "2.5";
    const descriptionPaddingY = "1.5";

    const descriptionMinHeightPx =
        contentStyles.paragraphLineHeightPx[spacingScale] * 3 +
        convertRemLengthToPx(descriptionPaddingY, spacingScale) * 2;

    const descriptionLabelId = useId();

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const nameInputElement = assertExists(nameInputRef.current);
        const descriptionEditor = assertExists(descriptionEditorRef.current);

        return scheduleAfterNavigationAnimation(() => {
            switch (initiallyFocus) {
                case "Name": {
                    nameInputElement.focus();

                    nameInputElement.selectionStart = nameInputElement.selectionEnd =
                        nameInputElement.value.length;
                    break;
                }
                case "Description": {
                    descriptionEditor.focus();
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
        replaceActions: (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                <Button
                    ref={saveButtonRef}
                    fontSize="100"
                    isDisabled={
                        (!hasNameChanged && !hasDescriptionChanged) || name.trim().length === 0
                    }
                    pressErrorTitle="Couldn’t save channel"
                    onPress={async () => {
                        await onSave({name: name.trim(), description: descriptionState.getDoc()});
                        onCloseWithAnimation({hasSaved: true});
                    }}
                >
                    Save
                </Button>
            </Box>
        ),
        // Instead of calling `navigate(-1)` the navigation bar needs a cancel button.
        onMobileCancel: () => onCloseWithAnimation({hasSaved: false}),
    });

    useScrollToAvoidBottomBarsAndMobileKeyboard(containerRef, {
        // - Disable on `isInitialAppRender` since `coordsAtPos()` won't work on
        //   initial render.
        // - Disable on `sidebarState.isOpen` since the comment view should be
        //   scrolling not the document.
        isDisabled: isInitialAppRender,
        getAnchorPosition: useCallback(
            () => getContentEditorScrollAnchorPosition(descriptionEditorRef),
            [],
        ),
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
                        gap="8"
                        paddingTop="4"
                        paddingBottom="24"
                        paddingX={screenPaddingX}
                    >
                        <Box>
                            <TextInput
                                ref={nameInputRef}
                                fontSize="100"
                                label="Name"
                                placeholder="My Project"
                                value={name}
                                onChange={name => setNameState({name, hasNameChanged: true})}
                                onEnter={() => assertExists(saveButtonRef.current).press()}
                            />
                            <Box paddingTop="2" fontSize="50" color="grey-50" userSelect="text">
                                {/* NOTE(calebmer, 2025-05-06): This text is shamelessly copied from Slack's
                                create channel experience. Slack's help text here is perfect, I have no
                                notes. */}
                                Channels are where conversations happen around a topic. Use a name
                                that is easy to find and understand.
                            </Box>
                        </Box>
                        <Box>
                            <label
                                id={descriptionLabelId}
                                className={sprinkles({
                                    display: "inline-block",
                                    fontSize: "75",
                                    fontStyle: "semi-bold",
                                    paddingBottom: "1",
                                })}
                            >
                                Description
                            </label>
                            <FocusRing offset="border" isVisibleWhenFocusWithin>
                                <Box border="grey-20" borderRadius="1">
                                    <ContentEditor
                                        ref={descriptionEditorRef}
                                        aria-labelledby={descriptionLabelId}
                                        state={descriptionState}
                                        onChange={(state, transaction) => {
                                            setDescriptionState(({hasDescriptionChanged}) => ({
                                                descriptionState: state,
                                                hasDescriptionChanged:
                                                    hasDescriptionChanged || transaction.docChanged,
                                            }));
                                        }}
                                        className={sprinkles({
                                            paddingX: descriptionPaddingX,
                                            paddingY: descriptionPaddingY,
                                        })}
                                        style={{minHeight: descriptionMinHeightPx}}
                                        // If the description is empty then we render a dummy placeholder to incentivize
                                        // adding a description to the channel.
                                        placeholder={`Created ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                                            clientInfo.locale,
                                            clientInfo.timeZone,
                                            currentDate,
                                            currentTime,
                                            {
                                                withLongMonth: true,
                                                withLongWeekday: true,
                                                withoutTime: true,
                                            },
                                        )}`}
                                        // Always in editing mode. User won't be reading while in the modal.
                                        withoutMobileDualModality={true}
                                    />
                                </Box>
                            </FocusRing>
                            <Box paddingTop="2" fontSize="50" color="grey-50" userSelect="text">
                                Use the description to provide more information about this channel.
                                Like what conversations someone should expect or some important
                                links.
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </OverlayScopeContextProvider>
        </Box>
    );
}
