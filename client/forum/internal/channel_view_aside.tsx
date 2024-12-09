import {Check, X} from "phosphor-react";
import {useId, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {ContentViewWithSeeMoreToggle} from "~/client/content/content_view_with_see_more_toggle.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay_scope_context_provider.js";
import {useReporter} from "~/client/design/reporter.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/design/use_confirm_save_after_losing_focus.js";
import {DynamoGeneralRealtimeQuery} from "~/client/dynamo/dynamo_general_realtime_query.js";
import {ChannelViewContentFilePreview} from "~/client/forum/internal/channel_view_content_file_preview.js";
import {ChannelViewContributorsSection} from "~/client/forum/internal/channel_view_contributors_section.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    channelViewAsideFileGap,
    channelViewAsideFileHeight,
    channelViewAsideMarginTop,
    channelViewAsidePostFileColumnCount,
    channelViewAsidePostFileCount,
    channelViewAsidePostFileRowCount,
    channelViewAsideSectionGap,
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
    postListViewAsideMaxWidth,
} from "~/client/styles/forum_shared_styles.js";
import {colorSchemeVars, fontSizes, sprinkles} from "~/client/styles/styles.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    parseRemLength,
    screenPaddingX,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelOrMetadataModel,
    ChannelPostFilesModel,
} from "~/shared/forum/channel_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {
    MessageContent,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";

const channelViewAsideEditingDescriptionOffsetTop = `${
    parseRemLength(
        subtractRemLengths(
            addRemLengths(
                fontSizes[channelViewMetadataSectionTitleFontSize].lineHeight,
                channelViewAsideMarginTop,
            ),
            // Size of a `md` `<IconButton>`
            "6",
        ),
    ) / 2
}rem`;

