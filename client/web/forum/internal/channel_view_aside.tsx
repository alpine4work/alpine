import {useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentViewWithSeeMoreToggle} from "~/client/web/content/content_view_with_see_more_toggle.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {DynamoGeneralRealtimeQuery} from "~/client/web/dynamo/dynamo_general_realtime_query.js";
import {ChannelViewContentFilePreview} from "~/client/web/forum/internal/channel_view_content_file_preview.js";
import {ChannelViewContributorsSection} from "~/client/web/forum/internal/channel_view_contributors_section.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {InlineEditorToolbar} from "~/client/web/messaging/inline_editor_toolbar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    channelViewAsideFileGap,
    channelViewAsideFileHeight,
    channelViewAsidePaddingTop,
    channelViewAsidePostFileColumnCount,
    channelViewAsidePostFileMaxCount,
    channelViewAsidePostFileRowCount,
    channelViewAsideSectionGap,
    channelViewMetadataSectionTitleColor,
    channelViewMetadataSectionTitleFontSize,
    channelViewMetadataSectionTitleMarginBottom,
    postListViewAsideMaxWidth,
} from "~/client/web/styles/forum_shared_styles.js";
import {colorSchemeVars, fontSizes, sprinkles} from "~/client/web/styles/styles.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {
    MessageContent,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {convertRemLengthToPx, screenPaddingX} from "~/shared/design/core/spacing.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {FileModel} from "~/shared/files/file_model.js";
import {
    ChannelContributorsModel,
    ChannelModel,
    ChannelOrMetadataModel,
    ChannelPostFilesModel,
} from "~/shared/forum/channel_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {sliceIterable} from "~/shared/helpers/iterable/slice_iterable.js";
import {AccountId, PostId} from "~/shared/id/types/id_types.js";

export function ChannelViewAside({
    channel,
    channelAndMetadataQuery,
    isEditingDescription,
    onCancelEditingDescription,
    onSaveDescription,
    onAddAccountGrantsToAccessPolicy,
}: {
    channel: ChannelModel;
    channelAndMetadataQuery: DynamoGeneralRealtimeQuery<ChannelOrMetadataModel>;
    isEditingDescription: boolean;
    onCancelEditingDescription: () => void;
    onSaveDescription: (description: MessageContent) => Promise<void>;
    onAddAccountGrantsToAccessPolicy: (event: {
        accountGrantById: ReadonlyMap<AccountId, {level: AccessLevel}>;
        notification: ShareNotification | null;
    }) => Promise<void>;
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

            if (fileReferences.length > channelViewAsidePostFileMaxCount) break outer;
        }
    }

    return (
        // Put overlays (e.g. the `<FocusRing>`) in the aside so they move smoothly inside
        // this `position: sticky` element.
        <OverlayScopeContextProvider>
            <Box
                position="relative"
                maxWidth={postListViewAsideMaxWidth}
                paddingLeft="5"
                paddingRight={screenPaddingX}
                paddingBottom={screenPaddingX}
                display="flex"
                flexDirection="column"
                gap={channelViewAsideSectionGap}
                style={{paddingTop: channelViewAsidePaddingTop}}
            >
                <ChannelViewContributorsSection
                    channel={channel}
                    contributors={contributors}
                    onAddAccountGrantsToAccessPolicy={onAddAccountGrantsToAccessPolicy}
                />
                <Box
                    // Negative margin bottom to optically align our description. Visually, the bottom
                    // of the text in our `<ContentView>` should be the bottom of our element.
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
                            channel={channel}
                            onCancel={onCancelEditingDescription}
                            onSave={onSaveDescription}
                        />
                    ) : (
                        <ChannelViewAsideDescription channel={channel} />
                    )}
                </Box>
                {fileReferences.length > 0 && (
                    <Box>
                        <Box
                            display="flex"
                            justifyContent="space-between"
                            marginBottom={channelViewMetadataSectionTitleMarginBottom}
                            style={{
                                height: fontSizes[channelViewMetadataSectionTitleFontSize]
                                    .lineHeight,
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
                            {(fileReferences.length > channelViewAsidePostFileMaxCount ||
                                channelAndMetadataQuery.hasLoadingIndicatorAtEnd()) && (
                                <ChannelViewAsideSeeAllFilesButton channel={channel} />
                            )}
                        </Box>
                        <Box
                            gap={channelViewAsideFileGap}
                            style={{
                                display: "grid",
                                gridTemplateColumns: `repeat(${channelViewAsidePostFileColumnCount}, 1fr)`,
                                gridTemplateRows: `repeat(${Math.min(
                                    Math.ceil(fileReferences.length / 2),
                                    channelViewAsidePostFileRowCount,
                                )}, ${channelViewAsideFileHeight})`,
                            }}
                        >
                            {mapIterable(
                                sliceIterable(fileReferences, 0, channelViewAsidePostFileMaxCount),
                                fileReference => {
                                    return (
                                        <ChannelViewContentFilePreview
                                            key={`${fileReference.postId}-${fileReference.file.id}`}
                                            postId={fileReference.postId}
                                            file={fileReference.file}
                                            signedUrlSearch={fileReference.signedUrlSearch}
                                            size={fileSizePx}
                                        />
                                    );
                                },
                            )}
                        </Box>
                    </Box>
                )}
            </Box>
        </OverlayScopeContextProvider>
    );
}

