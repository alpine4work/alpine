import classNames from "classnames";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getContentEditorScrollAnchorPosition} from "~/client/web/content/get_content_editor_scroll_anchor_position.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {safeAreaOnlyScrollbarInsetTop, useScrollbar} from "~/client/web/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {optimisticCreatePostEventEmitter} from "~/client/web/forum/internal/optimistic_create_post_event_emitter.js";
import {PostContentViewHeaderBase} from "~/client/web/forum/internal/post_content_view_header.js";
import {
    PostCreatorChannelSelectorInput,
    PostCreatorChannelSelectorInputRef,
} from "~/client/web/forum/internal/post_creator_channel_selector_input.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {sendRpcNavigatorBeacon} from "~/client/web/rpc/send_rpc_navigator_beacon.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/web/spaces/space_context.js";
import {
    postContentViewInnerMarginY,
    postViewContentPaddingTop,
} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, forumStyles, sprinkles} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContent} from "~/shared/content/trim_content.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {PostDraftId} from "~/shared/id/types/id_types.js";
import {createOrReplacePostDraft, createPost} from "~/shared/rpc/forum_rpc_definitions.js";

export function PostCreator({
    draftId,
    displayCreatedTime,
    initialChannel,
    initialContent,
    shouldReturnBack,
    initiallyFocus,
}: {
    draftId: PostDraftId;
    displayCreatedTime: Date;
    initialChannel: ChannelPreviewModel | null;
    initialContent: PostContentWithReferences;
    shouldReturnBack: boolean;
    initiallyFocus: "ContentEditor" | "ChannelSelector" | null;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const context = useAppContext();
    const platform = usePlatform();
    const navigate = useNavigate();
    const {space, currentAccount} = useSpaceContextAndRequireSpaceAccess();

    const editorContainerRef = useRef<HTMLDivElement>(null);
    const channelSelectorRef = useRef<PostCreatorChannelSelectorInputRef>(null);
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);
    const createButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const [state, setState] = useState(() => ContentEditorState.create(initialContent));

    const [channel, setChannel] = useState(initialChannel);

    const doc = state.getDoc();
    const channelId = channel?.id ?? null;

    const lastDocRef = useRef(doc);
    const lastChannelIdRef = useRef(channelId);
    const clearSaveDebounceTimeoutRef = useRef<(() => void) | null>(null);

    // Save the draft on a debounced 5s timer. If the draft hasn't updated for 5
    // seconds then we save it on the server. If the user closes the page (which
    // emits a `visibilitychange` event) then we also make sure to save the draft
    // so it's available the next time the user loads the page.
    useEffect(() => {
        if (lastDocRef.current === doc && lastChannelIdRef.current === channelId) {
            return;
        }

        clearSaveDebounceTimeoutRef.current?.();
        clearSaveDebounceTimeoutRef.current = null;

        lastDocRef.current = doc;
        lastChannelIdRef.current = channelId;

        const run = () => {
            // In case this runs when the user closes the page (`visibilitychange` event)
            // we want to use `navigator.sendBeacon()` so the request isn't cancelled.
            sendRpcNavigatorBeacon(createOrReplacePostDraft, {
                spaceId: space.id,
                draftId,
                channelId,
                content: doc,
            });
        };

        const timeout = createTimeout(() => {
            clearSaveDebounceTimeoutRef.current?.();
            clearSaveDebounceTimeoutRef.current = null;

            run();
        }, 5000);

        const handleVisibilityChange = () => {
            if (document.visibilityState === "hidden") {
                clearSaveDebounceTimeoutRef.current?.();
                clearSaveDebounceTimeoutRef.current = null;

                run();
            }
        };

        document.addEventListener("visibilitychange", handleVisibilityChange);

        clearSaveDebounceTimeoutRef.current = () => {
            timeout.clear();
            document.removeEventListener("visibilitychange", handleVisibilityChange);
        };
    }, [channelId, context, doc, draftId, space.id]);

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
            withoutMinWidth={platform === "mobile"}
            isDisabled={isContentEmpty(state.getDoc()) || !channel}
            pressErrorTitle="Couldn’t create post"
            onPress={async () => {
                if (!channel) return;

                const {post, eventTransaction} = await createPost(context, {
                    channelId: channel.id,
                    draftId,
                    content: trimContent(state.getDoc()),
                });

                // While the client should get their new post data through `<ChannelView>`s
                // WebSocket connection, we emit the realtime event returned by
                // `createPost()` so `<ChannelView>` can use that too in case the WebSocket
                // is slow.
                optimisticCreatePostEventEmitter.emit({
                    channelId: channel.id,
                    eventTransaction,
                });

                if (shouldReturnBack) {
                    await navigate(-1);
                } else {
                    await navigate(`/s/${space.id}/posts/${post.id}`, {
                        replace: true,
                        // In our native mobile app, we want to call
                        // `NativeMobileBridge.navigation.replaceWithPushAnimation()` to run the native
                        // push animation while replacing in the history stack.
                        state: NativeMobileBridge ? {withPushAnimation: true} : undefined,
                    });
                }
            }}
        >
            Post
        </Button>
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        isDisabled: platform !== "mobile",
        title: "New post",
        withoutDisappearingTitle: true,
        replaceActions: (
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
        getAnchorPosition: useCallback(() => getContentEditorScrollAnchorPosition(editorRef), []),
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
            {platform !== "mobile" && (
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
                <OverlayScopeContextProvider>
                    <Box
                        position="relative"
                        minHeight="full"
                        display="flex"
                        flexDirection="column"
                        paddingY="safe-area-inset"
                    >
                        {navigationBar}
                        {platform === "desktop" ? (
                            <Box
                                position="relative"
                                flexShrink="0"
                                width="full"
                                maxWidth={contentStyles.contentMaxWidth}
                                marginX="center"
                                paddingX={screenPaddingX}
                                style={{paddingBottom: postViewContentPaddingTop}}
                            >
                                <Box
                                    display="flex"
                                    alignItems="center"
                                    height={navigationBarHeight}
                                >
                                    <PostContentViewHeaderBase
                                        author={currentAccount}
                                        createdTime={displayCreatedTime}
                                        shouldCreatedTimeExcludeTime
                                        channelSelector={
                                            <PostCreatorChannelSelectorInput
                                                ref={channelSelectorRef}
                                                channel={channel}
                                                onChannelChange={setChannel}
                                                width="full"
                                            />
                                        }
                                    />
                                    <Box flexGrow="1" />
                                    <Box position="relative" top="-2">
                                        {createButtonNode}
                                    </Box>
                                </Box>
                            </Box>
                        ) : (
                            <>
                                <Box height={navigationBarHeight} />
                                <Box
                                    flexShrink="0"
                                    width="full"
                                    maxWidth={contentStyles.contentMaxWidth}
                                    marginX="center"
                                    paddingX={screenPaddingX}
                                    paddingBottom={postContentViewInnerMarginY}
                                >
                                    <PostContentViewHeaderBase
                                        author={currentAccount}
                                        createdTime={displayCreatedTime}
                                        shouldCreatedTimeExcludeTime
                                        extraAfterCreatedTime=", in:"
                                    />
                                    <Box paddingTop="1" paddingLeft="10">
                                        <PostCreatorChannelSelectorInput
                                            ref={channelSelectorRef}
                                            channel={channel}
                                            onChannelChange={setChannel}
                                            width="full"
                                        />
                                    </Box>
                                </Box>
                            </>
                        )}
                        <ContentEditor
                            ref={editorRef}
                            aria-label="New post"
                            state={state}
                            onChange={state => setState(state)}
                            // On mobile, don't allow interactions when unfocused. We're already in an
                            // editing modality.
                            withoutMobileDualModality={true}
                            placeholder="Share your ideas…"
                            // Special case for `<ShareOverlay>`'s "Post in channel". If there's an empty
                            // paragraph followed by a file row then consider the body to be empty so we
                            // see the placeholder in the first empty paragraph instead of empty space.
                            isBodyEmpty={
                                doc.childCount === 2 &&
                                doc.firstChild!.type.name === "paragraph" &&
                                doc.firstChild!.childCount === 0 &&
                                doc.lastChild!.type.name === "fileRow" &&
                                doc.lastChild!.childCount === 1
                            }
                            fileAttachmentTarget={useMemo(
                                () => ({type: "PostDraft", accountId: currentAccount.id, draftId}),
                                [currentAccount.id, draftId],
                            )}
                            onEnsureFileAttachmentTarget={async () => {
                                clearSaveDebounceTimeoutRef.current?.();
                                clearSaveDebounceTimeoutRef.current = null;

                                await createOrReplacePostDraft(context, {
                                    spaceId: space.id,
                                    draftId,
                                    channelId,
                                    content: doc,
                                });
                            }}
                            containerClassName={sprinkles({
                                flexGrow: "1",
                            })}
                            className={classNames(
                                forumStyles.fullScreenContentEditorClassName,
                                sprinkles({
                                    paddingX: screenPaddingX,
                                }),
                            )}
                            onModEnterKeyDown={() => {
                                // Programmatically press the button instead of calling `createPost()`
                                // directly to correctly handle loading and error states.
                                assertExists(createButtonRef.current).press();
                            }}
                        />
                    </Box>
                </OverlayScopeContextProvider>
            </Box>
        </Box>
    );
}
