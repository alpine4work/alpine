import {Check, X} from "phosphor-react";
import {useId, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useShowToast} from "~/client/design/toast.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {channelViewAsidePaddingY} from "~/client/forum/internal/channel_view_aside.js";
import {
    PostFauxInputCreateButton,
    postFauxInputCreateButtonHeight,
} from "~/client/forum/internal/post_faux_input_create_button.js";
import {
    postContentViewOuterMarginY,
    postContentViewPaddingX,
} from "~/client/forum/post_content_view.js";
import {PostListChannelHeader} from "~/client/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {addRemLengths, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {colorSchemeVars, sprinkles} from "~/shared/styles/styles.js";

export const channelViewHeaderMinHeight = addRemLengths(
    spacing[channelViewAsidePaddingY],
    spacing[postFauxInputCreateButtonHeight],
    spacing[postContentViewOuterMarginY],
);

export function ChannelViewHeader({
    channelHeader,
    withMobileLayout,
}: {
    channelHeader: PostListChannelHeader & {isOnlyNavigationBar: false};
    withMobileLayout: boolean;
}) {
    return (
        <>
            {withMobileLayout &&
                (channelHeader.isEditingDescription ||
                    !isContentEmpty(channelHeader.channel.description.doc)) && (
                    <Box paddingBottom="2" paddingX="3">
                        <h3
                            className={sprinkles({
                                paddingLeft: "2",
                                color: "grey-50",
                            })}
                        >
                            About
                        </h3>
                        {!channelHeader.isEditingDescription ? (
                            <ChannelViewHeaderMobileDescription
                                description={channelHeader.channel.description}
                            />
                        ) : (
                            <ChannelViewHeaderMobileDescriptionEditor
                                initialDescription={channelHeader.channel.description}
                                onCancel={channelHeader.onCancelDescriptionEditing}
                                onSave={channelHeader.onSaveDescription}
                            />
                        )}
                    </Box>
                )}
            <Box
                paddingTop={channelViewAsidePaddingY}
                paddingBottom={postContentViewOuterMarginY}
                paddingX={postContentViewPaddingX}
            >
                <PostFauxInputCreateButton
                    withMobileLayout={withMobileLayout}
                    channel={channelHeader.channel}
                    isCreatingChannel={channelHeader.isCreatingChannel}
                />
            </Box>
        </>
    );
}

function ChannelViewHeaderMobileDescription({
    description,
}: {
    description: MessageContentWithReferences;
}) {
    const descriptionSnippet = useMemo(() => {
        return {
            doc: getContentSnippet(
                description.doc.resolve(0),
                {linesAbove: 0, linesBelow: 3},
                {
                    // 1.125x the number of "x"s we can fit in a single line in a peek (64). We
                    // want to be slightly more aggressive than the default grapheme count (which
                    // counts the "l" character which is narrower) since we render the entire
                    // snippet.
                    maxLineGraphemeCount: 72,
                },
            ),
            references: description.references,
        };
    }, [description.doc, description.references]);

    const isDescriptionSnippetTruncated =
        description.doc.nodeSize !== descriptionSnippet.doc.nodeSize;

    const [isShowingAllContent, setIsShowingAllContent] = useState(!isDescriptionSnippetTruncated);
    if (!isShowingAllContent && !isDescriptionSnippetTruncated) setIsShowingAllContent(true);

    return (
        <Box paddingY="1">
            <ContentView
                content={
                    isDescriptionSnippetTruncated && !isShowingAllContent
                        ? descriptionSnippet
                        : description
                }
                onSeeMoreContent={
                    isDescriptionSnippetTruncated && !isShowingAllContent
                        ? () => setIsShowingAllContent(true)
                        : undefined
                }
                onSeeLessContent={
                    isDescriptionSnippetTruncated && isShowingAllContent
                        ? () => setIsShowingAllContent(false)
                        : undefined
                }
            />
        </Box>
    );
}

// `<ChannelViewHeaderMobileDescriptionEditor>` is not used on desktop. Instead
// the channel description is in an aside. We forked this component from
// `<ChannelViewAsideDescriptionEditor>`. Any changes made here should probably
// be made there too.
function ChannelViewHeaderMobileDescriptionEditor({
    initialDescription,
    onCancel,
    onSave,
}: {
    initialDescription: MessageContentWithReferences;
    onCancel: () => void;
    onSave: (description: MessageContent) => Promise<void>;
}) {
    const showToast = useShowToast();

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
        <Box position="relative">
            <Box
                // Mark our buttons as being owned by the editor (according to
                // `isElementOwnedBy()`) so `useConfirmSaveAfterLosingFocus()` allows us to
                // press on these buttons without asking the user to confirm the save.
                data-ownedby={editorId}
                position="absolute"
                right="0"
                top="-7"
                display="flex"
                justifyContent="flex-end"
            >
                <IconButton
                    description="Save"
                    tooltipPlacement="bottom-end"
                    keyboardShortcutHint="Enter"
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
                    paddingY="1"
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
                        onEnterFromPhysicalKeyboard={event => {
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
        </Box>
    );
}