function ChannelViewAsideDescription({channel}: {channel: ChannelModel}) {
    const clientInfo = useClientInfo();
    const currentDate = useCurrentDate();

    const descriptionSnippet = useMemo(() => {
        return {
            doc: assertMessageContent(
                getContentSnippet(
                    channel.description.doc.resolve(0),
                    {linesAbove: 0, linesBelow: 7},
                    {
                        // 1.125x the number of "x"s we can fit in a single line in the channel aside (45).
                        // We want to be slightly more aggressive than the default grapheme count (which
                        // counts the "l" character which is narrower) since we render the entire snippet.
                        maxLineGraphemeCount: 51,
                    },
                ),
            ),
            references: channel.description.references,
        };
    }, [channel.description.doc, channel.description.references]);

    return (
        <Box paddingTop="1">
            <ContentViewWithSeeMoreToggle
                content={channel.description}
                contentSnippet={descriptionSnippet}
                // If the description is empty then we render a dummy placeholder to incentivize
                // adding a description to the channel.
                placeholder={`Created ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                    clientInfo.locale,
                    clientInfo.timeZone,
                    currentDate,
                    channel.createdTime,
                    {withLongMonth: true, withLongWeekday: true, withoutTime: true},
                )}`}
            />
        </Box>
    );
}

// `<ChannelViewAside>` is not used on mobile since we don't have the space. So
// when implementing for mobile we forked this description editor into
// `<ChannelViewHeaderMobileDescriptionEditor>`. Any changes made here should
// probably be made there too.
function ChannelViewAsideDescriptionEditor({
    channel,
    onCancel,
    onSave,
}: {
    channel: ChannelModel;
    onCancel: () => void;
    onSave: (description: MessageContent) => Promise<void>;
}) {
    const reporter = useReporter();
    const clientInfo = useClientInfo();
    const currentDate = useCurrentDate();

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [state, setState] = useState(() =>
        ContentEditorState.create(channel.description, {selection: "end"}),
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
                        // Use box shadow to draw the border so it doesn't add 1px to layout like `border`
                        // CSS would.
                        boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                    }}
                    ref={useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: state.getDoc() !== channel.description.doc,
                        isConfirmingSave: shouldShowConfirmSaveDialog,
                        onCancelSave: onCancel,
                        onConfirmSave: () => setShouldShowConfirmSaveDialog(true),
                    })}
                >
                    <ContentEditor
                        ref={editorRef}
                        aria-label="Description"
                        // If the description is empty then we render a dummy placeholder to incentivize
                        // adding a description to the channel.
                        placeholder={`Created ${formatPrettyAbsoluteDateWithoutFullTimeTooltip(
                            clientInfo.locale,
                            clientInfo.timeZone,
                            currentDate,
                            channel.createdTime,
                            {withLongMonth: true, withLongWeekday: true, withoutTime: true},
                        )}`}
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
                                reporter.displayError("Couldn\u2019t save description", error);
                            });
                        }}
                    />
                    <InlineEditorToolbar
                        isSaving={isSaving}
                        saveErrorTitle="Couldn&#x2019;t save description"
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
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel" and
                        // lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmSaveDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Couldn&#x2019;t save description"
                    onPrimaryButtonPress={save}
                    cancelButtonLabel="Discard description"
                    cancelButtonPressErrorTitle="Couldn&#x2019;t discard description"
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
