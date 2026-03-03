import {ArrowRight} from "phosphor-react";
import {Node} from "prosemirror-model";
import {useEffect, useId, useRef} from "react";
import {ContentView} from "~/client/web/content/content_view.js";
import {Box} from "~/client/web/design/box.js";
import {Checkbox} from "~/client/web/design/checkbox.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/web/design/modal_with_buttons.js";
import {markMemoIfNotRendering} from "~/client/web/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {
    colorSchemeVars,
    contentStyles,
    grey100ToGrey80OpacityVar,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {ParsableRemLength, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {DocumentWithoutTitleContentProsemirrorSchema} from "~/shared/documents/document_content_schema.js";
import {FileAttachmentTarget} from "~/shared/files/file_attachment_target.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {generateId} from "~/shared/id/id.js";
import {DocumentId} from "~/shared/id/types/id_types.js";

/**
 * Modal that appears when duplicating a document or task to inform users about the
 * variable substitution feature (`[[Variable Name]]` syntax).
 */
export function ContentDuplicationInstructionalModal({
    noun,
    onDuplicate,
    onClose,
    doNotShowAgain,
    onDoNotShowAgainChange,
}: {
    noun: string;
    onDuplicate: () => MaybePromise<void>;
    onClose: () => void;
    doNotShowAgain: boolean;
    onDoNotShowAgainChange: (doNotShowAgain: boolean) => void;
}) {
    const titleId = useId();
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

    const instructionalExampleScale =
        fontSizesBySpacingScale["75"].medium.fontSize /
        fontSizesBySpacingScale[contentStyles.headingLevel1FontSize.wide].medium.fontSize;

    const renderExample = ({
        height,
        content,
    }: {
        height: ParsableRemLength;
        content: {
            doc: Node;
            references: typeof emptyContentReferences;
        };
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
                <Box paddingY="7" paddingX="8">
                    <ContentView
                        isInert={true}
                        withUserSelectNone={true}
                        content={content}
                        // Our example content doesn't have files. Any attachment target will be fine.
                        fileAttachmentTarget={exampleFileAttachmentTarget}
                    />
                </Box>
            </Box>
        </Box>
    );

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onClose}
            primaryButtonLabel="Duplicate"
            primaryButtonPressErrorTitle="Couldn&#x2019;t duplicate"
            onPrimaryButtonPress={onDuplicate}
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
            // Improve focus on the dialog's content by not showing a close button. A modal
            // dialog's two buttons will usually be the main actions you want to take.
            // Dismissing a modal by clicking the background should also feel natural.
            withoutCloseButton={true}
            // The user can cancel with the escape key or clicking outside the modal. This
            // instructional modal isn't warning the user about any destructive action so
            // "Cancel" feels like it confuses the message.
            shouldHideCancelButton={true}
            additionalButtons={
                <Checkbox
                    color="grey-60"
                    isChecked={doNotShowAgain}
                    onChange={onDoNotShowAgainChange}
                >
                    Don&#x2019;t show me this again
                </Checkbox>
            }
        >
            <h2
                id={titleId}
                className={sprinkles({
                    paddingX: "7",
                    paddingTop: "7",
                    fontStyle: "bold",
                    fontSize: "300",
                    userSelect: "text",
                })}
            >
                Tip: Templates
            </h2>
            <Box
                id={descriptionId}
                paddingX="7"
                paddingTop="2.5"
                paddingBottom="5"
                fontSize="75"
                userSelect="text"
                style={{lineHeight: 1.5}}
            >
                You can create templates by adding placeholders like &#x201C;{"{{Name}}"}
                &#x201D; to your {noun}. The next time you duplicate the {noun}, you&#x2019;ll be
                prompted to fill in each placeholder.
            </Box>
            <Box paddingX="7" paddingBottom="6">
                <Box position="relative" display="flex" gap="10">
                    <ArrowRight
                        size={spacing["5"]}
                        color={colorSchemeVars["grey-50"]}
                        weight="light"
                        className={sprinkles({position: "absolute"})}
                        style={{
                            top: "50%",
                            left: "50%",
                            transform: "translate(-50%, -50%)",
                        }}
                    />
                    <Box flexGrow="1" width="full">
                        {renderExample({
                            height: "9.5rem",
                            content: contentDuplicationInstructionalExampleBefore.get(),
                        })}
                    </Box>
                    <Box flexGrow="1" width="full">
                        {renderExample({
                            height: "9.5rem",
                            content: contentDuplicationInstructionalExampleAfter.get(),
                        })}
                    </Box>
                </Box>
            </Box>
        </ModalWithButtons>
    );
}

// Our example content doesn't have files. Any attachment target will be fine.
const exampleFileAttachmentTarget = markMemoIfNotRendering<FileAttachmentTarget>({
    type: "Document",
    documentId: generateId<DocumentId>(),
});

const contentDuplicationInstructionalExampleBefore = new Lazy(() => {
    const schema = DocumentWithoutTitleContentProsemirrorSchema;

    const doc = schema.node("doc", null, [
        schema.node("heading", {level: 1}, [schema.text("Project Brief Template")]),
        schema.node("paragraph", null, [
            schema.text("Team: "),
            schema.text("{{Team}}", [schema.mark("bold")]),
            schema.node("break"),
            schema.text("Stakeholders: "),
            schema.text("{{Stakeholders}}", [schema.mark("bold")]),
        ]),
        schema.node("heading", {level: 2}, [schema.text("Problem statement")]),
        schema.node("paragraph", null, [schema.text("{{Problem statement}}")]),
        schema.node("heading", {level: 2}, [schema.text("Proposed solution")]),
        schema.node("paragraph", null, [schema.text("{{Proposed solution}}")]),
    ]);

    return {doc, references: emptyContentReferences};
});

const contentDuplicationInstructionalExampleAfter = new Lazy(() => {
    const schema = DocumentWithoutTitleContentProsemirrorSchema;

    const doc = schema.node("doc", null, [
        schema.node("heading", {level: 1}, [schema.text("Office Relocation Project Brief")]),
        schema.node("paragraph", null, [
            schema.text("Team: "),
            schema.text("Operations", [schema.mark("bold")]),
            schema.node("break"),
            schema.text("Stakeholders: "),
            schema.text("Facilities, HR, Finance", [schema.mark("bold")]),
        ]),
        schema.node("heading", {level: 2}, [schema.text("Problem statement")]),
        schema.node("paragraph", null, [
            schema.text(
                "The current office no longer accommodates the team\u2019s size, leading to limited meeting room availability.",
            ),
        ]),
        schema.node("heading", {level: 2}, [schema.text("Proposed solution")]),
        // Truncated, we don't actually need a proposed solution.
    ]);

    return {doc, references: emptyContentReferences};
});
