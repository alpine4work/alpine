import {useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentViewWithSeeMoreToggle} from "~/client/content/content_view_with_see_more_toggle.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useReporter} from "~/client/design/reporter.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {ChannelViewContributorsSection} from "~/client/forum/internal/channel_view_contributors_section.js";
import {PostFauxInputCreateButton} from "~/client/forum/internal/post_faux_input_create_button.js";
import {PostListChannelHeader} from "~/client/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {MountainRoadAtSunriseIllustration} from "~/client/icons/illustrations/mountain_road_at_sunrise_illustration.js";
import {InlineEditorToolbar} from "~/client/messaging/inline_editor_toolbar.js";
import {useRouteLayout} from "~/client/remix/route_layout_context.js";
import {
    channelViewHeaderNarrowRouteLayoutMarginTop,
    channelViewHeaderSectionGap,
    postContentViewOuterMarginY,
    postFauxInputCreateButtonMarginTop,
} from "~/client/styles/forum_shared_styles.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {ChannelContributorsModel} from "~/shared/forum/channel_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    MessageContent,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";

export function ChannelViewHeader({
    channelHeader,
    hasNoPosts,
}: {
    channelHeader: PostListChannelHeader & {isOnlyNavigationBar: false};
    hasNoPosts: boolean;
}) {
    const routeLayout = useRouteLayout();

    let contributors: ChannelContributorsModel | null = null;

    if (channelHeader.channelAndMetadataQuery) {
        for (let i = 0; i < channelHeader.channelAndMetadataQuery.getItemCount(); i++) {
            const item = channelHeader.channelAndMetadataQuery.getItem(i);

            if (item.type === "Loaded" && item.item.model instanceof ChannelContributorsModel) {
                contributors = item.item.model;
                break;
            }
        }
    }

    return (
        <>
            {routeLayout === "narrow" && (
                <Box
                    paddingTop={channelViewHeaderNarrowRouteLayoutMarginTop}
                    paddingX={screenPaddingX}
                    display="flex"
                    flexDirection="column"
                    gap={channelViewHeaderSectionGap}
                >
                    <ChannelViewContributorsSection
                        channel={channelHeader.channel}
                        contributors={contributors}
                        withoutTitle={true}
                    />
                    {(channelHeader.isEditingDescription ||
                        !isContentEmpty(channelHeader.channel.description.doc)) && (
                        <Box marginBottom="-1.5">
                            <h3 className={sprinkles({color: "grey-50"})}>About</h3>
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
                </Box>
            )}
            <Box
                paddingTop={postFauxInputCreateButtonMarginTop[routeLayout]}
                paddingBottom={postContentViewOuterMarginY}
                paddingX={screenPaddingX}
            >
                <PostFauxInputCreateButton
                    channel={channelHeader.channel}
                    isCreatingChannel={channelHeader.isCreatingChannel}
                />
            </Box>
            {hasNoPosts && (
                <Box
                    height={routeLayout === "narrow" ? "96" : "128"}
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                >
                    <Box
                        display="flex"
                        flexDirection="column"
                        justifyContent="center"
                        alignItems="center"
                        gap="2"
                    >
                        <Box width="64" color="grey-30">
                            <MountainRoadAtSunriseIllustration strokeWidth={1.75} />
                        </Box>
                        <Box color="grey-40" fontSize="100" fontStyle="light" textAlign="center">
                            Nothing here yet. Start a<br />
                            conversation by creating a post
                        </Box>
                    </Box>
                </Box>
            )}
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
            doc: assertMessageContent(
                getContentSnippet(
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
            ),
            references: description.references,
        };
    }, [description.doc, description.references]);

    return (
        <Box paddingTop="1">
            <ContentViewWithSeeMoreToggle
                content={description}
                contentSnippet={descriptionSnippet}
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
    const reporter = useReporter();

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [state, setState] = useState(() =>
        ContentEditorState.create(initialDescription, {selection: "start"}),
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
            <FocusRing offset="border" isVisibleWhenFocusWithin={true} isVisibleFromAnyFocus={true}>
                <Box
                    position="relative"
                    zIndex="40"
                    paddingX="1.5"
                    paddingY="1"
                    marginX="-1.5"
                    marginBottom="-1"
                    borderRadius="1.5"
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
                        onEscapeKeyDown={event => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (isSaving) return;

                            onCancel();
                        }}
                        onEnterKeyDownFromPhysicalKeyboard={event => {
                            event.preventDefault();
                            event.stopPropagation();

                            if (isSaving) return;

                            save().catch(error => {
                                reporter.displayError("Couldn’t save description", error);
                            });
                        }}
                    />
                    <InlineEditorToolbar
                        isSaving={isSaving}
                        saveErrorTitle="Couldn’t save description"
                        onSave={save}
                        onCancel={onCancel}
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