export function ChannelViewAside({
    channel,
    channelAndMetadataQuery,
    isEditingDescription,
    onCancelEditingDescription,
    onSaveDescription,
}: {
    channel: ChannelModel;
    channelAndMetadataQuery: DynamoGeneralRealtimeQuery<ChannelOrMetadataModel>;
    isEditingDescription: boolean;
    onCancelEditingDescription: () => void;
    onSaveDescription: (description: MessageContent) => Promise<void>;
}) {
    const spacingScale = useSpacingScale();

    const fileSizePx = convertRemLengthToPx(channelViewAsideFileHeight, spacingScale);

    let contributors: ChannelContributorsModel | null = null;
    const fileReferences: Array<{postId: PostId; signedUrlSearch: string; file: FileModel}> = [];

    outer: for (let i = 0; i < channelAndMetadataQuery.getItemCount(); i++) {
        const item = channelAndMetadataQuery.getItem(i);

        if (item.type === "Loaded" && item.item.model instanceof ChannelContributorsModel) {
            contributors = item.item.model;
        }

        if (item.type !== "Loaded" || !(item.item.model instanceof ChannelPostFilesModel)) {
            continue;
        }

        for (const file of item.item.model.files) {
            fileReferences.push({
                postId: item.item.model.postId,
                file: file.file,
                signedUrlSearch: file.signedUrlSearch,
            });

            if (fileReferences.length > channelViewAsidePostFileCount) break outer;
        }
    }

    return (
        // Put overlays (e.g. the `<FocusRing>`) in the aside so they move smoothly
        // inside this `position: sticky` element.
        <OverlayScopeContextProvider>
            <Box
                position="relative"
                maxWidth={postListViewAsideMaxWidth}
                paddingTop={channelViewAsideMarginTop}
                paddingX={screenPaddingX}
                paddingBottom={screenPaddingX}
                display="flex"
                flexDirection="column"
                gap={channelViewAsideSectionGap}
            >
                {(isEditingDescription || !isContentEmpty(channel.description.doc)) && (
                    <Box
                        // Negative margin bottom to optically align our description. Visually, the
                        // bottom of the text in our `<ContentView>` should be the bottom of our
                        // element.
                        marginBottom="-1.5"
                    >
                        <h3
                            className={sprinkles({
                                color: channelViewMetadataSectionTitleColor,
                                fontSize: channelViewMetadataSectionTitleFontSize,
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
                            <ChannelViewAsideDescription description={channel.description} />
                        )}
                    </Box>
                )}
                <ChannelViewContributorsSection channel={channel} contributors={contributors} />
                <Box>
                    <Box
                        display="flex"
                        justifyContent="space-between"
                        marginBottom={channelViewMetadataSectionTitleMarginBottom}
                        style={{
                            height: fontSizes[channelViewMetadataSectionTitleFontSize].lineHeight,
                        }}
                    >
                        <h3
                            className={sprinkles({
                                color: channelViewMetadataSectionTitleColor,
                                fontSize: channelViewMetadataSectionTitleFontSize,
                            })}
                        >
                            Files
                        </h3>
                        {(fileReferences.length > channelViewAsidePostFileCount ||
                            channelAndMetadataQuery.hasLoadingIndicatorAtEnd()) && (
                            <ChannelViewAsideSeeAllFilesButton channel={channel} />
                        )}
                    </Box>
                    <Box
                        gap={channelViewAsideFileGap}
                        style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${channelViewAsidePostFileColumnCount}, 1fr)`,
                            gridTemplateRows: `repeat(${channelViewAsidePostFileRowCount}, ${channelViewAsideFileHeight})`,
                        }}
                    >
                        {createArrayWithLength(channelViewAsidePostFileCount, index => {
                            const fileReference = fileReferences[index];

                            if (!fileReference) {
                                return (
                                    <Box key={`null-${index}`} border="grey-5" borderRadius="1" />
                                );
                            }

                            return (
                                <ChannelViewContentFilePreview
                                    key={`${fileReference.postId}-${fileReference.file.id}`}
                                    postId={fileReference.postId}
                                    file={fileReference.file}
                                    signedUrlSearch={fileReference.signedUrlSearch}
                                    size={fileSizePx}
                                />
                            );
                        })}
                    </Box>
                </Box>
            </Box>
        </OverlayScopeContextProvider>
    );
}

function ChannelViewAsideDescription({description}: {description: MessageContentWithReferences}) {
    const descriptionSnippet = useMemo(() => {
        return {
            doc: assertMessageContent(
                getContentSnippet(
                    description.doc.resolve(0),
                    {linesAbove: 0, linesBelow: 7},
                    {
                        // 1.125x the number of "x"s we can fit in a single line in the channel aside
                        // (45). We want to be slightly more aggressive than the default grapheme count
                        // (which counts the "l" character which is narrower) since we render the entire
                        // snippet.
                        maxLineGraphemeCount: 51,
                    },
                ),
            ),
            references: description.references,
        };
    }, [description.doc, description.references]);

    return (
        <Box paddingTop="1">
            <ContentViewWithSeeMoreToggle
                isCompact={true}
                content={description}
                contentSnippet={descriptionSnippet}
            />
        </Box>
    );
}

// `<ChannelViewAside>` is not used on mobile since we don't have the space. So
// when implementing for mobile we forked this description editor into
// `<ChannelViewHeaderMobileDescriptionEditor>`. Any changes made here should
// probably be made there too.
function ChannelViewAsideDescriptionEditor({
    initialDescription,
    onCancel,
    onSave,
}: {
    initialDescription: MessageContentWithReferences;
    onCancel: () => void;
    onSave: (description: MessageContent) => Promise<void>;
}) {
    const reporter = useReporter();
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
                position="absolute"
                right={screenPaddingX}
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
                        isCompact={true}
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
                                reporter.displayError("Couldn’t save description", error);
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

function ChannelViewAsideSeeAllFilesButton({channel}: {channel: ChannelModel}) {
    const navigate = useNavigate();
    const {space} = useSpaceContext();

    const {isPressed, pressProps} = usePress({
        onPress: () => {
            navigate(`/s/${space.id}/channels/${channel.id}/files?from=channel`, {
                // Don't open in a peek when in desktop layout. Instead perform a full page
                // navigation.
                stopPropagation: true,
            });
        },
    });

    return (
        <FocusRing>
            <button
                {...pressProps}
                className={sprinkles({
                    fontStyle: "semi-bold",
                    fontSize: channelViewMetadataSectionTitleFontSize,
                    cursor: "pointer",
                    color: "grey-90",
                    opacity: isPressed ? "60" : "100",
                })}
            >
                See all
            </button>
        </FocusRing>
    );
}
