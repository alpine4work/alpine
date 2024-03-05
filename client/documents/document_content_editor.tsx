import {AnimationControls, spring, timeline} from "motion";
import {CaretDown, CaretUp, SpinnerGap, X} from "phosphor-react";
import {redo, undo} from "prosemirror-history";
import {Memo, Ref, useCallback, useEffect, useId, useMemo, useRef, useState} from "react";
import {useIsInertNativeMobileRoute} from "~/app/router/native_mobile_outlet.js";
import {ContentEditor, ContentEditorRef} from "~/client/content/content_editor.js";
import {createCommentThreadMetaKey} from "~/client/content/content_editor_state.js";
import {Box} from "~/client/design/box.js";
import {ContextMenuActions} from "~/client/design/context_menu.js";
import {getRemPxWithoutListening, useRemPx} from "~/client/design/helpers/use_rem_px.js";
import {IconButton} from "~/client/design/icon_button.js";
import {MenuAction} from "~/client/design/menu_button.js";
import {useNavigationBar} from "~/client/design/navigation_bar.js";
import {OverlayScopeContextProvider} from "~/client/design/overlay.js";
import {getElementSafeAreaInsetTopPx} from "~/client/design/safe_area_inset.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {delayScreenTransitionLoadingIndicatorLimitMs} from "~/client/design/timing_constants.js";
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
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/use_is_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useLifecycleRef} from "~/client/helpers/refs/use_lifecycle_ref.js";
import {useMergedRefs} from "~/client/helpers/refs/use_merged_refs.js";
import {MemoObject} from "~/client/helpers/types/memo_object.js";
import {usePromise} from "~/client/helpers/use_promise.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {writeTextToClipboard} from "~/client/helpers/write_text_to_clipboard.js";
import {getInitialLoadMessageCount} from "~/client/messaging/messaging_view.js";
import {getClientInfoWithoutListening, useClientInfo} from "~/client/remix/client_info_context.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {subscribeToMobileKeyboardFrameChange} from "~/client/remix/subscribe_to_mobile_keyboard_frame_change.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    parseRemLengthNumber,
    spacing,
} from "~/shared/design/spacing.js";
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
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {PromiseImmediate} from "~/shared/helpers/async/promise_immediate.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleAfterNextBrowserPaint} from "~/shared/helpers/async/schedule_after_next_browser_paint.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {assertId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId} from "~/shared/id/types/id_types.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {createProsemirrorIncrementalReducer} from "~/shared/prosemirror/prosemirror_incremental_reducer.js";
import {
    colorSchemeVars,
    contentEditorStyles,
    contentSchemaStyles,
    documentContentStyles,
    spinAnimationClassName,
} from "~/shared/styles/styles.js";

export const documentContentEditorSidebarWidth = spacing["96"];

const {desktopDocumentPaddingX, documentContentClassName, mobileDocumentPaddingX} =
    documentContentStyles;

export function DocumentContentEditor({
    withMobileLayout,
    initialDocument,
    initialCommentThreadResult,
    initialScrollToCommentIndex,
    onContentChange,
    onContentLocalChange,
    onCommentThreadChange,
}: {
    withMobileLayout: boolean;
    initialDocument: DocumentModel;
    initialCommentThreadResult: {
        commentThread: DocumentCommentThreadModel;
        initialComments: ReadonlyArray<DocumentCommentModel>;
        initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    } | null;
    initialScrollToCommentIndex: number | null;
    onContentChange?: (content: DocumentContent) => void;
    onContentLocalChange?: () => void;
    onCommentThreadChange?: (commentThreadId: DocumentCommentThreadId | null) => void;
}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different id + version is passed in then remount
            // our stateful content editor component.
            key={`${initialDocument.id}-${initialDocument.version}`}
            withMobileLayout={withMobileLayout}
            initialDocument={initialDocument}
            initialCommentThreadResult={initialCommentThreadResult}
            initialScrollToCommentIndex={initialScrollToCommentIndex}
            onContentChange={onContentChange}
            onContentLocalChange={onContentLocalChange}
            onCommentThreadChange={onCommentThreadChange}
        />
    );
}

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
          readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData>;
      };

