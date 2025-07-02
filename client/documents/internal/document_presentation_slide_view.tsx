import {Memo, ReactNode, useLayoutEffect, useMemo} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {Box} from "~/client/design/box.js";
import {useScrollbar} from "~/client/design/scrollbar.js";
import {DocumentPresentationSlide} from "~/client/documents/internal/document_presentation_slide.js";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {useResizeObserver} from "~/client/helpers/use_resize_observer.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {contentStyles, documentPresentationStyles, fontSizes} from "~/client/styles/styles.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {DocumentContentReferences} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

const lineHeightRatio = 0.05;

// The reasoning behind the math: If `lineHeightRatio` represents a 16px font
// size then we only want to scale down to a 12px font size.
const minLineHeightRatio = (12 / 16) * lineHeightRatio;

const minBodyScaleIteration = 0;
const maxBodyScaleIteration = 4;

const lineHeightBodyScaleIterationRatio =
    (lineHeightRatio - minLineHeightRatio) / (maxBodyScaleIteration - minBodyScaleIteration);

export function DocumentPresentationSlideView({
    slide,
    references,
    fileAttachmentTarget,
    size,
    contentCover,
}: {
    slide: DocumentPresentationSlide;
    references: DocumentContentReferences;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    size: {width: number; height: number};
    contentCover?: ReactNode;
}) {
    const spacingScale = useSpacingScale();
    const lineHeight = convertRemLengthToPx(fontSizes["100"].lineHeight, spacingScale);

    const margin = size.height * lineHeightRatio;

    const headingScale = (size.height * lineHeightRatio) / lineHeight;

    const [headingSizeRef, headingSize] = useResizeObserver({
        withSuppressResizeLoopErrorNotification: true,
    });
    const [bodySizeRef, bodySize] = useResizeObserver({
        withSuppressResizeLoopErrorNotification: true,
    });

    const headingContent = useMemo(() => {
        if (!slide.heading) return null;

        return {
            doc: (slide.heading.type.name === "title"
                ? DocumentContentProsemirrorSchema
                : DocumentWithoutTitleContentProsemirrorSchema
            ).nodeFromJSON({
                type: "doc",
                content: [slide.heading.toJSON()],
            }),
            references,
        };
    }, [references, slide.heading]);

    const bodyContent = useMemo(
        () => ({
            doc: DocumentWithoutTitleContentProsemirrorSchema.nodeFromJSON({
                type: "doc",
                content: slide.body.content.map(node => node.toJSON()),
            }),
            references,
        }),
        [references, slide.body.content],
    );

    const headingMarginBottom = headingContent
        ? contentStyles.paragraphMarginRem * remPxBySpacingScale[spacingScale] * headingScale
        : 0;

    const [bodyScaleIterationFromState, setBodyScaleIteration] = useStateWithDependencies(
        minBodyScaleIteration,
        // Whenever one of these changes, reset our iteration count back to 0 and
        // try iterating through body scale values again to arrive at the right
        // height. This is not...great for performance if the user is dragging the
        // screen width back and forth but it appears good enough to not matter.
        [size.width, size.height, bodyContent],
    );

    const bodyScaleIteration = clamp(
        minBodyScaleIteration,
        Math.trunc(bodyScaleIterationFromState),
        maxBodyScaleIteration,
    );

    const bodyScale =
        (size.height * (lineHeightRatio - lineHeightBodyScaleIterationRatio * bodyScaleIteration)) /
        lineHeight;

    useLayoutEffect(() => {
        if (headingSize && bodySize) {
            const availableBodyHeight =
                size.height - headingSize.height * headingScale - headingMarginBottom - margin * 2;

            if (
                bodyScaleIteration < maxBodyScaleIteration &&
                bodySize.height * bodyScale > availableBodyHeight
            ) {
                setBodyScaleIteration(bodyScaleIteration + 1);
            }
        }
    }, [
        bodyScale,
        bodyScaleIteration,
        bodySize,
        headingMarginBottom,
        headingScale,
        headingSize,
        margin,
        setBodyScaleIteration,
        size.height,
    ]);

    return (
        <Box
            ref={useScrollbar()}
            position="relative"
            width="full"
            height="full"
            overflowX="hidden"
            overflowY="auto"
        >
            <Box style={{padding: margin}} className={documentPresentationStyles.slideClassName}>
                {contentCover}
                {headingContent && (
                    <Box
                        style={{
                            // Container `<div>` with the actual height. Because our child `<div>` will
                            // have the height before scaling up with our CSS `transform: scale()`.
                            height: headingSize ? headingSize.height * headingScale : undefined,
                            marginBottom: headingMarginBottom,
                        }}
                    >
                        <Box
                            ref={headingSizeRef}
                            style={{
                                width: (size.width - margin * 2) / headingScale,
                                transformOrigin: "top left",
                                transform: `scale(${headingScale})`,
                            }}
                        >
                            <ContentView
                                content={headingContent}
                                fileAttachmentTarget={fileAttachmentTarget}
                                // Let content flow the entire width of the fullscreen slide.
                                withoutBlockMaxWidth={true}
                                // Constrain available width to slide size.
                                availableWidth={size.width - margin * 2}
                                // We need to set the scale factor to make sure we use larger `<img>` srcs on
                                // slides so the full resolution image can be displayed.
                                transformScale={bodyScale}
                            />
                        </Box>
                    </Box>
                )}
                <Box
                    style={{
                        // Container `<div>` with the actual height. Because our child `<div>` will
                        // have the height before scaling up with our CSS `transform: scale()`.
                        height: bodySize ? bodySize.height * bodyScale : undefined,
                    }}
                >
                    <Box
                        ref={bodySizeRef}
                        style={{
                            width: (size.width - margin * 2) / bodyScale,
                            transformOrigin: "top left",
                            transform: `scale(${bodyScale})`,
                        }}
                    >
                        <ContentView
                            // TODO(calebmer): Disable image loading while we're resizing the slide so we
                            // don't make multiple image network requests.
                            //
                            // TODO(calebmer): Preload images in the next slide so we don't show a blurred
                            // image when the user goes to the next slide.
                            content={bodyContent}
                            fileAttachmentTarget={fileAttachmentTarget}
                            // Let content flow the entire width of the fullscreen slide.
                            withoutBlockMaxWidth={true}
                            // Constrain available width to slide size.
                            availableWidth={size.width - margin * 2}
                            // We need to set the scale factor to make sure we use larger `<img>` srcs on
                            // slides so the full resolution image can be displayed.
                            transformScale={bodyScale}
                        />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}
