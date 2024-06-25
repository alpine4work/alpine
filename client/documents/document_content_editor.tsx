import {AnimationControls, animate, spring, timeline} from "motion";
import {
    ArrowLeft,
    ArrowUp,
    CaretDown,
    CaretLeft,
    CaretRight,
    CaretUp,
    SpinnerGap,
    X,
} from "phosphor-react";
import {redo, undo} from "prosemirror-history";
import {
    Memo,
    Ref,
    RefObject,
    useCallback,
    useEffect,
    useId,
    useMemo,
    useRef,
    useState,
} from "react";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {createCommentThreadMetaKey} from "~/client/content/content_editor_state.js";
import {MessageInputRef} from "~/client/content/messaging/message_input_base.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu.js";
import {
    mobileFullScreenModalAnimationDurationLongMs,
    mobileFullScreenModalAnimationDurationMs,
    mobileFullScreenModalAnimationEasingParsedCubicBezier,
    useIsBehindMobileFullScreenModal,
} from "~/client/design/mobile_full_screen_modal.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {NavigationBarRef, useNavigationBar} from "~/client/design/navigation_bar.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {useReporter} from "~/client/design/reporter.js";
import {scheduleAfterNavigationAnimation} from "~/client/design/schedule_after_navigation_animation.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {Spacer} from "~/client/design/spacer.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
import {useScrollToAvoidBottomBarsAndMobileKeyboard} from "~/client/design/use_scroll_to_avoid_bottom_bars_and_mobile_keyboard.js";
import {useDevConsoleTool} from "~/client/dev/dev_console.js";
import {
    DocumentCommentThreadListView,
    DocumentCommentThreadListViewRef,
} from "~/client/documents/document_comment_thread_list_view.js";
import {
    DocumentContentEditorSideDecoration,
    DocumentContentEditorSideDecorations,
} from "~/client/documents/internal/document_content_editor_side_decorations.js";
import {DocumentContentEditorWebSocketClientProcedures} from "~/client/documents/internal/document_content_editor_web_socket_client.js";
import {useDocumentContentEditorPhantomSelections} from "~/client/documents/internal/use_document_content_editor_phantom_selections.js";
import {
    SubscribeToCommentThreadEventsFunction,
    useDocumentContentEditorWebSocket,
} from "~/client/documents/use_document_content_editor_web_socket.js";
import {isMobileWebKit} from "~/client/helpers/browser/is_mobile_web_kit.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent, useEvents} from "~/client/helpers/lifecycle/use_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useIsMounted} from "~/client/helpers/lifecycle/use_is_mounted.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening, useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useIsInertNativeMobileRoute} from "~/client/remix/use_is_inert_native_mobile_route.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {addRemLengths, convertRemLengthToPx, spacing} from "~/shared/design/spacing.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContent,
    DocumentContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {
    DocumentCommentModel,
    DocumentCommentThreadModel,
    DocumentModel,
    getDocumentContentTitle,
} from "~/shared/documents/document_model.js";
import {InternalError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {isRangeContained} from "~/shared/helpers/geometry/is_range_contained.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {
    messageInputAccountAvatarPaddingY,
    messageInputAccountAvatarSize,
    messageInputMinHeight,
    messageViewBubbleBorderRadius,
    messageViewBubbleMinHeight,
} from "~/shared/styles/messaging_shared_styles.js";
import {
    colorSchemeVars,
    contentEditorStyles,
    contentSchemaStyles,
    documentContentStyles,
    inputPlaceholderStyles,
    spinAnimationClassName,
} from "~/shared/styles/styles.js";

export const documentContentEditorSidebarWidth = spacing["96"];
const documentContentEditorMobileSidebarInsetTop = "48";

const {screenPaddingXWithoutBlockPaddingX} = contentSchemaStyles;
const {documentContentClassName} = documentContentStyles;

export type DocumentContentEditorInitialScroll = {
    readonly type: "CommentThread";
    readonly commentThreadId: DocumentCommentThreadId;
};

type DocumentContentEditorSidebarState =
    | {
          readonly isOpen: false;
          readonly transition: DocumentContentEditorSidebarTransition | null;
      }
    | {
          readonly isOpen: true;
          readonly animationState: "Opening" | "Closing" | null;
          readonly transition: DocumentContentEditorSidebarTransition | null;
          readonly commentThreadId: DocumentCommentThreadId;
          readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
          readonly mobileState: DocumentContentEditorSidebarMobileState;
      };

type DocumentContentEditorSidebarMobileState =
    | {
          readonly isFullScreen: false;
      }
    | {
          readonly isFullScreen: true;
          readonly animationState: "Expanding" | "Contracting" | null;
          readonly onAnimationFinishedRef: {current: (() => void) | null};
      };

type DocumentContentEditorSidebarTransition = {
    readonly commentThreadId: DocumentCommentThreadId;
    readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
    // Promise that resolves when the transition finishes. This may happen before
    // the data promise resolves! Or if another transition starts cancelling our
    // previous transition.
    readonly pendingPromiseResolver: PromiseResolver<void>;
};

type DocumentContentEditorSidebarData = {
    readonly commentThread: DocumentCommentThreadModel;
    readonly initialComments: ReadonlyArray<DocumentCommentModel>;
    readonly initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    readonly initialOptimisticComments: ReadonlyArray<OptimisticMessageModel>;
};

