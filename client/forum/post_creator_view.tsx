import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {useCallback, useEffect, useRef} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {getRemPxWithoutListening} from "~/client/design/helpers/use_rem_px.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
    useNavigationBar,
} from "~/client/design/navigation_bar.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {safeAreaOnlyScrollbarInsetTop, useScrollbar} from "~/client/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {PostContentViewHeaderBase} from "~/client/forum/internal/post_content_view_header.js";
import {
    PostCreatorViewChannelSelectorInput,
    PostCreatorViewChannelSelectorInputRef,
} from "~/client/forum/internal/post_creator_view_channel_selector_input.js";
import {
    desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    postContentViewInnerMarginY,
    postViewMaxWidth,
} from "~/client/forum/post_content_view.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useSessionStorage} from "~/client/helpers/use_local_storage.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {
    PostContentWithReferences,
    PostContentWithReferencesSchema,
    emptyPostContentWithReferences,
} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {Id} from "~/shared/id/id.js";
import {createPost} from "~/shared/rpc/forum_rpc_definitions.js";
import {Schema} from "~/shared/schema/schema.js";
import {contentSchemaStyles, forumStyles, sprinkles} from "~/shared/styles/styles.js";

export const createPostEventEmitter = new EventEmitter<{
    readTime: Date;
    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
}>();

const StateSchema = Schema.object({
    content: PostContentWithReferencesSchema,
    hasContentChanged: Schema.boolean,
}).transform<{
    state: ContentEditorState<PostContentWithReferences>;
    hasContentChanged: boolean;
}>({
    serialize: ({state, hasContentChanged}) => ({
        content: state.getContent(),
        hasContentChanged,
    }),
    deserialize: ({content, hasContentChanged}) => ({
        state: ContentEditorState.create(content),
        hasContentChanged,
    }),
});

const postContentEditorBlockMaxWidth = mapObjectValues(screenPaddingX, paddingX =>
    subtractRemLengths(spacing[postViewMaxWidth], spacing[paddingX]),
);

