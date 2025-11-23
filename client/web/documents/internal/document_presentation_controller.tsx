import {ArrowRight} from "phosphor-react";
import {
    Memo,
    Ref,
    RefObject,
    forwardRef,
    useEffect,
    useId,
    useImperativeHandle,
    useMemo,
    useRef,
    useState,
} from "react";
import {flushSync} from "react-dom";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {ContentEditorRef} from "~/client/web/content/content_editor.js";
import {ContentView} from "~/client/web/content/content_view.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {Box} from "~/client/web/design/box.js";
import {Checkbox} from "~/client/web/design/checkbox.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/web/design/modal_with_buttons.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {
    DocumentPresentationSlide,
    getDocumentPresentationSlides,
} from "~/client/web/documents/internal/document_presentation_slide.js";
import {DocumentPresentationView} from "~/client/web/documents/internal/document_presentation_view.js";
import {GlobalKeyDownEventModal} from "~/client/web/helpers/global_key_down_event.js";
import {useEvents} from "~/client/web/helpers/lifecycle/use_event.js";
import {getPlatformWithoutListening} from "~/client/web/remix/platform_context.js";
import {getPlatformRouteLayout, useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {
    colorSchemeVars,
    contentStyles,
    documentPresentationStyles,
    grey100ToGrey80OpacityVar,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {AccessLevel, hasAccessLevel} from "~/shared/access/access_policy.js";
import {
    ContentWithReferences,
    emptyContentReferences,
} from "~/shared/content/content_references.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {
    ParsableRemLength,
    convertRemLengthToPx,
    parseRemLength,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {DocumentContentCover} from "~/shared/documents/document_content_cover.js";
import {
    DocumentContentReferences,
    DocumentContentWithReferences,
} from "~/shared/documents/document_content_references.js";
import {
    DocumentContentProsemirrorSchema,
    DocumentWithoutTitleContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export type DocumentPresentationControllerRef = {
    present(): Promise<void>;
    presentWithoutConfirmation(): Promise<void>;
};

type DocumentPresentationControllerPresentationState =
    | {
          readonly type: "Confirming";
      }
    | {
          readonly type: "Presenting";
          readonly slides: ReadonlyArray<DocumentPresentationSlide>;
          readonly references: DocumentContentReferences;
          readonly initialSlideIndex: number;
      };

const DocumentPresentationControllerForwardRef = forwardRef(DocumentPresentationController);
export {DocumentPresentationControllerForwardRef as DocumentPresentationController};

function DocumentPresentationController(
    {
        editorRef,
        editorContainerRef,
        editorState,
        accessLevel,
        fileAttachmentTarget,
    }: {
        editorRef: RefObject<ContentEditorRef<DocumentContentWithReferences>>;
        editorContainerRef: RefObject<HTMLDivElement>;
        editorState: ContentEditorState<DocumentContentWithReferences>;
        accessLevel: AccessLevel;
        fileAttachmentTarget: Memo<FileAttachmentTarget>;
    },
    ref: Ref<DocumentPresentationControllerRef>,
) {
    const routeLayout = useRouteLayout();

    const fullscreenRef = useRef<HTMLDivElement>(null);

    const [presentationState, setPresentationState] =
        useState<DocumentPresentationControllerPresentationState | null>(null);

    const {present, presentWithoutConfirmation} = useEvents({
        present: async () => {
            if (presentationState) return;

            if (hasAccessLevel(accessLevel, "Edit")) {
                setPresentationState({type: "Confirming"});
            } else {
                await presentWithoutConfirmation();
            }
        },

        presentWithoutConfirmation: async () => {
            if (presentationState?.type === "Presenting") return;

            const platform = getPlatformWithoutListening();
            const spacingScale = getSpacingScaleWithoutListening();

            const editor = assertExists(editorRef.current);
            const editorContainerElement = assertExists(editorContainerRef.current);

            // Freeze content when the presentation opens. The presentation won't
            // update in realtime to avoid confusion while presenting.
            const content = editorState.getContent();

            const slides = getDocumentPresentationSlides(content.doc);

            const editorTop =
                editorContainerElement.getBoundingClientRect().top +
                convertRemLengthToPx(navigationBarHeight, spacingScale);

            // Find the first visible slide in the document. We'll use this as the initial
            // slide index.
            let slideIndex = 0;
            for (; slideIndex < slides.length; slideIndex++) {
                const slide = slides[slideIndex]!;

                const slideTop =
                    editor.coordsAtPos(slide.pos).top +
                    (slideIndex === 0
                        ? convertRemLengthToPx(
                              contentStyles.titlePaddingTop[
                                  getPlatformRouteLayout(platform, routeLayout)
                              ],
                              spacingScale,
                          )
                        : 0);

                if (slideTop >= editorTop) {
                    break;
                }
            }

            // Render the presentation view synchronously. Since Chrome only allows
            // `requestFullscreen()` to work in response to a direct user interaction (in
            // our case, the user clicking on a menu item).
            //
            // We need to render presentation mode synchronously so that Chrome correctly
            // associates our `requestFullscreen()` call with the user's click interaction.
            // Previously we awaited a promise that was resolved in a `useEffect()` which
            // sometimes caused Chrome to consider the `requestFullscreen()` call invalid.
            flushSync(() => {
                setPresentationState({
                    type: "Presenting",
                    slides,
                    references: content.references,
                    initialSlideIndex: clamp(0, slideIndex, slides.length),
                });
            });

            const fullscreenElement = assertExists(fullscreenRef.current);

            try {
                await fullscreenElement.requestFullscreen({navigationUI: "hide"});
            } catch (error) {
                setPresentationState(null);
                throw error;
            }
        },
    });

    useImperativeHandle(ref, () => ({present, presentWithoutConfirmation}), [
        present,
        presentWithoutConfirmation,
    ]);

    useEffect(() => {
        if (presentationState?.type !== "Presenting") return;

        const fullscreenElement = assertExists(fullscreenRef.current);

        const handleFullscreenChange = () => {
            if (document.fullscreenElement !== fullscreenElement) {
                setPresentationState(null);
            }
        };

        fullscreenElement.addEventListener("fullscreenchange", handleFullscreenChange);
        return () => {
            fullscreenElement.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, [presentationState]);

    const cover = editorState.getContent().doc.attrs.cover as DocumentContentCover | null;

    const blobsSettings = useMemo(
        () =>
            cover?.type === "Blobs"
                ? {
                      seed: cover.seed,
                      themeColor: cover.themeColor,
                      hueSpread: cover.hueSpread,
                  }
                : null,
        [cover],
    );

    if (!presentationState) return null;

    switch (presentationState.type) {
        case "Confirming": {
            return (
                <DocumentPresentationInstructionalConfirmationModal
                    editorRef={editorRef}
                    editorState={editorState}
                    fileAttachmentTarget={fileAttachmentTarget}
                    onPresent={presentWithoutConfirmation}
                    onClose={() =>
                        setPresentationState(presentationState => {
                            if (presentationState?.type !== "Confirming") return presentationState;
                            return null;
                        })
                    }
                />
            );
        }
        case "Presenting": {
            return (
                <Box position="fixed" top="0" width="0" height="0" overflow="hidden">
                    <Box
                        ref={fullscreenRef}
                        overflow="hidden"
                        backgroundColor="grey-0"
                        style={{width: "100vw", height: "100vh"}}
                    >
                        <GlobalKeyDownEventModal>
                            <DocumentPresentationView
                                slides={presentationState.slides}
                                references={presentationState.references}
                                initialSlideIndex={presentationState.initialSlideIndex}
                                fileAttachmentTarget={fileAttachmentTarget}
                                contentCover={
                                    blobsSettings ? (
                                        <BlobsArt settings={blobsSettings} />
                                    ) : undefined
                                }
                            />
                        </GlobalKeyDownEventModal>
                    </Box>
                </Box>
            );
        }
        default:
            throw exhaustive(presentationState);
    }
}

const documentPresentationInstructionalExampleContent = new Lazy(() => {
    const schema = DocumentContentProsemirrorSchema;
    const schemaWithoutTitle = DocumentWithoutTitleContentProsemirrorSchema;

    const doc = assertDocumentContent(
        schema.node("doc", null, [
            schema.node("title", null, [schema.text("The future of wildlife photography")]),
            schema.node("paragraph", null, [
                schema.text("Cass Cade"),
                schema.node("break"),
                schema.text("Managing Editor"),
            ]),
            schema.node("paragraph", null, [
                schema.text(
                    "The photographs we choose don’t just capture moments–they shape how millions of readers understand our natural world. Today, I’ll share how we’re adapting our editorial approach for an era where audiences expect more than just beautiful images.",
                ),
            ]),
            schema.node("divider"),
            schema.node("heading", {level: 1}, [schema.text("The numbers tell the story")]),
            schema.node("unorderedListItem", null, [
                schema.node("paragraph", null, [schema.text("Monthly reach: 89M digital readers")]),
            ]),
            schema.node("unorderedListItem", null, [
                schema.node("paragraph", null, [
                    schema.text("Average time spent on photo essays: 4.2 minutes"),
                ]),
            ]),
            schema.node("unorderedListItem", null, [
                schema.node("paragraph", null, [
                    schema.text("Social media engagement up 47% on conservation stories"),
                ]),
            ]),
            schema.node("unorderedListItem", null, [
                schema.node("paragraph", null, [
                    schema.text(
                        "76% of readers cite our photography as their primary window into wildlife behavior",
                    ),
                ]),
            ]),
            schema.node("divider"),
            schema.node("heading", {level: 1}, [schema.text("Featured story: Arctic wildlife")]),
            schema.node("paragraph", null, [
                schema.text(
                    "Last month’s cover story presented us with a challenge. We had two options:",
                ),
            ]),
            schema.node("orderedListItem", null, [
                schema.node("paragraph", null, [
                    schema.text(
                        "A stunning portrait of an Arctic fox in its pristine white winter coat against the snow. Technically flawless. The kind of image that wins awards.",
                    ),
                ]),
            ]),
            schema.node("orderedListItem", null, [
                schema.node("paragraph", null, [
                    schema.text(
                        "A more dynamic image of an Arctic fox family at their den site, with the mother returning to her pups, their summer brown coats blending with the tundra. Not as classically elegant, but it captured a rarely-seen moment of natural behavior.",
                    ),
                ]),
            ]),
            schema.node("paragraph", null, [
                schema.text(
                    "We chose the second image. Here’s why this represents our new editorial direction…",
                ),
            ]),
        ]),
    );

    const references = emptyContentReferences;

    const slides = getDocumentPresentationSlides(doc);

    return {
        doc,
        references,
        slides,
        slideContents: slides.map(({heading, body}) => {
            if (heading?.type.name === "title") {
                return {doc: schema.node("doc", null, body.addToStart(heading)), references};
            }

            return {
                doc: schemaWithoutTitle.node(
                    "doc",
                    null,
                    (heading ? body.addToStart(heading) : body).content.map(node =>
                        schemaWithoutTitle.nodeFromJSON(node.toJSON()),
                    ),
                ),
                references,
            };
        }),
    };
});

function DocumentPresentationInstructionalConfirmationModal({
    editorRef,
    editorState,
    fileAttachmentTarget,
    onPresent,
    onClose,
}: {
    editorRef: RefObject<ContentEditorRef<DocumentContentWithReferences>>;
    editorState: ContentEditorState<DocumentContentWithReferences>;
    fileAttachmentTarget: Memo<FileAttachmentTarget>;
    onPresent: () => MaybePromise<void>;
    onClose: () => void;
}) {
    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Immediately focus the primary button.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const modal = assertExists(modalRef.current);
        modal.focusPrimaryButton();
    }, []);

    const titleId = useId();

    const instructionalExampleScale =
        fontSizesBySpacingScale["75"].medium.fontSize /
        fontSizesBySpacingScale[contentStyles.headingLevel1FontSize.wide].medium.fontSize;

    const renderSlide = ({
        height,
        content,
    }: {
        height: ParsableRemLength;
        content: ContentWithReferences;
    }) => (
        <Box
            width="full"
            overflow="hidden"
            backgroundColor="grey-0"
            boxShadow="elevation-10"
            borderRadius="1.5"
            style={{height: `${parseRemLength(height)}rem`}}
        >
            <Box
                style={{
                    transformOrigin: "top left",
                    transform: `scale(${instructionalExampleScale})`,
                    width: `${(1 / instructionalExampleScale) * 100}%`,
                    opacity: grey100ToGrey80OpacityVar,
                }}
            >
                <Box
                    paddingY="7"
                    paddingX="8"
                    className={documentPresentationStyles.slideClassName}
                >
                    <ContentView
                        isInert={true}
                        withUserSelectNone={true}
                        content={content}
                        // Our example content doesn't have files. Any attachment target will
                        // be fine.
                        fileAttachmentTarget={fileAttachmentTarget}
                    />
                </Box>
            </Box>
        </Box>
    );

    const hasPresentShortcut: boolean = editorState.getDoc().attrs.hasPresentShortcut;

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onClose}
            primaryButtonLabel="Present"
            primaryButtonPressErrorTitle="Couldn’t present document"
            onPrimaryButtonPress={onPresent}
            maxWidth="44rem"
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
            // Improve focus on the dialog's content by not showing a close button. A modal
            // dialog's two buttons will usually be the main actions you want to take.
            // Dismissing a modal by clicking the background should also feel natural.
            withoutCloseButton={true}
            additionalButtons={
                <Checkbox
                    color="grey-60"
                    isChecked={hasPresentShortcut}
                    onChange={hasPresentShortcut => {
                        const editor = assertExists(editorRef.current);
                        editor.setHasPresentShortcut(hasPresentShortcut);
                    }}
                >
                    Add shortcut
                </Checkbox>
            }
        >
            <Box userSelect="text">
                <h2
                    id={titleId}
                    className={sprinkles({
                        paddingX: "7",
                        paddingTop: "7",
                        fontStyle: "bold",
                        fontSize: "300",
                    })}
                >
                    Present document
                </h2>
                <Box
                    id={descriptionId}
                    paddingX="7"
                    paddingTop="2.5"
                    paddingBottom="5"
                    fontSize="75"
                    style={{lineHeight: 1.5}}
                >
                    Effortlessly turn your document into a slide deck. Each divider in your document
                    creates a new slide. To add a divider either type “---” in an empty line or
                    right click and choose insert &gt; divider.
                </Box>
                <Box paddingX="7" paddingBottom="6">
                    <Box position="relative" display="flex" gap="14" paddingRight="6">
                        <ArrowRight
                            size={spacing["5"]}
                            color={colorSchemeVars["grey-50"]}
                            weight="light"
                            className={sprinkles({position: "absolute"})}
                            style={{
                                top: `calc(50% + ${spacing["1"]})`,
                                left: `calc(50% - ${subtractRemLengths(
                                    spacing["6"],
                                    spacing["0.5"],
                                )})`,
                            }}
                        />
                        <Box flexGrow="1" width="full">
                            {renderSlide({
                                height: "96",
                                content: documentPresentationInstructionalExampleContent.get(),
                            })}
                        </Box>
                        <Box display="flex" alignItems="center" flexGrow="1" width="full">
                            <Box
                                width="full"
                                position="relative"
                                top="-2.5"
                                style={{height: "10rem"}}
                            >
                                <Box
                                    position="absolute"
                                    style={{
                                        transform: `translate(-${spacing["5"]}, -${spacing["24"]}) rotate(-5deg)`,
                                    }}
                                >
                                    {renderSlide({
                                        height: "10.5rem",
                                        content:
                                            documentPresentationInstructionalExampleContent.get()
                                                .slideContents[0]!,
                                    })}
                                </Box>
                                <Box
                                    position="absolute"
                                    style={{
                                        transform: `translate(${spacing["0"]}, ${spacing["0"]}) rotate(-2deg)`,
                                    }}
                                >
                                    {renderSlide({
                                        height: "10.5rem",
                                        content:
                                            documentPresentationInstructionalExampleContent.get()
                                                .slideContents[1]!,
                                    })}
                                </Box>
                                <Box
                                    position="absolute"
                                    style={{
                                        transform: `translate(${spacing["5"]}, ${spacing["24"]}) rotate(3deg)`,
                                    }}
                                >
                                    {renderSlide({
                                        height: "10.5rem",
                                        content:
                                            documentPresentationInstructionalExampleContent.get()
                                                .slideContents[2]!,
                                    })}
                                </Box>
                            </Box>
                        </Box>
                    </Box>
                </Box>
            </Box>
        </ModalWithButtons>
    );
}