type DocumentContentEditorSidebarTransition = {
    readonly commentThreadId: DocumentCommentThreadId;
    readonly dataPromise: PromiseImmediate<DocumentContentEditorSidebarData>;
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

function DocumentContentEditorStateful({
    withMobileLayout,
    initialDocument,
    initialCommentThreadResult,
    initialScrollToCommentIndex,
    onContentChange,
    onContentLocalChange,
    onCommentThreadChange,
}: {
    withMobileLayout: boolean;
    initialDocument: DocumentModel;
    initialCommentThreadResult: {
        commentThread: DocumentCommentThreadModel;
        initialComments: ReadonlyArray<DocumentCommentModel>;
        initialOtherReferencedComments: ReadonlyArray<DocumentCommentModel>;
    } | null;
    initialScrollToCommentIndex: number | null;
    onContentChange?: (content: DocumentContent) => void;
    onContentLocalChange?: () => void;
    onCommentThreadChange?: (commentThreadId: DocumentCommentThreadId | null) => void;
}) {
    const {id: documentId, spaceId} = initialDocument;

    const isInitialAppRender = useIsInitialAppRender();
    const {isAppleDevice} = useClientInfo();
    const isMobile = useIsMobile();
    const editorRef = useRef<ContentEditorRef<DocumentContentWithReferences>>(null);
    const editorContainerRef = useRef<HTMLDivElement>(null);
    const sidebarRef = useRef<HTMLDivElement>(null);
    const commentThreadListViewRef = useRef<DocumentCommentThreadListViewRef>(null);
    const editorContainerId = useId();
    const [containerResizeRef, containerSize] = useResizeObserver();

    const paddingX = isMobile ? mobileDocumentPaddingX : desktopDocumentPaddingX;

    const {
        isConnected,
        editorState,
        onChangeEditorState,
        otherPresenceStateByConnectionId,
        rememberedSteps,
        toggleShouldConnect,
        procedures,
        subscribeToCommentThreadEvents,
    } = useDocumentContentEditorWebSocket(initialDocument);

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

    /* ========================================================================== *\
     *                            Sidebar animations                              *
    \* ========================================================================== */

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
        };
    });

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
        const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);
        const paddingXPx = convertRemLengthToPx(spacing[paddingX], remPx) * 2;
        const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
        const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

        const oldContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingXPx + sidebarWidth - blockMaxWidth) / 2,
        );
        const newContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingXPx - blockMaxWidth) / 2,
        );

        const animation = timeline(
            [
                [sidebarElement, {x: [sidebarWidth + sidebarOffscreenBufferWidth, 0]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 300,
                        damping: 31,
                    }),
                },
                delay: 0.002,
            },
        );

        // Wait for React to finish rendering before playing our animation. We need to
        // start our animation in a layout effect to apply the initial transform in the
        // right paint, but React may need to re-render again before releasing control
        // to the browser. So wait for React to finish rendering before starting our
        // animation.
        animation.pause();
        scheduleAfterNextBrowserPaint(() => {
            animation.play();
        });

        animation.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Opening")
                    return sidebarState;

                return {...sidebarState, animationState: null};
            });
        });

        sidebarAnimationInRef.current = animation;
    }, [paddingX, sidebarState]);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (!(sidebarState.isOpen && sidebarState.animationState === "Closing")) {
            sidebarAnimationOutRef.current?.cancel();
            sidebarAnimationOutRef.current = null;
            return;
        }

        // Already animating in...
        if (sidebarAnimationOutRef.current) return;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const sidebarElement = assertExists(sidebarRef.current);

        const remPx = getRemPxWithoutListening();
        const blockMaxWidth = convertRemLengthToPx(contentSchemaStyles.blockMaxWidth, remPx);
        const paddingXPx = convertRemLengthToPx(spacing[paddingX], remPx) * 2;
        const sidebarWidth = convertRemLengthToPx(documentContentEditorSidebarWidth, remPx);
        const sidebarOffscreenBufferWidth = convertRemLengthToPx(spacing["10"], remPx);

        const oldContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingXPx - sidebarWidth - blockMaxWidth) / 2,
        );
        const newContentOffset = Math.max(
            0,
            (editorContainerElement.clientWidth - paddingXPx - blockMaxWidth) / 2,
        );

        const animation = timeline(
            [
                [sidebarElement, {x: [0, sidebarWidth + sidebarOffscreenBufferWidth]}],
                [editorContainerElement, {x: [oldContentOffset - newContentOffset, 0]}, {at: 0}],
            ],
            {
                defaultOptions: {
                    easing: spring({
                        stiffness: 420,
                        damping: 35,
                    }),
                },
            },
        );

        // Wait for React to finish rendering before playing our animation. We need to
        // start our animation in a layout effect to apply the initial transform in the
        // right paint, but React may need to re-render again before releasing control
        // to the browser. So wait for React to finish rendering before starting our
        // animation.
        animation.pause();
        scheduleAfterNextBrowserPaint(() => {
            animation.play();
        });

        animation.finished.finally(() => {
            setSidebarState(sidebarState => {
                if (!sidebarState.isOpen || sidebarState.animationState !== "Closing")
                    return sidebarState;

                return {isOpen: false, transition: null};
            });
        });

        sidebarAnimationOutRef.current = animation;
    }, [paddingX, sidebarState]);

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

    // eslint-disable-next-line @typescript-eslint/no-misused-promises
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
            .getCommentThreadAndInitialComments({
                commentThreadId,
                limit: getInitialLoadMessageCount(getClientInfoWithoutListening()),
            })
            .then(
                (data): DocumentContentEditorSidebarData => ({
                    ...data,
                    initialOptimisticComments: [],
                }),
            );

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
                    };
                } else {
                    return {
                        isOpen: true,
                        animationState: sidebarState.animationState,
                        transition: null,
                        commentThreadId: transition.commentThreadId,
                        dataPromise: transition.dataPromise,
                    };
                }
            });
        };

        // Accept the transition with whatever comes first:
        //
        // - Our data promise resolves
        // - Our loading indicator delay finishes
        transition.dataPromise.then(acceptTransition, acceptTransition);
        const timeout = createTimeout(
            acceptTransition,
            delayScreenTransitionLoadingIndicatorLimitMs,
        );

        return () => {
            isCancelled = true;
            timeout.clear();
            transition.pendingPromiseResolver.resolve();
        };
    }, [sidebarState.transition]);

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

        // We don't show side decorations on mobile.
        if (isMobile) return;

        // Recompute our decorations whenever the editor width changes.
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        editorContainerWidth;

        const editorContainerElement = assertExists(editorContainerRef.current);
        const editor = assertExists(editorRef.current);

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

    const decorations = useMemo(
        () =>
            Array.from(decorationByMarkTop, ([markTop, decoration]) => ({
                markTop,
                markHeight: decoration.markHeight,
                commentThreadIds: decoration.commentThreadIds,
            })).sort((a, b) => a.markTop - b.markTop),
        [decorationByMarkTop],
    );

    /* ========================================================================== *\
     *                       Initial render comment scroll                        *
    \* ========================================================================== */

    {
        const hasInitializedRef = useRef(false);

        // TODO(calebmer): Support server-side rendering for immediately jumping to a
        // comment in the middle of a post. This will make transitions seamless when
        // you click on a link to a comment.
        useEffect(() => {
            if (hasInitializedRef.current) return;
            hasInitializedRef.current = true;

            if (initialCommentThreadResult && initialScrollToCommentIndex !== null) {
                commentThreadListViewRef.current?.jumpToCommentIndex(
                    initialCommentThreadResult.commentThread.id,
                    initialScrollToCommentIndex,
                );
            }
        }, [initialCommentThreadResult, initialScrollToCommentIndex]);
    }

    /* ========================================================================== *\
     *                       Scroll to comment in document                        *
    \* ========================================================================== */

    const scrollToEditorRect = useEvent((rect: DOMRect) => {
        const editorContainerElement = assertExists(editorContainerRef.current);
        const editorContainerRect = editorContainerElement.getBoundingClientRect();

        const commentMarkTop =
            editorContainerElement.scrollTop + rect.top - editorContainerRect.top;
        const commentMarkBottom =
            editorContainerElement.scrollTop + rect.bottom - editorContainerRect.top;

        // Try scrolling the element 20% from the top of the screen...
        const candidateScrollTop1 = clamp(
            0,
            commentMarkTop - editorContainerRect.height / 5,
            editorContainerElement.scrollHeight - editorContainerRect.height,
        );

        // Try scrolling the element 20% from the bottom of the screen...
        const candidateScrollTop2 = clamp(
            0,
            commentMarkBottom + editorContainerRect.height / 5 - editorContainerRect.height,
            editorContainerElement.scrollHeight - editorContainerRect.height,
        );

        const candidateScrollTop1Distance = Math.abs(
            candidateScrollTop1 - editorContainerElement.scrollTop,
        );
        const candidateScrollTop2Distance = Math.abs(
            candidateScrollTop2 - editorContainerElement.scrollTop,
        );

        // Pick the scroll offset that moves our window the least. That way there are
        // no big disorienting jumps.
        if (candidateScrollTop2Distance < candidateScrollTop1Distance) {
            editorContainerElement.scrollTop = candidateScrollTop2;
        } else {
            editorContainerElement.scrollTop = candidateScrollTop1;
        }
    });

    const handleCommentThreadSnippetPress = useEvent((commentThreadId: DocumentCommentThreadId) => {
        const editorContainerElement = assertExists(editorContainerRef.current);
        const firstCommentMarkElement = editorContainerElement.querySelector(
            `[data-comment="${commentThreadId}"]`,
        );
        if (!firstCommentMarkElement) return;

        scrollToEditorRect(firstCommentMarkElement.getBoundingClientRect());
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

            const lastCommentThreadId =
                lastSidebarState.isOpen && lastSidebarState.animationState !== "Closing"
                    ? lastSidebarState.commentThreadId
                    : null;

            const commentThreadId =
                sidebarState.isOpen && sidebarState.animationState !== "Closing"
                    ? sidebarState.commentThreadId
                    : null;

            // When the sidebar comment thread changes, scroll to the comment in
            // the document. Or when the component initially mounts.
            if (
                !commentThreadId ||
                (!isInitialRender &&
                    (lastCommentThreadId === commentThreadId || !lastSidebarState.isOpen))
            ) {
                return;
            }

            const editorContainerElement = assertExists(editorContainerRef.current);
            const commentMarkElements = editorContainerElement.querySelectorAll(
                `[data-comment="${commentThreadId}"]`,
            );

            const editorContainerRect = editorContainerElement.getBoundingClientRect();

            // Comment thread doesn't exist in the document anymore
            if (commentMarkElements.length === 0) return;

            let firstCommentMarkRect: DOMRect | undefined;
            let isSomeCommentMarkVisible = false;

            for (const commentMarkElement of commentMarkElements) {
                const commentMarkRect = commentMarkElement.getBoundingClientRect();
                if (!firstCommentMarkRect) firstCommentMarkRect = commentMarkRect;

                if (
                    areRangesOverlapping(
                        editorContainerRect.top,
                        editorContainerRect.bottom,
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
            scrollToEditorRect(firstCommentMarkRect);
        }, [isInitialAppRender, scrollToEditorRect, sidebarState]);
    }

    /* ========================================================================== *\
     *                               Native Mobile                                *
    \* ========================================================================== */

    const isInertNativeMobileRoute = useIsInertNativeMobileRoute();

    useEffect(() => {
        if (isInertNativeMobileRoute) return;

        return subscribeToMobileKeyboardFrameChange(
            ({newKeyboardHeight, oldKeyboardHeight, shouldScroll, isAnimated}) => {
                if (!shouldScroll) return;

                const keyboardHeightDelta = newKeyboardHeight - oldKeyboardHeight;

                if (keyboardHeightDelta <= 0) return;

                const remPx = getRemPxWithoutListening();

                const paragraphLineHeight =
                    parseRemLengthNumber(contentSchemaStyles.paragraphLineHeight) * remPx;

                const editorContainerElement = assertExists(editorContainerRef.current);
                const editor = assertExists(editorRef.current);
                const editorState = editor.getState();

                const coords = editor.coordsAtPos(editorState.getSelection().from);

                const willSelectionBeOffScreen =
                    window.innerHeight - coords.bottom <
                    newKeyboardHeight +
                        // Some slop. We consider the selection offscreen if there's less than a line
                        // of space between it and the keyboard.
                        paragraphLineHeight;

                if (!willSelectionBeOffScreen) return;

                const insetTop = getElementSafeAreaInsetTopPx(editorContainerElement);
                const insetBottom = newKeyboardHeight;

                const idealTop =
                    insetTop +
                    (window.innerHeight - insetBottom - insetTop) / 2 -
                    paragraphLineHeight;
                const scrollDelta = coords.top - idealTop;

                editorContainerElement.scrollTo({
                    top: editorContainerElement.scrollTop + scrollDelta,
                    behavior:
                        scrollDelta > paragraphLineHeight || isAnimated ? "smooth" : "instant",
                });
            },
        );
    }, [isInertNativeMobileRoute]);

    useEffect(() => {
        if (!NativeMobileBridge) return;
        if (isInitialAppRender) return;
        if (isInertNativeMobileRoute) return;

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
    }, [isInertNativeMobileRoute, isInitialAppRender]);

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

    const titleBoundaryRef = useRef<HTMLElement | null>(null);

    const queryTitleBoundaryRef = useLifecycleRef(
        useCallback(
            (element: HTMLElement) => {
                // Don't query for the title element on initial render. We'll get the title
                // element from a read-only `<ContentView>` instead of the element rendered by
                // ProseMirror.
                if (isInitialAppRender) return;

                const titleBoundaryElement = assertExists(
                    element.querySelector(`.${contentSchemaStyles.titleClassName}`),
                );
                assert(titleBoundaryElement instanceof HTMLElement);

                titleBoundaryRef.current = titleBoundaryElement;
                return () => {
                    titleBoundaryRef.current = null;
                };
            },
            [isInitialAppRender],
        ),
    );

    const {scrollViewRef, navigationBar, scrollbarInsetTop} = useNavigationBar({
        withMobileLayout,
        title: getDocumentContentTitle(content.doc),
        titleBoundaryRef,
        menuActions: [
            [
                {
                    label: "Copy link",
                    pressErrorTitle: "Couldn’t copy document link",
                    onPress: async () => {
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
            spacing[paddingX],
            contentSchemaStyles.blockMaxWidth,
            spacing[paddingX],
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
                        queryTitleBoundaryRef,
                    )}
                    id={editorContainerId}
                    className={
                        withMobileLayout
                            ? contentSchemaStyles.docMobileLayoutContainerClassName
                            : undefined
                    }
                    data-testid="DocumentContentEditorMain"
                    flexGrow="1"
                    position="relative"
                    zIndex="0"
                    overflowX="hidden"
                    overflowY="auto"
                    style={{
                        width:
                            sidebarState.isOpen && sidebarState.animationState !== "Closing"
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
                                        openCommentThreadPromiseRef: {
                                            current: Promise<void> | null;
                                        };
                                    } | null =
                                        transaction.getMeta(createCommentThreadMetaKey) ?? null;
                                    if (
                                        createCommentThread &&
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
                    <Box
                        ref={sidebarRef}
                        position="absolute"
                        top="0"
                        bottom="0"
                        // A bit of grace room at the end for a spring bounce.
                        right="-4"
                        paddingRight="4"
                        borderLeft="grey-10"
                        backgroundColor="grey-0"
                        style={{
                            width: addRemLengths(documentContentEditorSidebarWidth, spacing["4"]),
                        }}
                    >
                        <DocumentContentEditorSidebar
                            documentId={documentId}
                            content={content}
                            onCommentThreadSnippetPress={handleCommentThreadSnippetPress}
                            commentThreadId={sidebarState.commentThreadId}
                            initialDataPromise={sidebarState.dataPromise}
                            isConnected={isConnected}
                            procedures={procedures}
                            subscribeToCommentThreadEvents={subscribeToCommentThreadEvents}
                            decorations={decorations}
                            commentThreadListViewRef={commentThreadListViewRef}
                            onClose={() => {
                                setSidebarState(sidebarState => {
                                    if (!sidebarState.isOpen) return sidebarState;
                                    return {...sidebarState, animationState: "Closing" as const};
                                });
                            }}
                            openCommentThread={openCommentThread}
                        />
                    </Box>
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
    documentId,
    content,
    commentThreadId,
    onCommentThreadSnippetPress,
    initialDataPromise,
    isConnected,
    procedures,
    subscribeToCommentThreadEvents,
    decorations,
    commentThreadListViewRef,
    onClose,
    openCommentThread,
}: {
    documentId: DocumentId;
    content: DocumentContentWithReferences;
    commentThreadId: DocumentCommentThreadId;
    onCommentThreadSnippetPress: Memo<(commentThreadId: DocumentCommentThreadId) => void>;
    initialDataPromise: PromiseImmediate<DocumentContentEditorSidebarData>;
    isConnected: boolean;
    procedures: MemoObject<DocumentContentEditorWebSocketClientProcedures>;
    subscribeToCommentThreadEvents: SubscribeToCommentThreadEventsFunction;
    decorations: ReadonlyArray<DocumentContentEditorSideDecoration>;
    commentThreadListViewRef: Ref<DocumentCommentThreadListViewRef>;
    onClose: () => void;
    openCommentThread: (commentThreadId: DocumentCommentThreadId) => Promise<void>;
}) {
    const {isAppleDevice} = useClientInfo();

    const previousCommentThreadButtonRef = useRef<HTMLElement>(null);
    const nextCommentThreadButtonRef = useRef<HTMLElement>(null);

    const initialDataResult = usePromise(initialDataPromise);

    const {previousCommentThreadId, nextCommentThreadId} = useMemo(() => {
        let previousCommentThreadId: DocumentCommentThreadId | null = null;
        let hasFoundCommentThread = false;
        for (const decoration of decorations) {
            for (const otherCommentThreadId of decoration.commentThreadIds) {
                if (hasFoundCommentThread) {
                    return {previousCommentThreadId, nextCommentThreadId: otherCommentThreadId};
                } else if (otherCommentThreadId === commentThreadId) {
                    hasFoundCommentThread = true;
                } else {
                    previousCommentThreadId = otherCommentThreadId;
                }
            }
        }
        return {previousCommentThreadId, nextCommentThreadId: null};
    }, [commentThreadId, decorations]);

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
                    assertExists(previousCommentThreadButtonRef.current).click();
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
                    assertExists(nextCommentThreadButtonRef.current).click();
                }
            }}
        >
            <Box height="full" width="full" overflow="hidden" display="flex" flexDirection="column">
                <Box
                    flexShrink="0"
                    height="8"
                    borderBottom="grey-10"
                    display="flex"
                    alignItems="center"
                >
                    <Box flexShrink="0" paddingX="1.5" display="flex" gap="1">
                        <IconButton
                            ref={previousCommentThreadButtonRef}
                            size="xs"
                            description="Previous thread"
                            keyboardShortcutHint={isAppleDevice ? "⌘+Shift+," : "Ctrl+Shift+,"}
                            isDisabled={!previousCommentThreadId}
                            pressErrorTitle="Can’t go to previous thread"
                            onPress={async () => {
                                if (!previousCommentThreadId) return;
                                await openCommentThread(previousCommentThreadId);
                            }}
                        >
                            <CaretUp />
                        </IconButton>
                        <IconButton
                            ref={nextCommentThreadButtonRef}
                            size="xs"
                            description="Next thread"
                            keyboardShortcutHint={isAppleDevice ? "⌘+Shift+." : "Ctrl+Shift+."}
                            isDisabled={!nextCommentThreadId}
                            pressErrorTitle="Can’t go to next thread"
                            onPress={async () => {
                                if (!nextCommentThreadId) return;
                                await openCommentThread(nextCommentThreadId);
                            }}
                        >
                            <CaretDown />
                        </IconButton>
                    </Box>
                    <Box flexGrow="1" height="full" />
                    <Box flexShrink="0" paddingX="1.5" display="flex" gap="1">
                        <IconButton
                            size="xs"
                            description="Close"
                            keyboardShortcutHint="esc"
                            onPress={onClose}
                        >
                            <X />
                        </IconButton>
                    </Box>
                </Box>
                {useMemo(
                    () =>
                        initialDataResult.isPending ? (
                            <Box
                                flexGrow="1"
                                display="flex"
                                justifyContent="center"
                                alignItems="center"
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
                                documentId={documentId}
                                content={content}
                                onCommentThreadSnippetPress={onCommentThreadSnippetPress}
                                initialCommentThreadsResult={[
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
                                withMobileLayout={true}
                                // Slightly reduce the amount of margin on messages in a comment thread
                                // because we have less space.
                                paddingX="4"
                            />
                        ),
                    [
                        commentThreadId,
                        commentThreadListViewRef,
                        content,
                        documentId,
                        initialDataResult,
                        isConnected,
                        onCommentThreadSnippetPress,
                        procedures,
                        subscribeToCommentThreadEvents,
                    ],
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}
