import {useMemo, useRef, useState} from "react";
import {createAccessPolicyStore} from "~/client/web/access/create_access_policy_store.js";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentViewWithSeeMoreToggle} from "~/client/web/content/content_view_with_see_more_toggle.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {ChannelViewContributorsSection} from "~/client/web/forum/internal/channel_view_contributors_section.js";
import {ChannelViewSubscribeButton} from "~/client/web/forum/internal/channel_view_subscribe_button.js";
import {PostFauxInputCreateButton} from "~/client/web/forum/internal/post_faux_input_create_button.js";
import {PostListHeader} from "~/client/web/forum/post_list.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {InlineEditorToolbar} from "~/client/web/messaging/inline_editor_toolbar.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {useCurrentDate} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {PostShimmer} from "~/client/web/shimmer/post_shimmer.js";
import {useSiteRegistry} from "~/client/web/sites/context/site_registry_context.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {
    channelViewHeaderNarrowRouteLayoutMarginTop,
    channelViewHeaderSectionGap,
    postContentViewOuterMarginY,
    postFauxInputCreateButtonMarginTop,
} from "~/client/web/styles/forum_shared_styles.js";
import {backgroundColorVar, colorSchemeVars, sprinkles} from "~/client/web/styles/styles.js";
import {
    getAccountAccessLevelAssumingSpaceAccess,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {
    MessageContent,
    MessageContentWithReferences,
    assertMessageContent,
} from "~/shared/content/message_content_schema.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {formatPrettyAbsoluteDateWithoutFullTimeTooltip} from "~/shared/design/format_pretty_absolute_date_without_full_time_tooltip.js";
import {ChannelContributorsModel, ChannelModel} from "~/shared/forum/channel_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function ChannelViewHeader({
    header,
    hasNoPosts,
}: {
    header: PostListHeader & {type: "Channel"};
    hasNoPosts: boolean;
}) {
    const platform = usePlatform();
    const routeLayout = useRouteLayout();
    const {currentAccount} = useSpaceContext();
    const siteRegistry = useSiteRegistry();
    const accessPolicy = useStore(
        useMemo(
            () => createAccessPolicyStore(header.channel.accessPolicy, siteRegistry),
            [header.channel.accessPolicy, siteRegistry],
        ),
    );

    const accessLevel = useMemo(
        () => getAccountAccessLevelAssumingSpaceAccess(accessPolicy, currentAccount?.id),
        [accessPolicy, currentAccount?.id],
    );

    let contributors: ChannelContributorsModel | null = null;

    if (header.channelAndMetadataQuery) {
        for (let i = 0; i < header.channelAndMetadataQuery.getItemCount(); i++) {
            const item = header.channelAndMetadataQuery.getItem(i);

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
                    <Box
                        display="flex"
                        justifyContent="space-between"
                        flexWrap="wrap"
                        columnGap="4"
                        rowGap={channelViewHeaderSectionGap}
                    >
                        <ChannelViewContributorsSection
                            channel={header.channel}
                            contributors={contributors}
                            withoutTitle={true}
                            onAddAccountGrantsToAccessPolicy={
                                header.onAddAccountGrantsToAccessPolicy
                            }
                        />
                        {platform === "mobile" && (
                            <ChannelViewSubscribeButton
                                channelId={header.channel.id}
                                initialIsSubscribed={header.initialIsSubscribed}
                            />
                        )}
                    </Box>
                    <Box marginBottom="-1.5">
                        <h3 className={sprinkles({color: "grey-50"})}>About</h3>
                        {!header.isEditingDescription ? (
                            <ChannelViewHeaderMobileDescription channel={header.channel} />
                        ) : (
                            <ChannelViewHeaderMobileDescriptionEditor
                                channel={header.channel}
                                onCancel={header.onCancelDescriptionEditing}
                                onSave={header.onSaveDescription}
                            />
                        )}
                    </Box>
                </Box>
            )}
            {hasAccessLevel(accessLevel, "Edit") ? (
                <Box
                    paddingTop={postFauxInputCreateButtonMarginTop[routeLayout]}
                    paddingBottom={postContentViewOuterMarginY}
                    paddingX={screenPaddingX}
                >
                    <PostFauxInputCreateButton channel={header.channel} />
                </Box>
            ) : routeLayout === "narrow" ? (
                <Spacer space={channelViewHeaderSectionGap} />
            ) : null}
            {hasNoPosts && (
                <Box position="relative" zIndex="0" style={{paddingBottom: 1}}>
                    <Box
                        position="absolute"
                        zIndex="20"
                        inset="0"
                        pointerEvents="none"
                        opacity="70"
                        style={{background: `linear-gradient(transparent, ${backgroundColorVar})`}}
                    ></Box>
                    <Box
                        position="absolute"
                        zIndex="10"
                        top="0"
                        left={screenPaddingX}
                        right={screenPaddingX}
                        height="border"
                    >
                        <Box width="full" height="full" backgroundColor="grey-5" />
                    </Box>
                    <PostShimmer withoutPulseAnimation={true} />
                    <PostShimmer withoutPulseAnimation={true} />
                    <PostShimmer withoutPulseAnimation={true} />
                    <Box height="safe-area-inset-bottom" />
                </Box>
            )}
        </>
    );
}

function ChannelViewHeaderMobileDescription({channel}: {channel: ChannelModel}) {
    const clientInfo = useClientInfo();
    const currentDate = useCurrentDate();

    const descriptionSnippet = useMemo(() => {
        return {
            doc: assertMessageContent(
                getContentSnippet(
                    channel.description.doc.resolve(0),
                    {linesAbove: 0, linesBelow: 3},
                    {
                        // 1.125x the number of "x"s we can fit in a single line in a peek (64). We want to
                        // be slightly more aggressive than the default grapheme count (which counts the
                        // "l" character which is narrower) since we render the entire snippet.
                        maxLineGraphemeCount: 72,
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

// `<ChannelViewHeaderMobileDescriptionEditor>` is not used on desktop. Instead the
// channel description is in an aside. We forked this component from
// `<ChannelViewAsideDescriptionEditor>`. Any changes made here should probably be
// made there too.
function ChannelViewHeaderMobileDescriptionEditor({
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
    const {space} = useSpaceContext();

    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);

    const [state, setState] = useState(() =>
        ContentEditorState.create({
            spaceId: space.id,
            content: channel.description,
            selection: "start",
        }),
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
        </Box>
    );
}
