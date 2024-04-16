import {Check, X} from "phosphor-react";
import {useId, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {
    addRemLengths,
    parseRemLengthNumber,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {
    colorSchemeVars,
    contentSchemaStyles,
    fontSizes,
    sprinkles,
} from "~/shared/styles/styles.js";

export const channelViewAsidePaddingY = "4";
const channelViewAsideSectionTitleFontSize = "75";

const channelViewAsideEditingDescriptionOffsetTop = `${
    parseRemLengthNumber(
        subtractRemLengths(
            addRemLengths(
                fontSizes[channelViewAsideSectionTitleFontSize].lineHeight,
                spacing[channelViewAsidePaddingY],
            ),
            // Size of a `md` `<IconButton>`
            spacing["6"],
        ),
    ) / 2
}rem`;

export function ChannelViewAside({
    channel,
    isEditingDescription,
    onCancelEditingDescription,
    onSaveDescription,
}: {
    channel: ChannelModel;
    isEditingDescription: boolean;
    onCancelEditingDescription: () => void;
    onSaveDescription: (description: MessageContent) => Promise<void>;
}) {
    return (
        // Put overlays (e.g. the `<FocusRing>`) in the aside so they move smoothly
        // inside this `position: sticky` element.
        <OverlayScopeContextProvider>
            <Box position="relative" paddingY={channelViewAsidePaddingY}>
                <h3
                    className={sprinkles({
                        paddingLeft: contentSchemaStyles.blockPaddingX,
                        color: "grey-50",
                        fontSize: channelViewAsideSectionTitleFontSize,
                    })}
                >
                    About
                </h3>
                {isEditingDescription ? (
                    <ChannelViewAsideDescriptionEditor
                        initialDescription={channel.description}
                        onCancel={onCancelEditingDescription}
                        onSave={onSaveDescription}
                    />
                ) : (
                    <Box paddingY="1.5">
                        <ContentView content={channel.description} />
                    </Box>
                )}
            </Box>
        </OverlayScopeContextProvider>
    );
}

function ChannelViewAsideDescriptionEditor({
    initialDescription,
    onCancel,
    onSave,
}: {
    initialDescription: MessageContentWithReferences;
    onCancel: () => void;
    onSave: (description: MessageContent) => Promise<void>;
}) {
    const showToast = useShowToast();
    const {isAppleDevice} = useClientInfo();

    const editorId = useId();
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [state, setState] = useState(() =>
        ContentEditorState.create(initialDescription, {selectionAt: "end"}),
    );

    const [isSaving, setIsSaving] = useState(false);
    const [shouldShowConfirmSaveDialog, setShouldShowConfirmSaveDialog] = useState(false);

    const shouldFocusNextRenderRef = useRef(true);

    useLayoutEffectWithoutServerSideWarning(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmSaveDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        const editor = assertExists(editorRef.current);
        editor.focus();
    }, [shouldShowConfirmSaveDialog]);

    const save = async () => {
        try {
            setIsSaving(true);
            await onSave(state.getDoc());
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <>
            <Box
                // Mark our buttons as being owned by the editor (according to
                // `isElementOwnedBy()`) so `useConfirmSaveAfterLosingFocus()` allows us to
                // press on these buttons without asking the user to confirm the save.
                data-ownedby={editorId}
                position="absolute"
                right="0"
                display="flex"
                justifyContent="flex-end"
                style={{top: channelViewAsideEditingDescriptionOffsetTop}}
            >
                <IconButton
                    description="Save"
                    tooltipPlacement="bottom-end"
                    keyboardShortcutHint={`${isAppleDevice ? "⌘" : "Ctrl"}+Enter`}
                    size="md"
                    pressErrorTitle="Couldn’t save description"
                    onPress={save}
                    isDisabled={isSaving}
                    isPending={isSaving}
                >
                    <Check />
                </IconButton>
                <IconButton
                    description="Cancel"
                    tooltipPlacement="bottom-end"
                    keyboardShortcutHint="Esc"
                    size="md"
                    onPress={onCancel}
                    isDisabled={isSaving}
                >
                    <X />
                </IconButton>
            </Box>
            <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
                <Box
                    id={editorId}
                    paddingY="1.5"
                    borderRadius="md"
                    style={{
                        // Use box shadow to draw the border so it doesn't add 1px to layout like
                        // `border` CSS would.
                        boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                    }}
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: state.getDoc() !== initialDescription.doc,
                        isConfirmingSave: shouldShowConfirmSaveDialog,
                        onCancelSave: onCancel,
                        onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                    })}
                >
                    <ContentEditor
                        ref={editorRef}
                        aria-label="Description"
                        state={state}
                        onChange={(state, transaction) => {
                            if (isSaving && transaction.docChanged) return;
                            setState(state);
                        }}
                        onEscape={event => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (isSaving) return;

                            onCancel();
                        }}
                        onModEnter={event => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (isSaving) return;

                            save().catch(error => {
                                showToast({
                                    type: "Error",
                                    title: "Couldn’t save description",
                                    error,
                                });
                            });
                        }}
                    />
                </Box>
            </FocusRing>
            {shouldShowConfirmSaveDialog && (
                <ModalDialog
                    title="Save channel description"
                    description="Would you like to save the channel description?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn’t save description"
                    onPrimaryButtonPress={save}
                    cancelButtonLabel="Discard description"
                    cancelButtonPressErrorTitle="Couldn’t discard description"
                    onCancelButtonPress={onCancel}
                />
            )}
        </>
    );
}