export function PostCreatorView({
    withMobileLayout: withMobileLayoutProp,
    draftId,
    displayCreatedTime,
    channel,
    onChannelChange,
    shouldReturnBack,
    initiallyFocus,
}: {
    withMobileLayout: boolean;
    draftId: Id;
    displayCreatedTime: Date;
    channel: ChannelPreviewModel | null;
    onChannelChange: (channel: ChannelPreviewModel | null) => void;
    shouldReturnBack: boolean;
    initiallyFocus: "ContentEditor" | "ChannelSelector" | null;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const context = useAppContext();
    const isMobile = useIsMobile();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContext();

    const editorContainerRef = useRef<HTMLDivElement>(null);
    const channelSelectorRef = useRef<PostCreatorViewChannelSelectorInputRef>(null);
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);
    const createButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const sessionStorageKey = `cyberworlds/draftPost/${draftId}`;

    const [{state, hasContentChanged}, setState] = useSessionStorage(
        sessionStorageKey,
        // State schema is lossy. When serializing/deserializing we lose selection
        // state and other editor state bits. We only deserialize when loading on
        // initial mount or if another tab tells us there was an update.
        StateSchema,
        () => ({
            state: ContentEditorState.create(emptyPostContentWithReferences),
            hasContentChanged: false,
        }),
    );

    const hasInitiallyFocusedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyFocusedRef.current) return;
        hasInitiallyFocusedRef.current = true;

        return scheduleAfterNavigationAnimation(() => {
            switch (initiallyFocus) {
                case null: {
                    // noop...
                    break;
                }
                case "ContentEditor": {
                    assertExists(editorRef.current).focus();
                    break;
                }
                case "ChannelSelector": {
                    assertExists(channelSelectorRef.current).focus();
                    break;
                }
                default:
                    throw exhaustive(initiallyFocus);
            }
        });
    }, [initiallyFocus]);

    const createButtonNode = (
        <Button
            ref={createButtonRef}
            variant="neutral"
            withoutMinWidth={isMobile}
            isDisabled={!hasContentChanged || isContentEmpty(state.getDoc()) || !channel}
            pressErrorTitle="Couldn’t create post"
            onPress={async () => {
                if (!channel) return;

                const {post, readTime, eventTransaction} = await createPost(context, {
                    channelId: channel.id,
                    content: state.getDoc(),
                });

                // While the client should get their new post data through `<ChannelView>`s
                // WebSocket connection, we emit the realtime event returned by
                // `createPost()` so `<ChannelView>` can use that too in case the WebSocket
                // is slow.
                createPostEventEmitter.emit({readTime, eventTransaction});

                if (shouldReturnBack) {
                    await navigate(-1);
                } else {
                    await navigate(`/s/${space.id}/posts/${post.id}`, {
                        replace: true,
                    });
                }

                // Quietly cleanup draft from session storage without re-rendering our
                // component which is about to be unmounted.
                sessionStorage.removeItem(sessionStorageKey);
            }}
        >
            Post
        </Button>
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: !isMobile,
        withMobileLayout,
        title: "New post",
        withoutDisappearingTitle: true,
        replaceActions: isMobile && (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                {createButtonNode}
            </Box>
        ),
    });

    useScrollToAvoidBottomBarsAndMobileKeyboard(editorContainerRef, {
        // - Disable on `isInitialAppRender` since `coordsAtPos()` won't work on
        //   initial render.
        // - Disable on `sidebarState.isOpen` since the comment view should be
        //   scrolling not the document.
        isDisabled: isInitialAppRender,
        getAnchorPosition: useCallback(() => {
            const editor = assertExists(editorRef.current);

            // Don't anchor if the editor is not focused. The channel selector input might
            // be focused!
            if (!editor.isFocused()) return null;

            const editorState = editor.getState();

            const coords = editor.coordsAtPos(editorState.getSelection().from);

            const paragraphLineHeight = convertRemLengthToPx(
                contentSchemaStyles.paragraphLineHeight,
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
            position="relative"
            flexGrow="1"
            width="full"
            height="full"
            overflow="hidden"
            display="flex"
            flexDirection="column"
        >
            {!isMobile && (
                // No safe area cover on mobile since the navigation bar will act as a safe
                // area cover.
                <Box
                    position="absolute"
                    top="0"
                    left="0"
                    right="0"
                    zIndex="10"
                    height="safe-area-inset-top"
                    backgroundColor="grey-0"
                />
            )}
            <Box
                ref={useMergedRefs<HTMLDivElement>(
                    editorContainerRef,
                    scrollViewRef,
                    useScrollbar({insetTop: scrollbarInsetTop ?? safeAreaOnlyScrollbarInsetTop}),
                )}
                flexGrow="1"
                width="full"
                position="relative"
                zIndex="0"
                overflowX="hidden"
                overflowY="auto"
            >
                <Box
                    position="relative"
                    minHeight="full"
                    display="flex"
                    flexDirection="column"
                    paddingTop="safe-area-inset"
                    style={{
                        ...assignInlineVars({
                            [contentSchemaStyles.blockMaxWidthVar]:
                                postContentEditorBlockMaxWidth[isMobile ? "mobile" : "desktop"],
                        }),
                    }}
                >
                    {navigationBar}
                    {isMobile && <Box height={navigationBarHeight} />}
                    <Box
                        flexShrink="0"
                        width="full"
                        maxWidth={postViewMaxWidth}
                        marginX="center"
                        paddingX={screenPaddingX}
                        paddingBottom={postContentViewInnerMarginY}
                        style={{
                            paddingTop: withMobileLayout
                                ? isMobile
                                    ? `${mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`
                                    : `${mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`
                                : `${desktopPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`,
                        }}
                    >
                        <PostContentViewHeaderBase
                            author={currentAccount}
                            createdTime={displayCreatedTime}
                            shouldCreatedTimeExcludeTime
                            extraAfterCreatedTime={isMobile ? `, in:` : undefined}
                            channelSelector={
                                !isMobile && (
                                    <PostCreatorViewChannelSelectorInput
                                        ref={channelSelectorRef}
                                        channel={channel}
                                        onChannelChange={onChannelChange}
                                    />
                                )
                            }
                        />
                        {isMobile && (
                            <Box paddingTop="1" paddingLeft="10">
                                <PostCreatorViewChannelSelectorInput
                                    ref={channelSelectorRef}
                                    channel={channel}
                                    onChannelChange={onChannelChange}
                                    width="full"
                                />
                            </Box>
                        )}
                    </Box>
                    <ContentEditor
                        ref={editorRef}
                        aria-label="New post"
                        state={state}
                        onChange={(state, transaction) => {
                            setState({
                                state,
                                hasContentChanged: hasContentChanged || transaction.docChanged,
                            });
                        }}
                        // On mobile, don't allow interactions when unfocused. We're already in an
                        // editing modality.
                        withoutMobileDualModality={true}
                        placeholder="Share your ideas…"
                        containerClassName={sprinkles({
                            flexGrow: "1",
                        })}
                        className={classNames(
                            forumStyles.fullScreenContentEditorClassName,
                            sprinkles({
                                paddingX: contentSchemaStyles.screenPaddingXWithoutBlockPaddingX,
                            }),
                        )}
                        onModEnter={() => {
                            // Programmatically press the button instead of calling `createPost()`
                            // directly to correctly handle loading and error states.
                            assertExists(createButtonRef.current).press();
                        }}
                    />
                    {!isMobile && (
                        <Box
                            flexShrink="0"
                            width="full"
                            marginX="center"
                            maxWidth={postViewMaxWidth}
                            paddingBottom="safe-area-inset"
                        >
                            <Box height="12" paddingX="2.5" display="flex" alignItems="center">
                                <Box flexGrow="1" />
                                {createButtonNode}
                            </Box>
                        </Box>
                    )}
                </Box>
            </Box>
        </Box>
    );
}