export function DocumentContentEditor({
    withMobileLayout: withMobileLayoutProp,
    documentId,
    initialDocument,
    initialCommentThreadResult,
    initialScrollToCommentIndex,
    initialScroll,
    shouldInitiallyFocus,
    onCreate,
    onContentChange,
    onContentLocalChange,
    onCommentThreadChange,
}: {
    withMobileLayout: boolean;
    documentId: DocumentId;
    initialDocument: DocumentModel | null;
    initialCommentThreadResult: {
        commentThread: DocumentCommentThreadModel;
        initialComments: ReadonlyArray<DocumentCommentModel>;
        initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    } | null;
    initialScrollToCommentIndex: number | null;
    initialScroll: DocumentContentEditorInitialScroll | null;
    shouldInitiallyFocus: boolean;
    onCreate?: () => void;
    onContentChange?: (content: DocumentContent) => void;
    onContentLocalChange?: () => void;
    onCommentThreadChange?: (commentThreadId: DocumentCommentThreadId | null) => void;
}) {
    const reporter = useReporter();
    const isInitialAppRender = useIsInitialAppRender();
    const {isAppleDevice, isNativeMobile} = useClientInfo();
    const isMobile = useIsMobile();
    const isMounted = useIsMounted();
    const editorRef = useRef<ContentEditorRef<DocumentContentWithReferences>>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const commentThreadListViewRef = useRef<DocumentCommentThreadListViewRef>(null);
    const editorContainerId = useId();
    const [containerResizeRef, containerSize] = useResizeObserver();

    const withMobileLayout = isMobile || withMobileLayoutProp;

    const {
        spaceId,
        isConnected,
        editorState,
        onChangeEditorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
        toggleShouldConnect,
        procedures,
        subscribeToCommentThreadEvents,
        unpersistedResolutionStateByCommentThreadId,
        ensureCreateDocument,
    } = useDocumentContentEditorWebSocket({documentId, initialDocument}, {onCreate});

    const phantomSelections = useDocumentContentEditorPhantomSelections({
        editorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
    });

    useDevConsoleTool(
        "documentContentEditor",
        useCallback(
            () => ({
                prosemirrorSchema: DocumentContentProsemirrorSchema,
                toggleShouldConnect,
            }),
            [toggleShouldConnect],
        ),
    );

    const content = editorState.getContent();
    const lastContentDocRef = useRef(content.doc);
    useEffect(() => {
        if (content.doc !== lastContentDocRef.current) {
            onContentChange?.(content.doc);
            lastContentDocRef.current = content.doc;
        }
    }, [content.doc, onContentChange]);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const editor = assertExists(editorRef.current);

        if (!shouldInitiallyFocus) return;

        return scheduleAfterNavigationAnimation(() => {
            editor.focus();
        });
    }, [shouldInitiallyFocus]);

    /* ========================================================================== *\
     *                            Sidebar animations                              *
    \* ========================================================================== */

    // TODO(calebmer): The word "sidebar" is a bit of a misnomer now that on mobile
    // comments are displayed in a bottom sheet. Maybe rename someday?
    const [sidebarState, setSidebarState] = useState<DocumentContentEditorSidebarState>(() => {
        if (!initialCommentThreadResult) {
            return {
                isOpen: false,
                transition: null,
            };
        }

        const data: DocumentContentEditorSidebarData = {
            ...initialCommentThreadResult,
            initialOptimisticComments: [],
        };

        return {
            isOpen: true,
            animationState: null,
            transition: null,
            commentThreadId: initialCommentThreadResult.commentThread.id,
            dataPromise: PromiseImmediate.resolve(data),
            mobileState: {isFullScreen: false},
        };
    });

    // Sidebar may not be fullscreen if we're not on a mobile device.
    if (sidebarState.isOpen && sidebarState.mobileState.isFullScreen && !isMobile) {
        setSidebarState({...sidebarState, mobileState: {isFullScreen: false}});
    }

    const pinnedCommentInputRef = useRef<MessageInputRef>(null);
    const mobileFakeCommentInputRef = useRef<HTMLDivElement>(null);
    const mobileFakeCommentInputEditorRef = useRef<HTMLDivElement>(null);

    const sidebarAnimationInRef = useRef<AnimationControls | null>(null);
    const sidebarAnimationOutRef = useRef<AnimationControls | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!(sidebarState.isOpen && sidebarState.animationState === "Opening")) {
            sidebarAnimationInRef.current?.cancel();
            sidebarAnimationInRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarAnimationInRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const remPx = getRemPxWithoutListening();

        let animation: AnimationControls;

        if (withMobileLayout) {
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            const sidebarHeight =
                editorContainerRect.height -
                convertRemLengthToPx(spacing[documentContentEditorMobileSidebarInsetTop], remPx);

            const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

            animation = timeline(
                [
                    [
                        sidebarElement,
                        {y: [sidebarHeight, 0]},
                        {
                            easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    ],
                    [
                        mobileFakeCommentInputElement ?? [],
                        {y: [sidebarHeight, 0]},
                        {
                            at: 0,
                            easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    ],
                ],
                {
                    // Add a little bit of delay so React can finish rendering before playing our
                    // animation.
                    delay: 0.05,
                    duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
                },
            );
        } else {
            const blockMaxWidth = convertRemLengthToPx(
                contentSchemaStyles.defaultBlockMaxWidth,
                remPx,
            );
            const paddingXPx =
                convertRemLengthToPx(
                    spacing[screenPaddingXWithoutBlockPaddingX[isMobile ? "mobile" : "desktop"]],
                    remPx,
                ) * 2;
            const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
            const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

            const oldContentOffset = Math.max(
                0,
                (editorContainerElement.clientWidth - paddingXPx + sidebarWidth - blockMaxWidth) /
                    2,
            );
            const newContentOffset = Math.max(
                0,
                (editorContainerElement.clientWidth - paddingXPx - blockMaxWidth) / 2,
            );

            animation = timeline(
                [
                    [sidebarElement, {x: [sidebarWidth + sidebarOffscreenBufferWidth, 0]}],
                    [
                        editorContainerElement,
                        {x: [oldContentOffset - newContentOffset, 0]},
                        {at: 0},
                    ],
                ],
                {
                    // Add a little bit of delay so React can finish rendering before playing our
                    // animation.
                    delay: 0.05,
                    defaultOptions: {
                        easing: spring({
                            stiffness: 300,
                            damping: 31,
                        }),
                    },
                },
            );
        }

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of
            // both.
            if (isMobileWebKit && withMobileLayout) {
                const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

                sidebarElement.style.transform = "translateY(0)";
                if (mobileFakeCommentInputElement)
                    mobileFakeCommentInputElement.style.transform = "translateY(0)";
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll
            // view translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Opening")
                    return sidebarState;

                return {...sidebarState, animationState: null};
            });
        });

        sidebarAnimationInRef.current = animation;
    }, [isMobile, sidebarState, withMobileLayout]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!(sidebarState.isOpen && sidebarState.animationState === "Closing")) {
            sidebarAnimationOutRef.current?.cancel();
            sidebarAnimationOutRef.current = null;
            return;
        }

        // Already animating out...
        if (sidebarAnimationOutRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const remPx = getRemPxWithoutListening();

        let animation: AnimationControls;
        let sidebarHeight: number | undefined;

        if (withMobileLayout) {
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            sidebarHeight =
                editorContainerRect.height -
                convertRemLengthToPx(spacing[documentContentEditorMobileSidebarInsetTop], remPx);

            const scrollBottom =
                editorContainerElement.scrollHeight -
                (editorContainerElement.scrollTop + editorContainerElement.clientHeight);

            // After our sidebar is done closing we'll remove the safe area we added to the
            // bottom of the document. If we've scrolled to the bottom of the document this
            // will cause the document to jump back into place. This is jarring so instead
            // animate a scroll along with our close animation to get us back to the right
            // place before the document size changes.
            if (scrollBottom < sidebarHeight) {
                editorContainerElement.scrollTo({
                    top: editorContainerElement.scrollTop - (sidebarHeight - scrollBottom),
                    behavior: "smooth",
                });
            }

            const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

            animation = timeline(
                [
                    [
                        sidebarElement,
                        {y: [0, sidebarHeight]},
                        {
                            easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    ],
                    [
                        mobileFakeCommentInputElement ?? [],
                        {y: [0, sidebarHeight]},
                        {
                            at: 0,
                            easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                            // Make sure we use hardware acceleration for this animation in WebKit. By
                            // default `motion` turns it off.
                            // https://motion.dev/guides/performance#webkits-exceptions
                            allowWebkitAcceleration: true,
                        },
                    ],
                ],
                {
                    // Add a little bit of delay so React can finish rendering before playing our
                    // animation.
                    delay: 0.05,
                    duration: mobileFullScreenModalAnimationDurationLongMs / 1000,
                },
            );
        } else {
            const blockMaxWidth = convertRemLengthToPx(
                contentSchemaStyles.defaultBlockMaxWidth,
                remPx,
            );
            const paddingXPx =
                convertRemLengthToPx(
                    spacing[screenPaddingXWithoutBlockPaddingX[isMobile ? "mobile" : "desktop"]],
                    remPx,
                ) * 2;
            const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
            const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

            const oldContentOffset = Math.max(
                0,
                (editorContainerElement.clientWidth - paddingXPx - sidebarWidth - blockMaxWidth) /
                    2,
            );
            const newContentOffset = Math.max(
                0,
                (editorContainerElement.clientWidth - paddingXPx - blockMaxWidth) / 2,
            );

            animation = timeline(
                [
                    [sidebarElement, {x: [0, sidebarWidth + sidebarOffscreenBufferWidth]}],
                    [
                        editorContainerElement,
                        {x: [oldContentOffset - newContentOffset, 0]},
                        {at: 0},
                    ],
                ],
                {
                    // Add a little bit of delay so React can finish rendering before playing our
                    // animation.
                    delay: 0.05,
                    defaultOptions: {
                        easing: spring({
                            stiffness: 420,
                            damping: 35,
                        }),
                    },
                },
            );
        }

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of
            // both.
            if (isMobileWebKit && withMobileLayout) {
                const mobileFakeCommentInputElement = mobileFakeCommentInputRef.current;

                sidebarElement.style.transform = `translateY(${sidebarHeight!}px)`;
                if (mobileFakeCommentInputElement)
                    mobileFakeCommentInputElement.style.transform = `translateY(${sidebarHeight!}px)`;
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll
            // view translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Closing")
                    return sidebarState;

                return {isOpen: false, transition: null};
            });
        });

        sidebarAnimationOutRef.current = animation;
    }, [isMobile, sidebarState, withMobileLayout]);

    // When the sidebar opens on mobile:
    //
    // 1. Add safe area to the bottom of the document of the same height as the
    //    sidebar (sidebar is positioned as a bottom sheet on mobile)
    // 2. Make sure the content editor is blurred
    useLayoutEffectWithoutServerSideWarning(() => {
        const editorContainerElement = assertExists(editorContainerRef.current);

        if (!withMobileLayout || !sidebarState.isOpen) {
            editorContainerElement.style.removeProperty("--safe-area-inset-bottom");
            return;
        }

        const editor = assertExists(editorRef.current);
        editor.blur();

        const remPx = getRemPxWithoutListening();
        const editorContainerRect = editorContainerElement.getBoundingClientRect();

        const sidebarHeight =
            editorContainerRect.height -
            convertRemLengthToPx(spacing[documentContentEditorMobileSidebarInsetTop], remPx);

        editorContainerElement.style.setProperty("--safe-area-inset-bottom", `${sidebarHeight}px`);
    }, [sidebarState.isOpen, withMobileLayout]);

    const sidebarMobileFullScreenAnimationInRef = useRef<AnimationControls | null>(null);
    const sidebarMobileFullScreenAnimationOutRef = useRef<AnimationControls | null>(null);

    useEffect(() => {
        if (
            !sidebarState.isOpen ||
            !sidebarState.mobileState.isFullScreen ||
            sidebarState.mobileState.animationState !== "Expanding"
        ) {
            sidebarMobileFullScreenAnimationInRef.current?.cancel();
            sidebarMobileFullScreenAnimationInRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarMobileFullScreenAnimationInRef.current) return;

        const sidebarElement = assertExists(sidebarRef.current);

        const offset = convertRemLengthToPx(
            spacing[documentContentEditorMobileSidebarInsetTop],
            getRemPxWithoutListening(),
        );

        // If the user has scrolled far enough down a comment thread (e.g. all the way
        // to the bottom) then once the expand animation finishes there'll be a bunch
        // of empty space that'll disappear once we take away the comment thread's
        // mobile background slop. Since it looks janky to animate in this empty space
        // then take it away, instead do a scroll to prevent the background slop from
        // showing at the beginning of our expand animation.
        const commentThreadListView = commentThreadListViewRef.current;
        if (commentThreadListView) {
            const scrollTop = commentThreadListView.getScrollOffset();
            const scrollBottom =
                commentThreadListView.getContentHeight() -
                (scrollTop + commentThreadListView.getHeight());

            if (scrollBottom < offset) {
                commentThreadListView.setScrollOffset(scrollTop - (offset - scrollBottom), {
                    behavior: "instant",
                });
            }
        }

        const animation = animate(
            sidebarElement,
            {y: [0, -offset]},
            {
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of
            // both.
            if (isMobileWebKit) {
                sidebarElement.style.transform = `translateY(${-offset}px)`;
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll
            // view translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (
                    !sidebarState.isOpen ||
                    !sidebarState.mobileState.isFullScreen ||
                    sidebarState.mobileState.animationState !== "Expanding"
                ) {
                    return sidebarState;
                }

                return {
                    ...sidebarState,
                    mobileState: {...sidebarState.mobileState, animationState: null},
                };
            });
        });

        sidebarMobileFullScreenAnimationInRef.current = animation;
    }, [sidebarState, withMobileLayout]);

    useEffect(() => {
        if (
            !sidebarState.isOpen ||
            !sidebarState.mobileState.isFullScreen ||
            sidebarState.mobileState.animationState !== "Contracting"
        ) {
            sidebarMobileFullScreenAnimationOutRef.current?.cancel();
            sidebarMobileFullScreenAnimationOutRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarMobileFullScreenAnimationOutRef.current) return;

        const sidebarElement = assertExists(sidebarRef.current);

        const offset = convertRemLengthToPx(
            spacing[documentContentEditorMobileSidebarInsetTop],
            getRemPxWithoutListening(),
        );

        const animation = animate(
            sidebarElement,
            {y: [-offset, 0]},
            {
                duration: mobileFullScreenModalAnimationDurationMs / 1000,
                easing: mobileFullScreenModalAnimationEasingParsedCubicBezier,
                // Make sure we use hardware acceleration for this animation in WebKit. By
                // default `motion` turns it off.
                // https://motion.dev/guides/performance#webkits-exceptions
                allowWebkitAcceleration: true,
            },
        );

        void animation.finished.finally(() => {
            // NOTE(calebmer, #mobile-webkit-weirdness): I've observed mobile WebKit,
            // surprisingly, reverting back to initial transform values when the animation
            // completes. Make sure our transforms stick in the DOM by manually updating.
            //
            // This feels like either a bug in WebKit or `motion` or the combination of
            // both.
            if (isMobileWebKit) {
                sidebarElement.style.transform = "translateY(0)";
            }

            // Our native app doesn't automatically update scrollbar insets after a scroll
            // view translates (since this is rare) so manually update all insets.
            NativeMobileBridge?.scrollbar.updateAllInsets();

            setSidebarState(sidebarState => {
                if (
                    !sidebarState.isOpen ||
                    !sidebarState.mobileState.isFullScreen ||
                    sidebarState.mobileState.animationState !== "Contracting"
                ) {
                    return sidebarState;
                }

                return {
                    ...sidebarState,
                    mobileState: {isFullScreen: false},
                };
            });
        });

        sidebarMobileFullScreenAnimationOutRef.current = animation;
    }, [sidebarState, withMobileLayout]);

    // Focus the comment input if it was requested in our state.
    useEffect(() => {
        if (
            sidebarState.isOpen &&
            sidebarState.mobileState.isFullScreen &&
            sidebarState.mobileState.animationState === null &&
            sidebarState.mobileState.onAnimationFinishedRef.current
        ) {
            const onAnimationFinished = sidebarState.mobileState.onAnimationFinishedRef.current;
            sidebarState.mobileState.onAnimationFinishedRef.current = null;
            onAnimationFinished();
        }
    }, [sidebarState]);

    const [pressedCommentThreadId, setPressedCommentThreadId] =
        useState<DocumentCommentThreadId | null>(null);

    const sidebarCommentThreadId =
        sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? sidebarState.commentThreadId
            : null;

    {
        const lastSidebarCommentThreadIdRef = useRef(sidebarCommentThreadId);
        useEffect(() => {
            if (sidebarCommentThreadId !== lastSidebarCommentThreadIdRef.current) {
                onCommentThreadChange?.(sidebarCommentThreadId);
                lastSidebarCommentThreadIdRef.current = sidebarCommentThreadId;
            }
        }, [onCommentThreadChange, sidebarCommentThreadId]);
    }

    const activeCommentThreadId = pressedCommentThreadId ?? sidebarCommentThreadId;

    const documentContentEditorSidebarWidthPx = convertRemLengthToPx(
        documentContentEditorSidebarWidth,
        useRemPx(),
    );

    // We compute the *editor* container size from the container size so that when
    // the sidebar opens/closes we don't need to re-render side decorations when the
    // resize observer changes.
    const editorContainerWidth =
        containerSize && sidebarState.isOpen && sidebarState.animationState !== "Closing"
            ? containerSize.width - documentContentEditorSidebarWidthPx
            : containerSize?.width ?? null;

    /* ========================================================================== *\
     *                     Comment thread sidebar navigation                      *
    \* ========================================================================== */

    const openCommentThread = useEvent((commentThreadId: DocumentCommentThreadId) => {
        // If this comment thread is already open or in the process of opening then
        // don't open it again.
        if (
            sidebarState.transition?.commentThreadId === commentThreadId ||
            (sidebarState.isOpen &&
                sidebarState.commentThreadId === commentThreadId &&
                !sidebarState.transition)
        ) {
            return Promise.resolve();
        }

        const dataPromise = procedures
            .getCommentThreadAndInitialCommentsIfExists({
                commentThreadId,
                limit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
            })
            .then((data): DocumentContentEditorSidebarData | null => {
                if (data.commentThread === null) return null;

                return {
                    commentThread: data.commentThread,
                    initialComments: data.initialComments,
                    initialOtherReferencedComments: data.initialOtherReferencedComments,
                    initialOptimisticComments: [],
                };
            });

        const pendingPromiseResolver = createPromiseResolver();

        setSidebarState(sidebarState => ({
            ...sidebarState,
            transition: {
                commentThreadId,
                dataPromise: PromiseImmediate.resolve(dataPromise),
                pendingPromiseResolver,
            },
        }));

        return pendingPromiseResolver.promise;
    });

    useEffect(() => {
        const transition = sidebarState.transition;
        if (!transition) return;

        let isCancelled = false;
        let isAccepted = false;

        const acceptTransition = () => {
            if (isCancelled) return;

            if (isAccepted) return;
            isAccepted = true;

            transition.pendingPromiseResolver.resolve();

            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen) {
                    return {
                        isOpen: true,
                        animationState: "Opening",
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                        mobileState: {isFullScreen: false},
                    };
                } else {
                    return {
                        isOpen: true,
                        animationState: sidebarState.animationState,
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                        mobileState: {isFullScreen: false},
                    };
                }
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        transition.dataPromise.then(data => {
            if (isCancelled) return;
            if (isAccepted) return;

            if (!data) {
                reporter.logErrorWithoutDisplaying(
                    "Selected document comment thread couldn't be opened",
                    new InternalError("Couldn't find document comment thread"),
                );

                // Comment thread not found so cancel the transition.
                setSidebarState({
                    isOpen: false,
                    transition: null,
                });
            } else {
                acceptTransition();
            }
        }, acceptTransition);

        const timeout = createTimeout(
            acceptTransition,
            delayScreenTransitionLoadingIndicatorLimitMs,
        );

        return () => {
            isCancelled = true;
            timeout.clear();
            transition.pendingPromiseResolver.resolve();
        };
    }, [reporter, sidebarState.transition]);

    const [
        mobileDiscardSidebarCommentInputModalState,
        setMobileDiscardSidebarCommentInputModalState,
    ] = useState<{onDiscard: () => void} | null>(null);

    const {onSidebarClose, onSidebarMobileFullScreenExpand, onSidebarMobileFullScreenContract} =
        useEvents({
            onSidebarClose: () => {
                const run = () => {
                    setSidebarState(sidebarState => {
                        if (!sidebarState.isOpen) return sidebarState;
                        return {...sidebarState, animationState: "Closing" as const};
                    });
                };

                // If the user is in a fullscreen comment thread, warn if they try to exit
                // without sending a comment they've typed in.
                //
                // We do this mostly since the fake comment input rendered when the comment
                // thread is open but not fullscreen will always be empty. So when returning to
                // that state we want to actually empty out the underlying comment input.
                if (
                    sidebarState.isOpen &&
                    sidebarState.mobileState.isFullScreen &&
                    !pinnedCommentInputRef.current?.isEmpty()
                ) {
                    setMobileDiscardSidebarCommentInputModalState({onDiscard: run});
                    return;
                }

                // We still want to call `clear()` to clear replying state and editing state.
                pinnedCommentInputRef.current?.clear();

                run();
            },
            onSidebarMobileFullScreenExpand: ({
                onAnimationFinished,
            }: {
                onAnimationFinished?: () => void;
            } = {}) => {
                setSidebarState(sidebarState => {
                    if (!sidebarState.isOpen) return sidebarState;
                    if (sidebarState.mobileState.isFullScreen) return sidebarState;

                    return {
                        ...sidebarState,
                        mobileState: {
                            isFullScreen: true,
                            animationState: "Expanding",
                            onAnimationFinishedRef: {current: onAnimationFinished ?? null},
                        },
                    };
                });
            },
            onSidebarMobileFullScreenContract: () => {
                pinnedCommentInputRef.current?.blur();

                const run = () => {
                    setSidebarState(sidebarState => {
                        if (!sidebarState.isOpen) return sidebarState;
                        if (!sidebarState.mobileState.isFullScreen) return sidebarState;

                        return {
                            ...sidebarState,
                            mobileState: {
                                ...sidebarState.mobileState,
                                animationState: "Contracting",
                            },
                        };
                    });
                };

                // If the user is in a fullscreen comment thread, warn if they try to exit
                // without sending a comment they've typed in.
                //
                // We do this mostly since the fake comment input rendered when the comment
                // thread is open but not fullscreen will always be empty. So when returning to
                // that state we want to actually empty out the underlying comment input.
                if (
                    sidebarState.isOpen &&
                    sidebarState.mobileState.isFullScreen &&
                    !pinnedCommentInputRef.current?.isEmpty()
                ) {
                    setMobileDiscardSidebarCommentInputModalState({onDiscard: run});
                    return;
                }

                // We still want to call `clear()` to clear replying state and editing state.
                pinnedCommentInputRef.current?.clear();

                run();
            },
        });

    /* ========================================================================== *\
     *                        Comment decoration collection                       *
    \* ========================================================================== */

    const [decorationByMarkTop, setDecorationByMarkTop] = useState<
        ReadonlyMap<
            number,
            {
                readonly markHeight: number;
                readonly commentThreadIds: ReadonlySet<DocumentCommentThreadId>;
            }
        >
    >(() => new Map());

    useLayoutEffectWithoutServerSideWarning(() => {
        // Our editor won't be able to determine positions of comment marks until after
        // the initial render because it uses `<ContentView>` which doesn't support
        // `coordsAtPos()`.
        if (isInitialAppRender) return;

        // Recompute our decorations whenever the editor width changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        editorContainerWidth;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const editor = assertExists(editorRef.current);

        // We still collect decorations on mobile even though we don't render them
        // because we need them for the next/previous buttons on an opened comment
        // thread.
        const {decorationByMarkTop} = collectDecorationByMarkTop(
            {
                editorContainerElement,
                editorContainerRect: editorContainerElement.getBoundingClientRect(),
                editor,
                seenCommentThreadIds: new Set(),
                decorationByMarkTop: new Map(),
            },
            content.doc,
        );

        setDecorationByMarkTop(previousDecorationByMarkTop => {
            // Often the document will change but our decorations will not change. Do not
            // re-render the component if our decorations did not change.
            if (isDeepEqual(previousDecorationByMarkTop, decorationByMarkTop))
                return previousDecorationByMarkTop;

            return decorationByMarkTop;
        });
    }, [
        editorContainerRef,
        content.doc,
        editorRef,
        isInitialAppRender,
        editorContainerWidth,
        isMobile,
    ]);

    const {totalDecoratedCommentThreads, decorations} = useMemo(() => {
        let totalDecoratedCommentThreads = 0;

        const decorations = Array.from(decorationByMarkTop, ([markTop, decoration]) => {
            totalDecoratedCommentThreads += decoration.commentThreadIds.size;

            return {
                markTop,
                markHeight: decoration.markHeight,
                commentThreadIds: decoration.commentThreadIds,
            };
        }).sort((a, b) => a.markTop - b.markTop);

        return {
            totalDecoratedCommentThreads,
            decorations,
        };
    }, [decorationByMarkTop]);

    /* ========================================================================== *\
     *                       Scroll to comment in document                        *
    \* ========================================================================== */

    const scrollToEditorRect = useEvent(
        (
            rect: DOMRect,
            {behavior, prefer}: {behavior: ScrollBehavior; prefer?: "top" | "bottom"},
        ) => {
            const navigationBar = assertExists(navigationBarRef.current);
            const editorContainerElement = assertExists(editorContainerRef.current);

            const remPx = getRemPxWithoutListening();

            const navigationBarMaxVisibleHeight = navigationBar.getMaxVisibleHeight();
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            // When using mobile layout the sidebar takes up visible space.
            const sidebarHeight =
                withMobileLayout && sidebarState.isOpen
                    ? editorContainerRect.height -
                      convertRemLengthToPx(
                          spacing[documentContentEditorMobileSidebarInsetTop],
                          remPx,
                      )
                    : 0;

            const visibleRect = {
                top: editorContainerRect.top + navigationBarMaxVisibleHeight,
                bottom: editorContainerRect.bottom - sidebarHeight,
            };
            visibleRect.bottom = Math.max(visibleRect.bottom, visibleRect.top);

            const visibleHeight = visibleRect.bottom - visibleRect.top;

            const commentMarkTop = editorContainerElement.scrollTop + rect.top - visibleRect.top;
            const commentMarkBottom =
                editorContainerElement.scrollTop + rect.bottom - visibleRect.top;

            // Try scrolling the element 20% from the top of the screen...
            const candidateScrollTop1 = clamp(
                0,
                commentMarkTop - visibleHeight / 5,
                editorContainerElement.scrollHeight - visibleHeight,
            );

            // Try scrolling the element 20% from the bottom of the screen...
            const candidateScrollTop2 = clamp(
                0,
                commentMarkBottom + visibleHeight / 5 - visibleHeight,
                editorContainerElement.scrollHeight - visibleHeight,
            );

            if (prefer === "top") {
                editorContainerElement.scrollTo({top: candidateScrollTop1, behavior});
            } else if (prefer === "bottom") {
                editorContainerElement.scrollTo({top: candidateScrollTop2, behavior});
            } else {
                const candidateScrollTop1Distance = Math.abs(
                    candidateScrollTop1 - editorContainerElement.scrollTop,
                );
                const candidateScrollTop2Distance = Math.abs(
                    candidateScrollTop2 - editorContainerElement.scrollTop,
                );

                // Pick the scroll offset that moves our window the least. That way there are
                // no big disorienting jumps.
                if (candidateScrollTop2Distance < candidateScrollTop1Distance) {
                    editorContainerElement.scrollTo({top: candidateScrollTop2, behavior});
                } else {
                    editorContainerElement.scrollTo({top: candidateScrollTop1, behavior});
                }
            }
        },
    );

    const handleCommentThreadSnippetPress = useEvent((commentThreadId: DocumentCommentThreadId) => {
        const editorContainerElement = assertExists(editorContainerRef.current);
        const firstCommentMarkElement = editorContainerElement.querySelector(
            `[data-comment="${commentThreadId}"]`,
        );
        if (!firstCommentMarkElement) return;

        scrollToEditorRect(firstCommentMarkElement.getBoundingClientRect(), {behavior: "instant"});
    });

    {
        const hasInitializedRef = useRef(false);
        const lastSidebarStateRef = useRef(sidebarState);
        useLayoutEffectWithoutServerSideWarning(() => {
            // Ignore the initial app render since we won't have rendered comment marks...
            if (isInitialAppRender) return;

            const isInitialRender = !hasInitializedRef.current;
            hasInitializedRef.current = true;

            const lastSidebarState = lastSidebarStateRef.current;
            lastSidebarStateRef.current = sidebarState;

            const commentThreadId =
                sidebarState.isOpen &&
                // NOTE(calebmer): I've found running the sidebar open animation and the scroll
                // animation at the same time on mobile WebKit makes the sidebar open animation
                // look janky. However sequencing one after the other looks smooth. *shrug*
                (!isMobileWebKit || sidebarState.animationState !== "Opening") &&
                sidebarState.animationState !== "Closing"
                    ? sidebarState.commentThreadId
                    : null;

            // When the sidebar comment thread changes, scroll to the comment in
            // the document. Or when the component initially mounts.
            if (!commentThreadId) return;

            const navigationBar = assertExists(navigationBarRef.current);
            const editorContainerElement = assertExists(editorContainerRef.current);

            const commentMarkElements = editorContainerElement.querySelectorAll(
                `[data-comment="${commentThreadId}"]`,
            );

            // Comment thread doesn't exist in the document anymore
            if (commentMarkElements.length === 0) return;

            const remPx = getRemPxWithoutListening();

            const navigationBarVisibleHeight = navigationBar.getVisibleHeight();
            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            // When using mobile layout the sidebar takes up visible space.
            const sidebarHeight =
                withMobileLayout && sidebarState.isOpen
                    ? editorContainerRect.height -
                      convertRemLengthToPx(
                          spacing[documentContentEditorMobileSidebarInsetTop],
                          remPx,
                      )
                    : 0;

            const visibleRect = {
                top: editorContainerRect.top + navigationBarVisibleHeight,
                bottom: editorContainerRect.bottom - sidebarHeight,
            };
            visibleRect.bottom = Math.max(visibleRect.bottom, visibleRect.top);

            let firstCommentMarkRect: DOMRect | undefined;
            let isSomeCommentMarkVisible = false;

            for (const commentMarkElement of commentMarkElements) {
                const commentMarkRect = commentMarkElement.getBoundingClientRect();
                if (!firstCommentMarkRect) firstCommentMarkRect = commentMarkRect;

                if (
                    isRangeContained(
                        visibleRect.top,
                        visibleRect.bottom,
                        commentMarkRect.top,
                        commentMarkRect.bottom,
                    )
                ) {
                    isSomeCommentMarkVisible = true;
                    break;
                }
            }

            // If any of the comment's mark elements are visible we don't need to scroll to
            // it! If the user wants to see exactly the part of the doc in the preview they
            // can click on the preview.
            if (isSomeCommentMarkVisible) return;

            assert(firstCommentMarkRect);
            scrollToEditorRect(firstCommentMarkRect, {
                behavior:
                    // Don't animate scroll if:
                    //
                    // 1. This is the initial render; OR
                    // 2. We're opening the sidebar in our desktop layout
                    //
                    // In case 1 we should open immediately to the comment (e.g. if the user is
                    // navigating here from somewhere). In case 2 we need to scroll because of a
                    // layout shift when we made the document content narrower so it would be weird
                    // to animate.
                    isInitialRender || (!lastSidebarState.isOpen && !withMobileLayout)
                        ? "instant"
                        : "smooth",
            });
        }, [isInitialAppRender, isMobile, scrollToEditorRect, sidebarState, withMobileLayout]);
    }

    /* ========================================================================== *\
     *                           Initial render scroll                            *
    \* ========================================================================== */

    {
        const hasInitializedRef = useRef(false);

        useLayoutEffectWithoutServerSideWarning(() => {
            if (hasInitializedRef.current) return;
            hasInitializedRef.current = true;

            const editorContainerElement = assertExists(editorContainerRef.current);

            if (initialCommentThreadResult) {
                if (initialScrollToCommentIndex !== null) {
                    commentThreadListViewRef.current?.jumpToCommentIndex(
                        initialCommentThreadResult.commentThread.id,
                        initialScrollToCommentIndex,
                    );
                }
            } else if (initialScroll) {
                const firstCommentMarkElement = editorContainerElement.querySelector(
                    `[data-comment="${initialScroll.commentThreadId}"]`,
                );
                if (firstCommentMarkElement) {
                    scrollToEditorRect(firstCommentMarkElement.getBoundingClientRect(), {
                        behavior: "instant",
                        prefer: "top",
                    });
                }
            }
        }, [
            initialCommentThreadResult,
            initialScroll,
            initialScrollToCommentIndex,
            scrollToEditorRect,
        ]);
    }

    /* ========================================================================== *\
     *                               Native Mobile                                *
    \* ========================================================================== */

    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();
    const isBehindMobileFullScreenModal = useIsBehindMobileFullScreenModal();
    const isInert = isInertNativeMobileRoute || isBehindMobileFullScreenModal;

    useScrollToAvoidBottomBarsAndMobileKeyboard(editorContainerRef, {
        // - Disable on `isInitialAppRender` since `coordsAtPos()` won't work on
        //   initial render.
        // - Disable on `sidebarState.isOpen` since the comment view should be
        //   scrolling not the document.
        isDisabled: isInitialAppRender || sidebarState.isOpen,
        getAnchorPosition: useCallback(() => {
            const editor = assertExists(editorRef.current);
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

    useEffect(() => {
        if (!NativeMobileBridge) return;
        if (isInitialAppRender) return;
        if (isInert) return;

        const editor = assertExists(editorRef.current);

        const getIsAddCommentEditMenuOptionVisible = () => {
            return (
                !document.activeElement ||
                document.activeElement === document.body ||
                editor.isFocused()
            );
        };

        let lastIsAddCommentEditMenuOptionVisible: boolean | null = null;

        const handleFocusChange = () => {
            const isAddCommentEditMenuOptionVisible = getIsAddCommentEditMenuOptionVisible();

            // Noop if there was no change.
            if (lastIsAddCommentEditMenuOptionVisible === isAddCommentEditMenuOptionVisible) return;

            lastIsAddCommentEditMenuOptionVisible = isAddCommentEditMenuOptionVisible;

            if (isAddCommentEditMenuOptionVisible) {
                NativeMobileBridge!.editMenu.enableAddCommentAction();
            } else {
                NativeMobileBridge!.editMenu.disableAddCommentAction();
            }
        };

        document.addEventListener("focusin", handleFocusChange);
        document.addEventListener("focusout", handleFocusChange);

        // We've observed that iOS Safari doesn't emit `focusin`/`focusout` events when
        // a focused element is removed from the DOM. So we listen for
        // `selectionchange` events as well as a fallback which should fire before the
        // edit menu opens.
        document.addEventListener("selectionchange", handleFocusChange);

        const unsubscribe = NativeMobileBridge.editMenu.subscribeToAddCommentAction(() => {
            editor.openMobileKeyboardToolbarCommentInputIfPossible();
        });

        handleFocusChange();

        return () => {
            if (lastIsAddCommentEditMenuOptionVisible) {
                NativeMobileBridge!.editMenu.disableAddCommentAction();
            }

            unsubscribe();

            document.removeEventListener("focusin", handleFocusChange);
            document.removeEventListener("focusout", handleFocusChange);
            document.removeEventListener("selectionchange", handleFocusChange);
        };
    }, [isInert, isInitialAppRender]);

    // Hide the tab bar when the sidebar is open. Sidebar is render as a bottom
    // sheet on mobile.
    const hasDisabledNativeMobileTabBarRef = useRef(false);
    useLayoutEffectWithoutServerSideWarning(() => {
        if (!NativeMobileBridge) return;

        if (isInertNativeMobileRoute || !withMobileLayout || !sidebarState.isOpen) {
            if (hasDisabledNativeMobileTabBarRef.current) {
                hasDisabledNativeMobileTabBarRef.current = false;
                NativeMobileBridge.tabBar.unhide({isAnimated: true});
            }
            return;
        }

        if (!hasDisabledNativeMobileTabBarRef.current) {
            hasDisabledNativeMobileTabBarRef.current = true;
            NativeMobileBridge.tabBar.hide({isAnimated: false});
        }

        return () => {
            // If the component unmounts, we need to enable the tab bar.
            if (!isMounted()) {
                if (hasDisabledNativeMobileTabBarRef.current) {
                    hasDisabledNativeMobileTabBarRef.current = false;
                    NativeMobileBridge!.tabBar.unhide({isAnimated: true});
                }
            }
        };
    }, [isInertNativeMobileRoute, isMounted, sidebarState.isOpen, withMobileLayout]);

    /* ========================================================================== *\
     *                               Navigation Bar                               *
    \* ========================================================================== */

    const contextMenuActions: Array<Array<MenuAction>> = [
        [
            {
                label: "Undo",
                isDisabled: editorState.undoDepth() === 0,
                keyboardShortcutHint: isAppleDevice ? "⌘+Z" : "Ctrl+Z",
                onPress: () => assertExists(editorRef.current).dispatchCommand(undo),
            },
            {
                label: "Redo",
                isDisabled: editorState.redoDepth() === 0,
                keyboardShortcutHint: isAppleDevice ? "⌘+Y" : "Ctrl+Y",
                onPress: () => assertExists(editorRef.current).dispatchCommand(redo),
            },
        ],
    ];

    const navigationBarRef = useRef<NavigationBarRef>(null);
    const titleBoundaryRef = useRef<HTMLElement | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Don't query for the title element on initial render. We'll get the title
        // element from a read-only `<ContentView>` instead of the element rendered by
        // ProseMirror.
        if (isInitialAppRender) return;

        const editorContainerElement = assertExists(editorContainerRef.current);

        const titleBoundaryElement = assertExists(
            editorContainerElement.querySelector(`.${contentSchemaStyles.titleClassName}`),
        );
        assert(titleBoundaryElement instanceof HTMLElement);

        titleBoundaryRef.current = titleBoundaryElement;
        return () => {
            titleBoundaryRef.current = null;
        };
    }, [isInitialAppRender]);

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        ref: navigationBarRef,
        withMobileLayout,
        title: getDocumentContentTitle(content.doc),
        titleBoundaryRef,
        menuActions: [
            [
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy document link",
                    onPress: async () => {
                        // When the user goes to copy the link for a document, make sure the document
                        // has been created before copying. Otherwise the other user won't see realtime
                        // updates to the document.
                        await ensureCreateDocument();

                        const url = new URL(
                            `/s/${spaceId}/documents/${documentId}`,
                            window.location.href,
                        );
                        await writeTextToClipboard(url.toString());
                    },
                },
            ],
            ...contextMenuActions,
        ],
        shareButton: {},
        desktopTitleMaxWidth: addRemLengths(
            spacing[screenPaddingXWithoutBlockPaddingX[isMobile ? "mobile" : "desktop"]],
            contentSchemaStyles.defaultBlockMaxWidth,
            spacing[screenPaddingXWithoutBlockPaddingX[isMobile ? "mobile" : "desktop"]],
        ),
        desktopTitleFontSize: "400",
        desktopTitleFontWeight: "bold",
    });

    return (
        <ContextMenuActions actions={contextMenuActions}>
            <Box
                ref={containerResizeRef}
                flexGrow="1"
                position="relative"
                zIndex="0"
                overflow="hidden"
                display="flex"
                flexDirection="column"
                backgroundColor="grey-0"
            >
                <Box
                    ref={useMergedRefs<HTMLDivElement>(
                        editorContainerRef,
                        useScrollbar({insetTop: scrollbarInsetTop}),
                        scrollViewRef,
                    )}
                    id={editorContainerId}
                    data-testid="DocumentContentEditorMain"
                    flexGrow="1"
                    position="relative"
                    zIndex="0"
                    overflowX="hidden"
                    overflowY="auto"
                    style={{
                        width:
                            !withMobileLayout &&
                            sidebarState.isOpen &&
                            sidebarState.animationState !== "Closing"
                                ? `calc(100% - ${documentContentEditorSidebarWidth})`
                                : "100%",
                    }}
                >
                    <OverlayScopeContextProvider>
                        <Box position="relative" className={contentEditorStyles.containerClassName}>
                            <ContentEditor
                                ref={editorRef}
                                state={editorState}
                                onChange={(state, transaction) => {
                                    onChangeEditorState(state);

                                    const createCommentThread: {
                                        commentThreadId: DocumentCommentThreadId;
                                        initialCommentContent: MessageContentWithReferences;
                                        openCommentThreadPromiseRef?: {
                                            current: Promise<void> | null;
                                        };
                                    } | null =
                                        transaction.getMeta(createCommentThreadMetaKey) ?? null;

                                    if (
                                        createCommentThread &&
                                        createCommentThread.openCommentThreadPromiseRef &&
                                        sidebarState.isOpen &&
                                        sidebarState.animationState !== "Closing"
                                    ) {
                                        // `<ContentEditorCommentInput>` will wait on this promise before closing after
                                        // creating a comment thread when it exists. If the sidebar is not already open
                                        // then we rely on our document's global loading indicator to tell us when
                                        // comments have successfully saved.
                                        createCommentThread.openCommentThreadPromiseRef.current =
                                            openCommentThread(createCommentThread.commentThreadId);
                                    }

                                    if (transaction.docChanged) {
                                        onContentLocalChange?.();
                                    }
                                }}
                                aria-label="Document"
                                placeholder="Share your ideas…"
                                withMobileLayout={withMobileLayout}
                                // While the sidebar is open, don't render our document toolbar. It would be
                                // weird for it to pop up when writing a comment.
                                withoutMobileKeyboardToolbar={sidebarState.isOpen}
                                className={documentContentClassName}
                                phantomSelections={phantomSelections}
                                openCommentThread={openCommentThread}
                                onCommentThreadPressedChange={(commentThreadId, isHovered) => {
                                    setPressedCommentThreadId(pressedCommentThreadId => {
                                        if (isHovered) return commentThreadId;
                                        if (
                                            !isHovered &&
                                            pressedCommentThreadId === commentThreadId
                                        )
                                            return null;
                                        return pressedCommentThreadId;
                                    });
                                }}
                            />
                            {
                                // IMPORTANT: It's important that this element is below `<ContentEditor>` so
                                // that `<ContentEditor>` is first in the tab order! This matters when
                                // auto-focusing a document peek when we open it up.
                                navigationBar
                            }
                            {useMemo(
                                // Memoize side decorations since it can be an expensive component
                                // to re-render. Especially during animations.
                                () =>
                                    !isMobile && (
                                        <DocumentContentEditorSideDecorations
                                            editorContainerWidth={editorContainerWidth}
                                            contentReferences={content.references}
                                            decorations={decorations}
                                            openCommentThread={openCommentThread}
                                        />
                                    ),
                                [
                                    content.references,
                                    decorations,
                                    editorContainerWidth,
                                    isMobile,
                                    openCommentThread,
                                ],
                            )}
                        </Box>
                    </OverlayScopeContextProvider>
                </Box>
                {sidebarState.isOpen && (
                    <>
                        {withMobileLayout && (
                            <Box
                                // While the mobile comment thread overlay is open render a cover to prevent
                                // the user from interacting with the underlying document. Tapping the cover
                                // will close the comment thread.
                                position="absolute"
                                zIndex="10"
                                inset="0"
                                onPointerDown={onSidebarClose}
                            />
                        )}
                        <Box
                            position="absolute"
                            zIndex="20"
                            top={!withMobileLayout ? "0" : undefined}
                            right={!withMobileLayout ? "-4" : "0"}
                            left={!withMobileLayout ? undefined : "0"}
                            paddingRight={!withMobileLayout ? "4" : undefined}
                            style={{
                                width: !withMobileLayout
                                    ? // The `spacing["4"]` is a bit of grace room at the end for a spring bounce.
                                      addRemLengths(documentContentEditorSidebarWidth, spacing["4"])
                                    : "100%",
                                // In the mobile layout (mobile devices and peeks) we show the comment thread
                                // in a bottom sheet. When the comment input is focused on mobile devices we
                                // then animate the sidebar to take the full screen space since the virtual
                                // keyboard will open and the user still needs to see comments. In peeks on
                                // desktop we don't expand to fullscreen because the user can type on their
                                // physical keyboard.
                                height: !withMobileLayout
                                    ? undefined
                                    : `calc(100% - (${
                                          isMobile
                                              ? spacing["1"]
                                              : spacing[documentContentEditorMobileSidebarInsetTop]
                                      } + var(--safe-area-inset-top, 0px)))`,
                                bottom: isMobile
                                    ? `-${spacing[documentContentEditorMobileSidebarInsetTop]}`
                                    : 0,
                            }}
                        >
                            <Box
                                ref={sidebarRef}
                                width="full"
                                height="full"
                                borderLeft={!withMobileLayout ? "grey-10" : undefined}
                                backgroundColor="grey-0"
                                borderTopRadius={!withMobileLayout ? undefined : "xl"}
                                boxShadow={
                                    !withMobileLayout ? undefined : "elevation-40-from-bottom"
                                }
                                overflow="hidden"
                                style={{
                                    // Let the browser know we'll be basically immediately animating in the sidebar
                                    // so it can prepare a compositing layer.
                                    willChange: "transform",
                                }}
                            >
                                <DocumentContentEditorSidebar
                                    pinnedCommentInputRef={pinnedCommentInputRef}
                                    documentId={documentId}
                                    content={content}
                                    isMobile={isMobile}
                                    withMobileLayout={withMobileLayout}
                                    mobileState={sidebarState.mobileState}
                                    onSidebarMobileFullScreenExpand={
                                        onSidebarMobileFullScreenExpand
                                    }
                                    onSidebarMobileFullScreenContract={
                                        onSidebarMobileFullScreenContract
                                    }
                                    commentThreadId={sidebarState.commentThreadId}
                                    onCommentThreadSnippetPress={handleCommentThreadSnippetPress}
                                    initialDataPromise={sidebarState.dataPromise}
                                    isConnected={isConnected}
                                    procedures={procedures}
                                    subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                    unpersistedResolutionStateByCommentThreadId={
                                        unpersistedResolutionStateByCommentThreadId
                                    }
                                    totalDecoratedCommentThreads={totalDecoratedCommentThreads}
                                    decorations={decorations}
                                    commentThreadListViewRef={commentThreadListViewRef}
                                    onClose={onSidebarClose}
                                    openCommentThread={openCommentThread}
                                />
                            </Box>
                        </Box>
                        {isMobile &&
                            (!sidebarState.mobileState.isFullScreen ||
                                sidebarState.mobileState.animationState !== null) && (
                                // On mobile while the comment thread is not fullscreen, we render a fake
                                // comment input that when touched expands the comment thread to take the full
                                // screen.
                                <>
                                    <Box
                                        ref={mobileFakeCommentInputRef}
                                        position="absolute"
                                        zIndex="30"
                                        left="0"
                                        right="0"
                                        bottom="0"
                                        backgroundColor="grey-0"
                                        style={{
                                            paddingBottom:
                                                "var(--window-safe-area-inset-bottom, 0px)",
                                        }}
                                        onPointerDown={event => {
                                            const editorElement = assertExists(
                                                mobileFakeCommentInputEditorRef.current,
                                            );

                                            if (
                                                event.target instanceof HTMLElement &&
                                                event.target !== editorElement &&
                                                !editorElement.contains(event.target)
                                            ) {
                                                onSidebarMobileFullScreenExpand();
                                            }
                                        }}
                                    >
                                        <Box
                                            padding="3"
                                            display="flex"
                                            gap="2"
                                            style={{height: messageInputMinHeight}}
                                        >
                                            <Box
                                                ref={mobileFakeCommentInputEditorRef}
                                                className={contentSchemaStyles.docClassName}
                                                flexGrow="1"
                                                borderRadius={messageViewBubbleBorderRadius}
                                                paddingX="1"
                                                paddingY="2"
                                                // If the user has a mouse, make this feel like a text input.
                                                cursor="text"
                                                style={{
                                                    minHeight: messageViewBubbleMinHeight,
                                                    boxShadow: `inset 0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                                                }}
                                                onPointerDown={() => {
                                                    onSidebarMobileFullScreenExpand({
                                                        onAnimationFinished: () => {
                                                            pinnedCommentInputRef.current?.focus();
                                                        },
                                                    });
                                                }}
                                            >
                                                <Box
                                                    className={
                                                        contentSchemaStyles.paragraphClassName
                                                    }
                                                    userSelect="none"
                                                    style={inputPlaceholderStyles}
                                                >
                                                    Add a comment
                                                </Box>
                                            </Box>
                                            <Box
                                                flexShrink="0"
                                                display="flex"
                                                alignItems="flex-end"
                                            >
                                                <Box
                                                    width={messageInputAccountAvatarSize}
                                                    style={{
                                                        paddingTop:
                                                            messageInputAccountAvatarPaddingY,
                                                        paddingBottom:
                                                            messageInputAccountAvatarPaddingY,
                                                    }}
                                                >
                                                    <Box
                                                        width={messageInputAccountAvatarSize}
                                                        height={messageInputAccountAvatarSize}
                                                        backgroundColor="grey-5"
                                                        color="grey-30"
                                                        borderRadius="full"
                                                        display="flex"
                                                        justifyContent="center"
                                                        alignItems="center"
                                                    >
                                                        <ArrowUp size={spacing["4"]} />
                                                    </Box>
                                                </Box>
                                            </Box>
                                        </Box>
                                    </Box>
                                    {isNativeMobile && !isInert && (
                                        // In our native mobile app, include an invisible bottom bar which only serves
                                        // to make sure the vertical scroll indicator insets are correct.
                                        <Box
                                            id={`nmbb-${editorContainerId}`}
                                            position="absolute"
                                            left="0"
                                            right="0"
                                            bottom="0"
                                            pointerEvents="none"
                                            style={{
                                                paddingBottom:
                                                    "var(--window-safe-area-inset-bottom, 0px)",
                                                // Our native mobile wrapper looks for compositing layers created from an
                                                // element with an ID that starts with `nmbb-` and ties their position to
                                                // the tab bar and software keyboard. So we get smooth animations while the
                                                // keyboard opens or the tab bar shifts offscreen. To create a compositing
                                                // layer we need to set `will-change: transform`. It's not specified that
                                                // `will-change: transform` MUST create a compositing layer, instead some
                                                // browser engines implement this hint themselves as an optimization.
                                                //
                                                // It so happens that WebKit is one of those browsers. Here's the code in
                                                // WebKit that does this: [part 1][1], [part 2][2].
                                                //
                                                // [1]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/RenderLayerCompositor.cpp#L2831
                                                // [2]: https://github.com/WebKit/WebKit/blob/b3b7144bd152111660f81e9aecb76b0a4a8642ab/Source/WebCore/rendering/style/WillChangeData.cpp#L158
                                                willChange: "transform",
                                            }}
                                            // Suppress React hydration warnings in our native mobile app. The native
                                            // mobile app sets the `transform` property on this element. Sometimes before
                                            // React finishes hydrating. This is expected, React can ignore the difference.
                                            suppressHydrationWarning={true}
                                        >
                                            <Box style={{height: messageInputMinHeight}} />
                                        </Box>
                                    )}
                                </>
                            )}
                    </>
                )}
                {mobileDiscardSidebarCommentInputModalState && (
                    <ModalDialog
                        title="Discard comment?"
                        description="Continuing will discard your comment. Use the send button to save your comment."
                        primaryButtonLabel="Discard"
                        onClose={() => setMobileDiscardSidebarCommentInputModalState(null)}
                        onPrimaryButtonPress={() => {
                            pinnedCommentInputRef.current?.clear();
                            mobileDiscardSidebarCommentInputModalState.onDiscard();
                        }}
                    />
                )}
                {useMemo(
                    // We style hovered and active comments with a `<style>` element containing
                    // CSS with a dynamic selector that changes when our state changes. We do this
                    // for two reasons:
                    //
                    // 1. All marks for a `DocumentCommentThreadId` should light up when we hover
                    //    even if they are different elements in the DOM
                    // 2. Changing DOM properties (e.g. `class`) of comment elements triggers
                    //    ProseMirror's mutation observer and since the observer doesn't know why
                    //    the change happened it destroys and recreates the mark elements
                    () =>
                        activeCommentThreadId && (
                            <style
                                key={activeCommentThreadId}
                                dangerouslySetInnerHTML={{
                                    __html: contentSchemaStyles.commentActiveDynamicCssTemplate
                                        .replaceAll(
                                            "$containerId",
                                            editorContainerId.replaceAll(":", "\\:"),
                                        )
                                        .replaceAll("$commentThreadId", activeCommentThreadId),
                                }}
                            />
                        ),
                    [activeCommentThreadId, editorContainerId],
                )}
            </Box>
        </ContextMenuActions>
    );
}

const collectDecorationByMarkTop = createProsemirrorIncrementalReducer<{
    editorContainerElement: HTMLElement;
    editorContainerRect: DOMRect;
    editor: ContentEditorRef<DocumentContentWithReferences>;
    seenCommentThreadIds: Set<DocumentCommentThreadId>;
    decorationByMarkTop: Map<
        number,
        {markHeight: number; commentThreadIds: Set<DocumentCommentThreadId>}
    >;
}>(node => {
    const commentThreadIds = filterMapArray(node.marks, mark => {
        if (mark.type.name !== "comment") return null;
        return assertId<DocumentCommentThreadId>(mark.attrs.commentThreadId);
    });

    if (commentThreadIds.length === 0) return null;

    return (state, doc, offset) => {
        const coords = state.editor.coordsAtPos(offset);
        const markTop =
            coords.top - state.editorContainerRect.top + state.editorContainerElement.scrollTop;

        const markHeight = coords.bottom - coords.top;

        for (const commentThreadId of commentThreadIds) {
            if (state.seenCommentThreadIds.has(commentThreadId)) continue;

            const decoration = getOrSetDefaultMapValue(state.decorationByMarkTop, markTop, () => ({
                markHeight,
                commentThreadIds: new Set<DocumentCommentThreadId>(),
            }));

            state.seenCommentThreadIds.add(commentThreadId);
            decoration.commentThreadIds.add(commentThreadId);
        }

        return state;
    };
});

function DocumentContentEditorSidebar({
    pinnedCommentInputRef,
    documentId,
    content,
    isMobile,
    withMobileLayout,
    mobileState,
    onSidebarMobileFullScreenExpand,
    onSidebarMobileFullScreenContract,
    commentThreadId,
    onCommentThreadSnippetPress,
    initialDataPromise,
    isConnected,
    procedures,
    subscribeToCommentThreadEvents,
    unpersistedResolutionStateByCommentThreadId,
    totalDecoratedCommentThreads,
    decorations,
    commentThreadListViewRef,
    onClose,
    openCommentThread,
}: {
    pinnedCommentInputRef: RefObject<MessageInputRef>;
    documentId: DocumentId;
    content: DocumentContentWithReferences;
    isMobile: boolean;
    withMobileLayout: boolean;
    mobileState: DocumentContentEditorSidebarMobileState;
    onSidebarMobileFullScreenExpand: Memo<(options?: {onAnimationFinished?: () => void}) => void>;
    onSidebarMobileFullScreenContract: Memo<() => void>;
    commentThreadId: DocumentCommentThreadId;
    onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;
    initialDataPromise: PromiseImmediate<DocumentContentEditorSidebarData | null>;
    isConnected: boolean;
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    unpersistedResolutionStateByCommentThreadId: ReadonlyMap<
        DocumentCommentThreadId,
        {readonly isResolved: boolean; readonly version: number}
    >;
    totalDecoratedCommentThreads: number;
    decorations: ReadonlyArray<DocumentContentEditorSideDecoration>;
    commentThreadListViewRef: Ref<DocumentCommentThreadListViewRef>;
    onClose: Memo<() => void>;
    openCommentThread: Memo<(commentThreadId: DocumentCommentThreadId) => Promise<void>>;
}) {
    const reporter = useReporter();
    const {isAppleDevice, isNativeMobile} = useClientInfo();

    const previousCommentThreadButtonRef = useRef<HTMLElement & {press(): void}>(null);
    const nextCommentThreadButtonRef = useRef<HTMLElement & {press(): void}>(null);

    const initialDataResult = usePromise(initialDataPromise);

    // If the comment thread finishes loading but there's no data then close the
    // comment thread.
    const initialDataResultRef = useRef<typeof initialDataResult | null>(null);
    useEffect(() => {
        if (initialDataResultRef.current === initialDataResult) return;
        initialDataResultRef.current = initialDataResult;

        if (!initialDataResult.isPending && !initialDataResult.value) {
            reporter.logErrorWithoutDisplaying(
                "Selected document comment thread couldn't be opened",
                new InternalError("Couldn't find document comment thread"),
            );

            onClose();
        }
    }, [initialDataResult, onClose, reporter]);

    const currentAdjacentCommentThreads = useMemo(() => {
        let decoratedCommentThreadIndex = 0;
        let previousCommentThreadId: DocumentCommentThreadId | null = null;
        let hasFoundCommentThread = false;

        for (const decoration of decorations) {
            for (const otherCommentThreadId of decoration.commentThreadIds) {
                if (hasFoundCommentThread) {
                    return {
                        hasFoundCommentThread,
                        decoratedCommentThreadIndex: decoratedCommentThreadIndex - 1,
                        totalDecoratedCommentThreads,
                        previousCommentThreadId,
                        nextCommentThreadId: otherCommentThreadId,
                    };
                } else if (otherCommentThreadId === commentThreadId) {
                    hasFoundCommentThread = true;
                } else {
                    previousCommentThreadId = otherCommentThreadId;
                }

                decoratedCommentThreadIndex++;
            }
        }

        return {
            hasFoundCommentThread,
            decoratedCommentThreadIndex: hasFoundCommentThread
                ? decoratedCommentThreadIndex - 1
                : null,
            totalDecoratedCommentThreads,
            previousCommentThreadId,
            nextCommentThreadId: null,
        };
    }, [commentThreadId, decorations, totalDecoratedCommentThreads]);

    // If we had previous/next comment threads and then the comment was removed
    // from the document (e.g. comment thread was resolved) then we want to keep
    // the last previous/next comment threads we've seen. This way a user can go
    // through comments in a document, resolving them one by one without losing
    // their place after resolving.
    const [originalAdjacentCommentThreads, setAdjacentCommentThreads] = useState(
        currentAdjacentCommentThreads,
    );
    let adjacentCommentThreads = originalAdjacentCommentThreads;
    if (
        currentAdjacentCommentThreads !== adjacentCommentThreads &&
        currentAdjacentCommentThreads.hasFoundCommentThread
    ) {
        setAdjacentCommentThreads(currentAdjacentCommentThreads);
        adjacentCommentThreads = currentAdjacentCommentThreads;
    }

    const {
        decoratedCommentThreadIndex,
        totalDecoratedCommentThreads: lastTotalDecoratedCommentThreads,
        previousCommentThreadId,
        nextCommentThreadId,
    } = adjacentCommentThreads;

    const header = (
        <Box
            flexShrink="0"
            height={isMobile ? "9" : "8"}
            display="flex"
            alignItems="center"
            backgroundColor="grey-0"
        >
            {withMobileLayout && (
                <>
                    {!mobileState.isFullScreen || mobileState.animationState === "Contracting" ? (
                        <Spacer space={isMobile ? "9" : "7"} />
                    ) : (
                        <Box flexShrink="0" paddingX="1.5" width={isMobile ? "9" : "7"}>
                            <IconButton
                                size={isMobile ? "md" : "xs"}
                                description="Go back"
                                withoutTooltip={true}
                                onPress={onSidebarMobileFullScreenContract}
                            >
                                <ArrowLeft />
                            </IconButton>
                        </Box>
                    )}
                    <Box flexGrow="1" height="full" />
                </>
            )}
            {(!mobileState.isFullScreen || mobileState.animationState === "Contracting") && (
                <Box flexShrink="0" paddingX="1.5" display="flex" alignItems="center" gap="1">
                    <IconButton
                        ref={previousCommentThreadButtonRef}
                        size={isMobile ? "md" : "xs"}
                        description="Previous thread"
                        keyboardShortcutHint={isAppleDevice ? "⌘+Shift+," : "Ctrl+Shift+,"}
                        isDisabled={!previousCommentThreadId}
                        pressErrorTitle="Can’t go to previous thread"
                        onPress={async () => {
                            if (!previousCommentThreadId) return;
                            await openCommentThread(previousCommentThreadId);
                        }}
                    >
                        {!withMobileLayout ? <CaretUp /> : <CaretLeft />}
                    </IconButton>
                    {withMobileLayout && (
                        <Box
                            paddingX={isMobile ? "1.5" : "1"}
                            color="grey-70"
                            textAlign="center"
                            style={{fontVariantNumeric: "tabular-nums"}}
                        >
                            {decoratedCommentThreadIndex !== null && (
                                <>
                                    {decoratedCommentThreadIndex + 1} of{" "}
                                    {lastTotalDecoratedCommentThreads}
                                </>
                            )}
                        </Box>
                    )}
                    <IconButton
                        ref={nextCommentThreadButtonRef}
                        size={isMobile ? "md" : "xs"}
                        description="Next thread"
                        keyboardShortcutHint={isAppleDevice ? "⌘+Shift+." : "Ctrl+Shift+."}
                        isDisabled={!nextCommentThreadId}
                        pressErrorTitle="Can’t go to next thread"
                        onPress={async () => {
                            if (!nextCommentThreadId) return;
                            await openCommentThread(nextCommentThreadId);
                        }}
                    >
                        {!withMobileLayout ? <CaretDown /> : <CaretRight />}
                    </IconButton>
                    {!withMobileLayout && decoratedCommentThreadIndex !== null && (
                        <Box
                            paddingX="1.5"
                            color="grey-70"
                            style={{fontVariantNumeric: "tabular-nums"}}
                        >
                            {decoratedCommentThreadIndex + 1} of {lastTotalDecoratedCommentThreads}
                        </Box>
                    )}
                </Box>
            )}
            <Box flexGrow="1" height="full" />
            <Box flexShrink="0" paddingX="1.5" width={isMobile ? "9" : "7"}>
                <IconButton
                    size={isMobile ? "md" : "xs"}
                    description="Close"
                    keyboardShortcutHint="esc"
                    onPress={onClose}
                >
                    <X />
                </IconButton>
            </Box>
        </Box>
    );

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    onClose();
                }

                if (
                    event.key === "," &&
                    event.shiftKey &&
                    (isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(previousCommentThreadButtonRef.current).press();
                }

                if (
                    event.key === "." &&
                    event.shiftKey &&
                    (isAppleDevice ? event.metaKey : event.ctrlKey)
                ) {
                    event.preventDefault();
                    event.stopPropagation();

                    // Programmatically click the button instead of calling `openCommentThread()`
                    // directly to correctly handle loading and error states.
                    assertExists(nextCommentThreadButtonRef.current).press();
                }
            }}
        >
            <Box height="full" width="full" overflow="hidden" display="flex" flexDirection="column">
                {header}
                {useMemo(
                    () =>
                        // TODO(calebmer): Ideally this would render shimmers instead of a loading
                        // spinner.
                        initialDataResult.isPending || !initialDataResult.value ? (
                            <Box
                                flexGrow="1"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
                                style={{
                                    paddingBottom: addRemLengths(
                                        messageInputMinHeight,
                                        isMobile &&
                                            (!mobileState.isFullScreen ||
                                                mobileState.animationState === "Expanding")
                                            ? spacing[documentContentEditorMobileSidebarInsetTop]
                                            : "0rem",
                                    ),
                                }}
                            >
                                <SpinnerGap
                                    className={spinAnimationClassName}
                                    color={colorSchemeVars["grey-70"]}
                                    size={spacing["6"]}
                                />
                            </Box>
                        ) : (
                            <DocumentCommentThreadListView
                                key={commentThreadId}
                                ref={commentThreadListViewRef}
                                withMobileLayout={withMobileLayout}
                                documentId={documentId}
                                content={content}
                                onCommentThreadSnippetPress={onCommentThreadSnippetPress}
                                initialCommentThreadResults={[
                                    {
                                        commentThread: initialDataResult.value.commentThread,
                                        comments: initialDataResult.value.initialComments,
                                        otherReferencedComments:
                                            initialDataResult.value.initialOtherReferencedComments,
                                        optimisticComments:
                                            initialDataResult.value.initialOptimisticComments,
                                    },
                                ]}
                                isConnected={isConnected}
                                procedures={procedures}
                                subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                                unpersistedResolutionStateByCommentThreadId={
                                    unpersistedResolutionStateByCommentThreadId
                                }
                                withoutCommentThreadPreview={withMobileLayout}
                                // When we render the comment input in a bottom sheet on desktop we need the
                                // comment input to have a smaller max height so it doesn't completely fill the
                                // bottom sheet.
                                withCommentInputMobileMaxHeight={withMobileLayout}
                                // Slightly reduce the amount of margin on messages in a desktop comment thread
                                // because we have less space in the sidebar.
                                paddingX={!withMobileLayout ? "4" : undefined}
                                pinnedCommentInputRef={pinnedCommentInputRef}
                                // We disable the tab bar while a comment thread is open to get more vertical
                                // space. This changes how our component should handle safe area insets.
                                isNativeMobileTabBarHidden={isNativeMobile && withMobileLayout}
                                // When on mobile, add some background slop so we can easily animate our
                                // comment thread list view to the full screen size.
                                backgroundSlopBottomIfPinnedCommentInput={
                                    isMobile &&
                                    (!mobileState.isFullScreen ||
                                        mobileState.animationState === "Expanding")
                                        ? spacing[documentContentEditorMobileSidebarInsetTop]
                                        : undefined
                                }
                                // If we're focusing the pinned comment input because the user swiped to reply
                                // to a comment then we first need to make sure our sidebar is full screen,
                                // then we can focus the input after that animation finishes.
                                onBeforePinnedCommentInputFocusFromReplyOrEditingChange={() => {
                                    if (mobileState.isFullScreen) return;

                                    onSidebarMobileFullScreenExpand({
                                        onAnimationFinished: () => {
                                            pinnedCommentInputRef.current?.focus();
                                        },
                                    });

                                    return {preventDefault: true};
                                }}
                            />
                        ),
                    [
                        commentThreadId,
                        commentThreadListViewRef,
                        content,
                        documentId,
                        initialDataResult.isPending,
                        initialDataResult.value,
                        isConnected,
                        isMobile,
                        isNativeMobile,
                        mobileState,
                        onCommentThreadSnippetPress,
                        onSidebarMobileFullScreenExpand,
                        pinnedCommentInputRef,
                        procedures,
                        subscribeToCommentThreadEvents,
                        unpersistedResolutionStateByCommentThreadId,
                        withMobileLayout,
                    ],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}
