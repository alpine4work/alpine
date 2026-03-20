import {useEffect, useId, useRef} from "react";
import {Box} from "~/client/web/design/box.js";
import {ModalWithButtons, ModalWithButtonsRef} from "~/client/web/design/modal_with_buttons.js";
import {useScrollbar} from "~/client/web/design/scrollbar.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {GlobalKeyDownEvent} from "~/client/web/helpers/global_key_down_event.js";
import {writeTextToClipboard} from "~/client/web/helpers/write_text_to_clipboard.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

export type DocumentContentExportFormat = "Markdown" | "HTML";

export function DocumentContentExportModal({
    format,
    string,
    html,
    onClose,
}: {
    format: DocumentContentExportFormat;
    string: string;
    html: string;
    onClose: () => void;
}) {
    const titleId = useId();
    const descriptionId = useId();
    const modalRef = useRef<ModalWithButtonsRef>(null);

    // Focus the primary button on mount so if you hit "Enter" it'll copy the export.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        const modal = assertExists(modalRef.current);
        modal.focusPrimaryButton();
    }, []);

    return (
        <ModalWithButtons
            ref={modalRef}
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            onClose={onClose}
            shouldHideCancelButton={true}
            withoutCloseButton={true}
            // Carefully selected to fit 80 characters (which is the line width Prettier text
            // wraps our export to).
            maxWidth="34rem"
            buttonsPaddingX="7"
            buttonsPaddingBottom="5"
            primaryButtonLabel="Copy"
            primaryButtonPressErrorTitle="Couldn’t copy export"
            onPrimaryButtonPress={async () => {
                await writeTextToClipboard(string);
            }}
        >
            <GlobalKeyDownEvent
                onGlobalKeyDown={event => {
                    // Copy if you press enter while focused on the textarea.
                    if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();

                        const modal = assertExists(modalRef.current);
                        modal.pressPrimaryButton();
                    }
                }}
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
                        {format} export
                    </h2>
                    <Box
                        id={descriptionId}
                        paddingX="7"
                        paddingTop="2.5"
                        fontSize="75"
                        color="grey-70"
                        style={{lineHeight: 1.5}}
                    >
                        Press enter to copy the exported {format}.
                    </Box>
                </Box>
                <Spacer space="4" />
                <Box paddingX="7">
                    <Box position="relative" zIndex="0" borderRadius="1">
                        <Box
                            position="absolute"
                            zIndex="10"
                            inset="0"
                            borderRadius="1"
                            boxShadow="elevation-5-with-grey-10-border"
                            pointerEvents="none"
                        />
                        <Box
                            ref={useScrollbar()}
                            position="relative"
                            overflowX="hidden"
                            overflowY="auto"
                            maxHeight="64"
                        >
                            <Box
                                as="pre"
                                width="full"
                                paddingX="2"
                                paddingY="2.5"
                                fontStyle="code"
                                fontSize="25"
                                userSelect="text"
                                style={{
                                    cursor: "text",
                                    whiteSpace: "pre-wrap",
                                    wordBreak: "break-word",
                                }}
                                dangerouslySetInnerHTML={{__html: html}}
                                onPointerDown={event => {
                                    // Select everything in the export on click.

                                    event.preventDefault();

                                    const range = document.createRange();

                                    let firstTextNode = event.currentTarget as Node;
                                    while (firstTextNode.firstChild)
                                        firstTextNode = firstTextNode.firstChild;

                                    let lastTextNode = event.currentTarget as Node;
                                    while (lastTextNode.lastChild)
                                        lastTextNode = lastTextNode.lastChild;

                                    range.setStart(firstTextNode, 0);
                                    range.setEnd(
                                        lastTextNode,
                                        lastTextNode instanceof Text ? lastTextNode.data.length : 0,
                                    );

                                    const selection = window.getSelection();
                                    if (selection) {
                                        selection.removeAllRanges();
                                        selection.addRange(range);
                                    }
                                }}
                            />
                        </Box>
                    </Box>
                </Box>
                <Spacer space="5" />
            </GlobalKeyDownEvent>
        </ModalWithButtons>
    );
}
