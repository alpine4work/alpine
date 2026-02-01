import {ArrowRight, File, Image, Plus} from "phosphor-react";
import {EditorState} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {
    Dispatch,
    Memo,
    ReactNode,
    RefObject,
    SetStateAction,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import {createPortal} from "react-dom";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentEditor, ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentEditorCursorTracker} from "~/client/web/content/internal/content_editor_cursor_tracker.js";
import {
    FileInfoWithEntity,
    iterateFileInfosInElement,
} from "~/client/web/content/internal/iterate_file_infos_in_element.js";
import {
    MessageInputFile,
    addMessageInputFiles,
} from "~/client/web/content/messaging/add_message_input_files.js";
import {MessageInputFileEntityPreview} from "~/client/web/content/messaging/message_input_file_entity_preview.js";
import {MessageInputFilePreview} from "~/client/web/content/messaging/message_input_file_preview.js";
import {useMessagingViewDropTarget} from "~/client/web/content/messaging/use_messaging_view_drop_target.js";
import {selectFiles} from "~/client/web/content/select_files.js";
import {
    ContentEditorState,
    createContentCommentThreadMetaKey,
    updateContentEditorReferences,
} from "~/client/web/content/state/content_editor_state.js";
import {useAppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {MenuButton} from "~/client/web/design/menu_button.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {OverlayRef} from "~/client/web/design/overlay.js";
import {OverlayAnimated} from "~/client/web/design/overlay_animated.js";
import {useOverlayBlockingPortalElement} from "~/client/web/design/overlay_helpers.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {useConfirmSaveAfterLosingFocus} from "~/client/web/design/use_confirm_save_after_losing_focus.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {useIsMounted} from "~/client/web/helpers/lifecycle/use_is_mounted.js";
import {parseHtml} from "~/client/web/helpers/parse_html.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {VideoIcon} from "~/client/web/icons/video_icon.js";
import {WaveformIcon} from "~/client/web/icons/waveform_icon.js";
import {getClientInfo} from "~/client/web/remix/client_info_context.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useAddGlobalLoadingIndicator} from "~/client/web/spaces/global_loading_indicator.js";
import {useSpaceContext} from "~/client/web/spaces/space_context.js";
import {
    messageInputEditorBorderRadiusPx,
    messageInputEditorIconButtonSize,
    messageInputEditorMinHeightPx,
    messageInputEditorPaddingX,
    messageInputEditorPaddingYPx,
    messageInputFilesOverflowGradientWidth,
    messageViewMarginLeft,
} from "~/client/web/styles/messaging_shared_styles.js";
import {
    backgroundColorVar,
    overlayFadeOutAnimationDurationMs,
    pointerEventsNoneNotInheritedClassName,
    spaceLayoutStyles,
} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContentEnd, trimContentWithReferencesEnd} from "~/shared/content/trim_content.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {
    addRemLengths,
    convertRemLengthToPx,
    screenPaddingX,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {
    getFileAudioContentTypes,
    getFileImageContentTypes,
    getFileVideoContentTypes,
} from "~/shared/files/file_content_type.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentCommentThreadId} from "~/shared/id/types/id_types.js";
import {
    MessageContentWithReferences,
    emptyMessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {trimSpacesFromProsemirrorRange} from "~/shared/prosemirror/trim_spaces_from_prosemirror_range.js";

export function ContentEditorCommentInputFloater({
    state,
    viewRef,
    range,
    fileAttachmentTarget,
    onClose: onCloseWithoutAnimationFromProps,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    range: {from: number; to: number};
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onClose: () => void;
}) {
    const context = useAppContext();
    const reporter = useReporter();
    const {space} = useSpaceContext();
    const addGlobalLoadingIndicator = useAddGlobalLoadingIndicator();

    // We use desktop measurements for `contentEditorCommentInputFloaterMinHeight`
    // and `contentEditorCommentInputFloaterAccountAvatarPaddingY` so assert this
    // component isn't rendered on mobile.
    const platform = usePlatform();
    assert(platform !== "mobile");

    const overlayRef = useRef<OverlayRef>(null);

    const [isClosing, setIsClosing] = useState(false);

    const onCloseWithAnimation = useCallback(() => {
        setIsClosing(true);
    }, []);

    const onCloseWithoutAnimation = useEvent(() => {
        // Return focus to the editor.
        assertExists(viewRef.current).focus();

        onCloseWithoutAnimationFromProps();
    });

    useEffect(() => {
        if (isClosing) {
            const timeoutId = setTimeout(() => {
                onCloseWithoutAnimation();
            }, overlayFadeOutAnimationDurationMs);
            return () => {
                clearTimeout(timeoutId);
            };
        }
    }, [isClosing, onCloseWithoutAnimation]);

    const isNodeRange = useMemo(() => {
        if (range.from === range.to - 1) {
            const documentRangeNode = state.doc.resolve(range.from).nodeAfter;

            if (
                documentRangeNode &&
                !documentRangeNode.inlineContent &&
                documentRangeNode.type.allowsMarkType(state.schema.marks.comment!)
            ) {
                return true;
            }
        }

        return false;
    }, [range.from, range.to, state.doc, state.schema.marks.comment]);

    const [commentState, setCommentState] = useState(() =>
        ContentEditorState.create(emptyMessageContentWithReferences),
    );
    const [files, setFiles] = useState<ReadonlyArray<MessageInputFile>>(emptyArray);

    const addFiles = (
        spanName: string,
        fileInfos: ReadonlyArray<FileInfoWithEntity>,
    ): {finally(listener: () => void): void} => {
        if (fileInfos.length === 0) return Promise.resolve();

        const promise = context.tracer.withSpan(spanName, async context => {
            await addMessageInputFiles(context, fileInfos, {
                spaceId: space.id,
                attachmentTarget: fileAttachmentTarget,
                addGlobalLoadingIndicator,
                onAddFile: file => {
                    setFiles(files => [...files, file]);
                },
            });
        });

        promise.catch(error => {
            reporter.displayError("Couldn\u2019t upload file", error);
        });

        return promise;
    };

    const {dropTargetProps, dragOverlay} = useMessagingViewDropTarget({
        isDisabled: false,
        onDrop: event => {
            let hasHtmlFileInfos = false;
            const fileInfos: Array<FileInfoWithEntity> = [];

            for (const {info} of iterateFileInfosInElement(
                parseHtml(event.dataTransfer.getData("text/html")),
                () => space.id,
            )) {
                if (!info) continue;

                hasHtmlFileInfos = true;
                fileInfos.push(info);
            }

            // Ignore files from `dataTransfer` if we had `text/html`. Since we assume
            // `text/html` will contain links to any files included in `dataTransfer`.
            if (!hasHtmlFileInfos) {
                for (const item of event.dataTransfer.items) {
                    if (item.kind !== "file") continue;

                    fileInfos.push({
                        type: "UploadFile",
                        input: {type: "File", file: assertExists(item.getAsFile())},
                    });
                }
            }

            return addFiles("<ContentEditorCommentInputFloater> drop files", fileInfos);
        },
    });

    return (
        <Box
            // So putting `dropTargetProps` works here through some React magic. React
            // bubbles events from portaled elements! This is important because our overlay
            // will render a blocking cover over the page. So we need the `dragenter` event
            // from the blocking cover element in order to render the drop target. Thanks
            // to React bubbling we get that `dragenter` event on this element.
            {...dropTargetProps}
            width="0"
            height="0"
        >
            <OverlayAnimated
                ref={overlayRef}
                // We don't animate in because the overlay appears in direct response to a user
                // input (keyboard shortcut). But we do animate out because closing is less
                // intentional.
                //
                // Also it looks a little better to not animate when replacing a possibly
                // existing toolbar.
                isVisible={!isClosing}
                disableAnimation={!isClosing}
                isBlocking={true}
                placement="bottom"
                offset="3"
                // No fallback placements! The comment input always stays at the end of the
                // text its commenting on.
                fallbackPlacements={emptyArray}
                overlay={
                    <Box data-testid="ContentEditorCommentInputFloater">
                        {dragOverlay && (
                            <ContentEditorCommentInputDragOverlay viewRef={viewRef}>
                                {dragOverlay}
                            </ContentEditorCommentInputDragOverlay>
                        )}
                        <ContentEditorCommentInput
                            state={state}
                            viewRef={viewRef}
                            isNodeRange={isNodeRange}
                            range={range}
                            commentState={commentState}
                            setCommentState={setCommentState}
                            files={files}
                            setFiles={setFiles}
                            addFiles={addFiles}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                            onCloseWithAnimation={onCloseWithAnimation}
                        />
                    </Box>
                }
            >
                <ContentEditorCursorTracker
                    state={state}
                    viewRef={viewRef}
                    pos={isNodeRange ? range.from : range}
                    onUpdatePosition={() => overlayRef.current?.forceUpdateOverlayPosition()}
                />
            </OverlayAnimated>
        </Box>
    );
}

function ContentEditorCommentInput({
    state: documentState,
    viewRef: documentViewRef,
    isNodeRange: isNodeDocumentRange,
    range: documentRange,
    commentState,
    setCommentState,
    files,
    setFiles,
    addFiles,
    onCloseWithoutAnimation,
    onCloseWithAnimation,
}: {
    state: EditorState;
    viewRef: RefObject<EditorView | null>;
    isNodeRange: boolean;
    range: {from: number; to: number};
    commentState: ContentEditorState<MessageContentWithReferences>;
    setCommentState: Dispatch<SetStateAction<ContentEditorState<MessageContentWithReferences>>>;
    files: ReadonlyArray<MessageInputFile>;
    setFiles: Dispatch<SetStateAction<ReadonlyArray<MessageInputFile>>>;
    addFiles: (spanName: string, fileInfos: ReadonlyArray<FileInfoWithEntity>) => void;
    onCloseWithoutAnimation: () => void;
    onCloseWithAnimation: () => void;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const {currentAccount} = useSpaceContext();
    const isMounted = useIsMounted();

    const [shouldShowConfirmCloseDialog, setShouldShowConfirmCloseDialog] = useState(false);

    const isSendButtonDisabled = useMemo(
        () => isContentEmpty(trimContentEnd(commentState.getDoc())) && files.length === 0,
        [commentState, files.length],
    );

    const containerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<ContentEditorRef<MessageContentWithReferences>>(null);
    const sendButtonRef = useRef<HTMLButtonElement & {press(): void}>(null);
    const shouldFocusNextRenderRef = useRef(true);

    useEffect(() => {
        // If the close confirmation dialog is open, we can't focus our editor.
        if (shouldShowConfirmCloseDialog) return;

        if (!shouldFocusNextRenderRef.current) return;
        shouldFocusNextRenderRef.current = false;

        scheduleMicrotask(() => {
            const editor = editorRef.current;
            if (!editor) return;
            editor.focus({preventScroll: true});
            editor.scrollIntoView();
        });
    }, [shouldShowConfirmCloseDialog]);

    const sendComment = async () => {
        const content = trimContentWithReferencesEnd(commentState.getContent());
        if (isContentEmpty(content.doc) && files.length === 0) return;

        const commentThreadId = generateId<DocumentCommentThreadId>();
        const trimmedDocumentRange = trimSpacesFromProsemirrorRange(
            documentState.doc,
            documentRange,
        );
        const openCommentThreadPromiseRef: {current: Promise<void> | null} = {
            current: null,
        };

        const transaction = documentState.tr;

        if (isNodeDocumentRange) {
            transaction.addNodeMark(
                trimmedDocumentRange.from,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        } else {
            transaction.addMark(
                trimmedDocumentRange.from,
                trimmedDocumentRange.to,
                documentState.schema.mark("comment", {commentThreadId}),
            );
        }

        transaction.setMeta(createContentCommentThreadMetaKey, {
            commentThreadId,
            initialCommentContent: content,
            initialCommentFileIds: files.map(file =>
                file.type === "FileEntity" ? file.fileEntityId : file.file.id,
            ),
            createdTimeZone: getClientInfo().timeZone,
            openCommentThreadPromiseRef,
        });

        transaction.scrollIntoView();

        updateContentEditorReferences(transaction, {
            type: "UpdateDocumentCommentThread",
            commentThreadId,
            commentCount: 1,
            addCommentAuthor: currentAccount,
        });

        assertExists(documentViewRef.current).dispatch(transaction);

        // `<DocumentContentEditor>` may open the comment thread after we create it.
        // Don't close our floater until this has happened.
        await openCommentThreadPromiseRef.current;

        onCloseWithoutAnimation();
    };

    return (
        <>
            <Box
                ref={useMergedRefs(
                    containerRef,
                    useConfirmSaveAfterLosingFocus({
                        shouldConfirmSave: !isSendButtonDisabled,
                        isConfirmingSave: shouldShowConfirmCloseDialog,
                        onCancelSave: onCloseWithAnimation,
                        onConfirmSave: () => setShouldShowConfirmCloseDialog(true),
                    }),
                )}
                position="relative"
                width="96"
                color="grey-100"
                backgroundColor="grey-0"
                boxShadow="elevation-20"
                className={greyElevated2ClassName}
                style={{
                    borderRadius: messageInputEditorBorderRadiusPx[platform][spacingScale],
                }}
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        if (isSendButtonDisabled) {
                            onCloseWithoutAnimation();
                        } else {
                            setShouldShowConfirmCloseDialog(true);
                        }
                        return;
                    }
                }}
                onPointerDownCapture={event => {
                    const editor = assertExists(editorRef.current);

                    // Tapping anywhere on the message input shouldn't unfocus the content editor
                    // since that will hide the virtual keyboard on mobile.
                    if (
                        event.target instanceof Element &&
                        // Exclude tapping in a portaled element. Like inputs in the link modal.
                        event.currentTarget.contains(event.target) &&
                        // Exclude tapping in the message input itself. Tapping there should do
                        // something.
                        !editor.contains(event.target)
                    ) {
                        event.preventDefault();
                    }
                }}
            >
                <Box position="relative">
                    <Box
                        className={pointerEventsNoneNotInheritedClassName}
                        position="absolute"
                        left="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            width: messageInputEditorMinHeightPx[platform][spacingScale],
                            height: messageInputEditorMinHeightPx[platform][spacingScale],
                        }}
                    >
                        <MenuButton
                            withoutButtonElementRequirement={true}
                            // Generally since the message input is at the bottom of the screen the add
                            // menu opens above the input. Let's make that pattern consistent.
                            placement="top-start"
                            actions={[
                                {
                                    label: "Image",
                                    icon: <Image />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileImageContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "Video",
                                    icon: <VideoIcon />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileVideoContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "Audio",
                                    icon: <WaveformIcon />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            acceptContentTypes: getFileAudioContentTypes(),
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                                {
                                    label: "File",
                                    icon: <File />,
                                    onPress: () => {
                                        selectFiles(assertExists(containerRef.current), {
                                            multiple: true,
                                            // It's important to return focus before removing the temporary input element
                                            // so that `useConfirmSaveAfterLosingFocus()` doesn't think editing has
                                            // finished.
                                            onReturnFocus: () => editorRef.current?.focus(),
                                        })
                                            .then(files => {
                                                if (files.length === 0) return;

                                                // Make sure we didn't unmount while selecting files.
                                                if (!isMounted()) return;

                                                addFiles(
                                                    "<ContentEditorCommentInputFloater> insert files",
                                                    files.map(file => ({
                                                        type: "UploadFile",
                                                        input: {type: "File", file},
                                                    })),
                                                );
                                            })
                                            .catch(scheduleUncaughtError);
                                    },
                                },
                            ]}
                        >
                            <IconButton
                                size={messageInputEditorIconButtonSize}
                                description="Add"
                                withoutTooltip={true}
                                // The add icon button is not focusable. That's because we don't want to
                                // remove focus from the message input when the add button is pressed. That
                                // way on mobile you can keep typing and sending messages because the software
                                // keyboard doesn't disappear.
                                //
                                // On desktop, hitting enter in the message input is sufficient for keyboard
                                // control of the message input.
                                isFocusable={false}
                            >
                                <Plus />
                            </IconButton>
                        </MenuButton>
                    </Box>
                    <FocusRing offset="border" isVisibleWhenFocusWithin={true}>
                        <Box
                            ref={useScrollbar({
                                insetTop: messageInputEditorBorderRadiusPx[platform][spacingScale],
                                // Don't overlap the send button which is rendered at the bottom of
                                // the input.
                                insetBottom: messageInputEditorMinHeightPx[platform][spacingScale],
                            })}
                            maxHeight="96"
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                            style={{
                                minHeight: messageInputEditorMinHeightPx[platform][spacingScale],
                                // This border radius is used by the `<FocusRing>` when the
                                // `<FocusRing>` is visible.
                                borderTopLeftRadius:
                                    messageInputEditorBorderRadiusPx[platform][spacingScale],
                                borderTopRightRadius:
                                    messageInputEditorBorderRadiusPx[platform][spacingScale],
                                borderBottomLeftRadius:
                                    files.length === 0
                                        ? messageInputEditorBorderRadiusPx[platform][spacingScale]
                                        : undefined,
                                borderBottomRightRadius:
                                    files.length === 0
                                        ? messageInputEditorBorderRadiusPx[platform][spacingScale]
                                        : undefined,
                            }}
                        >
                            <ContentBlockWidthContextProvider
                                width="96"
                                paddingX={addRemLengths(
                                    screenPaddingX[platform],
                                    messageViewMarginLeft,
                                )}
                            >
                                <ContentEditor
                                    ref={editorRef}
                                    state={commentState}
                                    onChange={setCommentState}
                                    aria-label="New comment"
                                    placeholder="Add a comment"
                                    style={{
                                        paddingLeft: messageInputEditorPaddingX[platform],
                                        paddingRight: messageInputEditorPaddingX[platform],
                                        paddingTop:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                        paddingBottom:
                                            messageInputEditorPaddingYPx[platform][spacingScale],
                                    }}
                                    onEnterKeyDownFromPhysicalKeyboard={event => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        assertExists(sendButtonRef.current).press();
                                    }}
                                    onPasteOrDropFiles={fileInfos => {
                                        addFiles(
                                            "<ContentEditorCommentInputFloater> paste files",
                                            fileInfos,
                                        );
                                    }}
                                    // Don't render the default content editor mobile keyboard toolbar. We render
                                    // our own `<MessageInputMobileKeyboardToolbar>` outside of the content editor.
                                    withoutMobileKeyboardToolbar={true}
                                    // Message input is always editable, never interactive on mobile. So you can't
                                    // click links among other things.
                                    withoutMobileDualModality={true}
                                />
                            </ContentBlockWidthContextProvider>
                        </Box>
                    </FocusRing>
                    <Box
                        className={pointerEventsNoneNotInheritedClassName}
                        position="absolute"
                        right="0"
                        bottom="0"
                        zIndex="20"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        style={{
                            height: messageInputEditorMinHeightPx[platform][spacingScale],
                            width: messageInputEditorMinHeightPx[platform][spacingScale],
                        }}
                    >
                        <IconButton
                            ref={sendButtonRef}
                            size={messageInputEditorIconButtonSize}
                            variant="accent"
                            description="Save comment"
                            pressErrorTitle="Can&#x2019;t save comment"
                            onPress={sendComment}
                            isDisabled={isSendButtonDisabled}
                            // The send icon button is not focusable. That's because we don't want to
                            // remove focus from the message input when the send button is pressed. That
                            // way on mobile you can keep typing and sending messages because the software
                            // keyboard doesn't disappear.
                            //
                            // On desktop, hitting enter in the message input is sufficient for keyboard
                            // control of the message input.
                            isFocusable={false}
                        >
                            <ArrowRight
                                size={spacing["4"]}
                                weight={!isSendButtonDisabled ? "bold" : undefined}
                            />
                        </IconButton>
                    </Box>
                </Box>
                {files.length > 0 && (
                    <Box
                        pointerEvents="none"
                        position="relative"
                        paddingTop="4"
                        paddingBottom="4"
                        style={{
                            paddingLeft: subtractRemLengths(
                                "4",
                                messageInputFilesOverflowGradientWidth,
                            ),
                            paddingRight: subtractRemLengths(
                                "4",
                                messageInputFilesOverflowGradientWidth,
                            ),
                        }}
                    >
                        <Box
                            position="absolute"
                            zIndex="10"
                            top="0"
                            left="0"
                            right="0"
                            height="border"
                            backgroundColor="grey-5"
                        />
                        <Box
                            pointerEvents="auto"
                            position="relative"
                            zIndex="0"
                            width="full"
                            marginTop="-2"
                        >
                            <Box
                                position="absolute"
                                zIndex="10"
                                top="0"
                                bottom="0"
                                left="0"
                                width={messageInputFilesOverflowGradientWidth}
                                style={{
                                    background: `linear-gradient(to right, ${backgroundColorVar}, transparent)`,
                                }}
                            />
                            <Box
                                position="absolute"
                                zIndex="10"
                                top="0"
                                bottom="0"
                                right="0"
                                width={messageInputFilesOverflowGradientWidth}
                                style={{
                                    background: `linear-gradient(to left, ${backgroundColorVar}, transparent)`,
                                }}
                            />
                            <Box
                                data-scrollbar="false"
                                position="relative"
                                zIndex="0"
                                width="full"
                                overflowX="auto"
                            >
                                <Box
                                    display="flex"
                                    gap="2"
                                    paddingTop="2"
                                    paddingX={messageInputFilesOverflowGradientWidth}
                                    style={{width: "fit-content"}}
                                >
                                    {files.map(file =>
                                        file.type === "FileEntity" ? (
                                            <MessageInputFileEntityPreview
                                                key={file.key}
                                                fileEntityId={file.fileEntityId}
                                                fileEntityResult={file.fileEntityResult}
                                                onRemove={() => {
                                                    setFiles(files =>
                                                        files.filter(
                                                            otherFile => otherFile.key !== file.key,
                                                        ),
                                                    );
                                                }}
                                            />
                                        ) : (
                                            <MessageInputFilePreview
                                                key={file.key}
                                                signedUrlSearch={file.signedUrlSearch}
                                                file={file.file}
                                                attachmentTarget={file.attachmentTarget}
                                                onRemove={() => {
                                                    setFiles(files =>
                                                        files.filter(
                                                            otherFile => otherFile.key !== file.key,
                                                        ),
                                                    );
                                                }}
                                            />
                                        ),
                                    )}
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                )}
            </Box>
            {shouldShowConfirmCloseDialog && (
                <ModalDialog
                    title="Save comment"
                    description="Would you like to save your comment?"
                    onClose={() => {
                        // Return focus to the editor if the dialog is closed. This acts as a "cancel"
                        // and lets the user continue writing.
                        shouldFocusNextRenderRef.current = true;
                        setShouldShowConfirmCloseDialog(false);
                    }}
                    primaryButtonLabel="Save"
                    primaryButtonPressErrorTitle="Can&#x2019;t save comment"
                    onPrimaryButtonPress={sendComment}
                    cancelButtonLabel="Discard comment"
                    onCancelButtonPress={onCloseWithoutAnimation}
                />
            )}
        </>
    );
}

