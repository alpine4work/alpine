import classNames from "classnames";
import {Transaction} from "prosemirror-state";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {getContentEditorScrollAnchorPosition} from "~/client/web/content/get_content_editor_scroll_anchor_position.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {
    mobileNavigationBarActionsWidthFittingFlexBasis,
    navigationBarHeight,
} from "~/client/web/design/navigation_bar_helpers.js";
import {OverlayScopeContextProvider} from "~/client/web/design/overlay_scope_context_provider.js";
import {scheduleAfterNavigationAnimation} from "~/client/web/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/web/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {PostContentViewHeader} from "~/client/web/forum/internal/post_content_view_header.js";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {useNavigationBar} from "~/client/web/navigation/navigation_bar.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {postContentViewInnerMarginY} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, forumStyles, sprinkles} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {PostContent, PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export function PostMobileEditor({
    post: postFromProps,
    contentEditorState: state,
    onContentEditorStateChange: onChange,
    initialContent,
    onCloseWithAnimation,
    onSave,
}: {
    post: PostModel | null;
    contentEditorState: ContentEditorState<PostContentWithReferences>;
    onContentEditorStateChange: (
        contentEditorState: ContentEditorState<PostContentWithReferences>,
        transaction: Transaction,
    ) => void;
    initialContent: PostContent;
    onCloseWithAnimation: () => void;
    onSave: () => Promise<void>;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const platform = usePlatform();

    const [postFromState, setPost] = useState(postFromProps);
    let post = assertExists(
        postFromState,
        "`<PostMobileEditorView>`’s `post` prop must be non-null on initial render",
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
            onPress={onSave}
        >
            Save
        </Button>
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
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
                    >
                        {navigationBar}
                        {platform === "mobile" && <Box height={navigationBarHeight} />}
                        <Box
                            flexShrink="0"
                            width="full"
                            maxWidth={contentStyles.contentMaxWidth}
                            marginX="center"
                            paddingX={screenPaddingX}
                            paddingBottom={postContentViewInnerMarginY}
                        >
                            <PostContentViewHeader post={post} shouldShowChannel={true} />
                        </Box>
                        <ContentEditor
                            ref={editorRef}
                            aria-label="Post"
                            state={state}
                            onChange={onChange}
                            // On mobile, don't allow interactions when unfocused. We're already in an
                            // editing modality.
                            withoutMobileDualModality={true}
                            placeholder="Share your ideas…"
                            fileAttachmentTarget={useMemo(
                                (): FileAttachmentTarget => ({type: "Post", postId: post.id}),
                                [post.id],
                            )}
                            containerClassName={sprinkles({
                                flexGrow: "1",
                            })}
                            className={classNames(
                                forumStyles.fullScreenContentEditorClassName,
                                sprinkles({paddingX: screenPaddingX}),
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
