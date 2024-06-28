import {useCallback, useEffect, useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
    useNavigationBar,
} from "~/client/design/navigation_bar.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {contentSchemaStyles, sprinkles} from "~/shared/styles/styles.js";

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
    const isInitialAppRender = useIsInitialAppRender();

    const containerRef = useRef<HTMLDivElement>(null);
    const nameInputRef = useRef<HTMLInputElement>(null);
    const descriptionEditorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const saveButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [{name, hasNameChanged}, setNameState] = useState(() => ({
        name: initialName,
        hasNameChanged: false,
    }));

    const [{descriptionState, hasDescriptionChanged}, setDescriptionState] = useState(() => ({
        descriptionState: ContentEditorState.create(initialDescription, {selectionAt: "start"}),
        hasDescriptionChanged: false,
    }));

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
        withMobileLayout: true,
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
        getAnchorPosition: useCallback(() => {
            const descriptionEditor = assertExists(descriptionEditorRef.current);
            const descriptionEditorState = descriptionEditor.getState();

            const coords = descriptionEditor.coordsAtPos(
                descriptionEditorState.getSelection().from,
            );

            const paragraphLineHeight = convertRemLengthToPx(
                contentSchemaStyles.paragraphFontSize.lineHeight,
                getRemPxWithoutListening(),
            );

            // Add a paragraph line height in either direction as slop. We consider the
            // selection offscreen if there's less than a line of space between it and the
            // keyboard.
            return {
                top: coords.top - paragraphLineHeight,
                height: coords.bottom - coords.top + paragraphLineHeight * 2,
            };
        }, []),
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
            <Box position="relative" paddingY="safe-area-inset">
                {navigationBar}
                <Box height={navigationBarHeight} />
                <Box paddingX={screenPaddingX}>
                    <Spacer space="5" />
                    <TextInput
                        ref={nameInputRef}
                        fontSize="100"
                        label="Name"
                        value={name}
                        onChange={name => setNameState({name, hasNameChanged: true})}
                        onEnter={() => assertExists(saveButtonRef.current).press()}
                    />
                    <Spacer space="5" />
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
                                    isCompact={true}
                                    withMobileLayout={true}
                                    state={descriptionState}
                                    onChange={(state, transaction) => {
                                        setDescriptionState(({hasDescriptionChanged}) => ({
                                            descriptionState: state,
                                            hasDescriptionChanged:
                                                hasDescriptionChanged || transaction.docChanged,
                                        }));
                                    }}
                                    className={sprinkles({
                                        paddingX: "0.5",
                                        paddingY: "1.5",
                                    })}
                                    // Always in editing mode. User won't be reading while in the modal.
                                    withoutMobileDualModality={true}
                                />
                            </Box>
                        </FocusRing>
                    </Box>
                    <Spacer space="3" />
                </Box>
            </Box>
        </Box>
    );
}
