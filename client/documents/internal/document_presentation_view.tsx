import {Memo, ReactNode, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {DocumentPresentationSlide} from "~/client/documents/internal/document_presentation_slide.js";
import {DocumentPresentationSlideView} from "~/client/documents/internal/document_presentation_slide_view.js";
import {GlobalKeyDownEvent} from "~/client/helpers/global_key_down_event.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useClientInfo} from "~/client/remix/client_info_context.js";
import {scrollbarStyles} from "~/client/styles/styles.js";
import {linkClassName} from "~/shared/content/content_styles.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

export function DocumentPresentationView({
    slides,
    references,
    initialSlideIndex,
    fileAttachmentTarget,
    contentCover,
}: {
    slides: ReadonlyArray<DocumentPresentationSlide>;
    references: DocumentContentReferences;
    initialSlideIndex: number;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    contentCover?: ReactNode;
}) {
    const clientInfo = useClientInfo();

    const [sizeRef, size] = useResizeObserver();

    const minSlideIndex = 0;
    const maxSlideIndex = slides.length - 1;
    const clampSlideIndex = (slideIndex: number) => clamp(0, slideIndex, slides.length - 1);

    const [slideState, setSlideState] = useState<{
        readonly slideIndex: number;
        readonly undoHistorySlideIndexes: ReadonlyArray<number>;
        readonly redoHistorySlideIndexes: ReadonlyArray<number>;
    }>({
        slideIndex: initialSlideIndex,
        undoHistorySlideIndexes: emptyArray,
        redoHistorySlideIndexes: emptyArray,
    });

    const truncateHistorySlideIndexes = (slideIndexes: ReadonlyArray<number>) => {
        const maxHistorySlideIndexCount = 100;
        if (slideIndexes.length <= maxHistorySlideIndexCount) return slideIndexes;
        return slideIndexes.slice(slideIndexes.length - maxHistorySlideIndexCount);
    };

    const slideIndex = clampSlideIndex(slideState.slideIndex);

    if (slideIndex !== slideState.slideIndex) {
        setSlideState({...slideState, slideIndex});
    }

    const slide = slides[slideIndex]!;

    const updateSlideIndex = (updateSlideIndex: number | ((slideIndex: number) => number)) => {
        setSlideState(slideState => {
            const slideIndex =
                typeof updateSlideIndex === "number"
                    ? updateSlideIndex
                    : updateSlideIndex(slideState.slideIndex);

            if (slideState.slideIndex === slideIndex) return slideState;

            return {
                slideIndex,
                undoHistorySlideIndexes: truncateHistorySlideIndexes([
                    ...slideState.undoHistorySlideIndexes,
                    slideState.slideIndex,
                ]),
                redoHistorySlideIndexes: emptyArray,
            };
        });
    };

    const undoSlideIndexUpdate = () => {
        setSlideState(slideState => {
            if (slideState.undoHistorySlideIndexes.length === 0) return slideState;

            return {
                slideIndex:
                    slideState.undoHistorySlideIndexes[
                        slideState.undoHistorySlideIndexes.length - 1
                    ]!,
                undoHistorySlideIndexes: slideState.undoHistorySlideIndexes.slice(0, -1),
                redoHistorySlideIndexes: truncateHistorySlideIndexes([
                    ...slideState.redoHistorySlideIndexes,
                    slideState.slideIndex,
                ]),
            };
        });
    };

    const redoSlideIndexUpdate = () => {
        setSlideState(slideState => {
            if (slideState.redoHistorySlideIndexes.length === 0) return slideState;

            return {
                slideIndex:
                    slideState.redoHistorySlideIndexes[
                        slideState.redoHistorySlideIndexes.length - 1
                    ]!,
                undoHistorySlideIndexes: truncateHistorySlideIndexes([
                    ...slideState.undoHistorySlideIndexes,
                    slideState.slideIndex,
                ]),
                redoHistorySlideIndexes: slideState.redoHistorySlideIndexes.slice(0, -1),
            };
        });
    };

    const {pressProps} = usePress({
        onPress: () => {
            updateSlideIndex(slideIndex => slideIndex + 1);
        },
    });

    // Ignore pointer events on link elements. If a link is clicked the link will
    // do its own press handling.
    const ignorePressFromElement = (element: Element): boolean => {
        return !!element.closest(
            [linkClassName, scrollbarStyles.scrollbarThumbClassName]
                .map(className => `.${className}`)
                .join(", "),
        );
    };

    return (
        <GlobalKeyDownEvent
            onGlobalKeyDown={event => {
                switch (event.key) {
                    case "ArrowLeft": {
                        event.preventDefault();
                        event.stopPropagation();

                        if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                            updateSlideIndex(minSlideIndex);
                        } else {
                            updateSlideIndex(slideIndex => slideIndex - 1);
                        }
                        break;
                    }
                    case "ArrowRight": {
                        event.preventDefault();
                        event.stopPropagation();

                        if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                            updateSlideIndex(maxSlideIndex);
                        } else {
                            updateSlideIndex(slideIndex => slideIndex + 1);
                        }
                        break;
                    }
                    case " ":
                    case "Enter": {
                        event.preventDefault();
                        event.stopPropagation();

                        updateSlideIndex(slideIndex => slideIndex + 1);
                        break;
                    }
                    case "Home": {
                        event.preventDefault();
                        event.stopPropagation();

                        updateSlideIndex(minSlideIndex);
                        break;
                    }
                    case "End": {
                        event.preventDefault();
                        event.stopPropagation();

                        updateSlideIndex(maxSlideIndex);
                        break;
                    }
                    case "p": {
                        // Disable browser default for cmd+p (print).
                        if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();
                        }
                        break;
                    }
                    case "z": {
                        if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();

                            if (event.shiftKey) {
                                redoSlideIndexUpdate();
                            } else {
                                undoSlideIndexUpdate();
                            }
                        }
                        break;
                    }
                    case "y": {
                        if (clientInfo.isAppleDevice ? event.metaKey : event.ctrlKey) {
                            event.preventDefault();
                            event.stopPropagation();

                            redoSlideIndexUpdate();
                        }
                        break;
                    }
                }
            }}
        >
            <Box
                {...pressProps}
                onClick={event => {
                    if (event.target instanceof Element && ignorePressFromElement(event.target))
                        return;

                    pressProps.onClick?.(event);
                }}
                onPointerDown={event => {
                    if (event.target instanceof Element && ignorePressFromElement(event.target))
                        return;

                    pressProps.onPointerDown?.(event);
                }}
                onMouseDown={event => {
                    if (event.target instanceof Element && ignorePressFromElement(event.target))
                        return;

                    pressProps.onMouseDown?.(event);
                }}
                ref={sizeRef}
                width="full"
                height="full"
                overflow="hidden"
            >
                {size && (
                    <DocumentPresentationSlideView
                        // Remount when the `slideIndex` changes.
                        key={slideIndex}
                        slide={slide}
                        references={references}
                        fileAttachmentTarget={fileAttachmentTarget}
                        size={size}
                        contentCover={slideIndex === 0 ? contentCover : undefined}
                    />
                )}
            </Box>
        </GlobalKeyDownEvent>
    );
}
