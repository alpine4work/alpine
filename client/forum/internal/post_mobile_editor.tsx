import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {useCallback, useEffect, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {ContentEditorState} from "~/client/content/content_editor_state.js";
import {getContentEditorScrollAnchorPosition} from "~/client/content/get_content_editor_scroll_anchor_position.js";
import {trimContentEnd} from "~/client/content/trim_content_end.js";
import {useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
    useNavigationBar,
} from "~/client/design/navigation_bar.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {PostContentViewHeader} from "~/client/forum/internal/post_content_view_header.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput,
    postContentViewInnerMarginY,
    postViewMaxWidth,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles, forumStyles, sprinkles} from "~/client/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {screenPaddingX, spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {PostContent, PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {updatePostContent} from "~/shared/rpc/forum_rpc_definitions.js";

const postContentEditorBlockMaxWidth = mapObjectValues(screenPaddingX, paddingX =>
    subtractRemLengths(spacing[postViewMaxWidth], spacing[paddingX]),
);

export function PostMobileEditor({
    post: postFromProps,
    contentEditorState: state,
    onContentEditorStateChange: onChange,
    initialContent,
    onCloseWithAnimation,
    onPostRealtimeEventTransaction,
}: {
    post: PostModel | null;
    contentEditorState: ContentEditorState<PostContentWithReferences>;
    onContentEditorStateChange: (
        contentEditorState: ContentEditorState<PostContentWithReferences>,
    ) => void;
    initialContent: PostContent;
    onCloseWithAnimation: () => void;
    onPostRealtimeEventTransaction: (event: {
        readTime: Date;
        eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<PostModel>>;
    }) => void;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const isMobile = useIsMobile();
    const context = useAppContext();

    const [postFromState, setPost] = useState(postFromProps);
    let post = assertExists(
        postFromState,
        "`<PostMobileEditorView>`'s `post` prop must be non-null on initial render",
    );

    // If `postFromProps` becomes null (the parent component lost the data somehow)
    // we want to keep the initial post we saw in state.
    if (postFromProps !== null && post !== postFromProps) {
        post = postFromProps;
        setPost(postFromProps);
    }

    const editorContainerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<PostContentWithReferences>>(null);
    const createButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);

    const hasInitiallyFocusedRef = useRef(false);

    useEffect(() => {
        if (hasInitiallyFocusedRef.current) return;
        hasInitiallyFocusedRef.current = true;

        return scheduleAfterNavigationAnimation(() => {
            assertExists(editorRef.current).focus();
        });
    }, []);

    useScrollToAvoidBottomBarsAndMobileKeyboard(editorContainerRef, {
        // - Disable on `isInitialAppRender` since `coordsAtPos()` won't work on
        //   initial render.
        // - Disable on `sidebarState.isOpen` since the comment view should be
        //   scrolling not the document.
        isDisabled: isInitialAppRender,
        getAnchorPosition: useCallback(() => getContentEditorScrollAnchorPosition(editorRef), []),
    });

    const hasContentChanged = state.getDoc() !== initialContent;

    const saveButtonNode = (
        <Button
            ref={createButtonRef}
            variant="neutral"
            withoutMinWidth={true}
            isDisabled={!hasContentChanged || isContentEmpty(state.getDoc())}
            pressErrorTitle="Couldn’t save post"
            onPress={async () => {
                const event = await updatePostContent(context, {
                    postId: post.id,
                    content: trimContentEnd(state.getDoc()),
                });

                onPostRealtimeEventTransaction(event);
                onCloseWithAnimation();
            }}
        >
            Save
        </Button>
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout: true,
        title: "Edit post",
        withoutDisappearingTitle: true,
        replaceActions: (
            <Box
                display="flex"
                justifyContent="flex-end"
                style={{width: mobileNavigationBarActionsWidthFittingFlexBasis}}
            >
                {saveButtonNode}
            </Box>
        ),
        // Instead of calling `navigate(-1)` the navigation bar needs a cancel button.
        onMobileCancel: onCloseWithAnimation,
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
            <Box
                ref={useMergedRefs<HTMLDivElement>(
                    editorContainerRef,
                    scrollViewRef,
                    useScrollbar({insetTop: scrollbarInsetTop}),
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
                        paddingTop="safe-area-inset"
                        style={{
                            ...assignInlineVars({
                                [contentStyles.blockMaxWidthVar]:
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
                                paddingTop: isMobile
                                    ? `${mobilePlatformPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`
                                    : `${mobileLayoutPostContentViewMarginTopRemIfSingleLayoutWithPinnedCommentInput}rem`,
                            }}
                        >
                            <PostContentViewHeader post={post} shouldShowChannel={true} />
                        </Box>
                        <ContentEditor
                            ref={editorRef}
                            aria-label="Post"
                            // Only rendered in mobile layouts.
                            withMobileLayout={true}
                            state={state}
                            onChange={onChange}
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
                                    paddingX: contentStyles.screenPaddingXWithoutBlockPaddingX,
                                }),
                            )}
                            onModEnter={() => {
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