function ContentEditorCommentInputDragOverlay({
    viewRef,
    children,
}: {
    viewRef: RefObject<EditorView | null>;
    children: ReactNode;
}) {
    const platform = usePlatform();
    const spacingScale = useSpacingScale();
    const rootBlockingPortalElement = useOverlayBlockingPortalElement();

    const [rect, setRect] = useState<{
        top: number;
        bottom: number;
        left: number;
        right: number;
    } | null>(null);

    // If the position of `view` changes we want to re-render with the new `rect`.
    // A cheap hacky way to do this is if our component re-renders then recompute
    // `rect`. Most of the time re-renders won't change the position of our view.
    //
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useLayoutEffect(() => {
        const {top, bottom, left, right} = assertExists(
            viewRef.current,
        ).dom.getBoundingClientRect();

        const {height: windowHeight, width: windowWidth} =
            document.documentElement.getBoundingClientRect();

        const rect = {
            top: clamp(0, top, windowHeight),
            bottom: windowHeight - clamp(0, bottom, windowHeight),
            left: clamp(
                // Never cover the space layout sidebar on desktop platforms. In some states
                // `view` may partially overlap the space layout sidebar because the amount of
                // space the sidebar actually takes is dynamic based on view width
                // (see `spaceLayoutStyles.sideBarSpace`).
                platform !== "mobile"
                    ? convertRemLengthToPx(spaceLayoutStyles.sideBarWidth, spacingScale)
                    : 0,
                left,
                windowWidth,
            ),
            right: windowWidth - clamp(0, right, windowWidth),
        };

        setRect(previousRect => {
            if (isDeepEqual(previousRect, rect)) return previousRect;
            return rect;
        });
    });

    if (!rect) return null;
    if (!rootBlockingPortalElement) return null;

    return createPortal(
        <Box
            zIndex="80"
            position="fixed"
            style={{top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right}}
        >
            {children}
        </Box>,
        rootBlockingPortalElement,
    );
}
