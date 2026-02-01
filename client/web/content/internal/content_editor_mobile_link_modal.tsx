import {Fragment, Slice} from "prosemirror-model";
import {EditorView} from "prosemirror-view";
import {RefObject, useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {navigationBarHeight} from "~/client/web/design/navigation_bar_helpers.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {NativeMobileBridge} from "~/client/web/remix/native_mobile_bridge.js";
import {screenPaddingX, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";

// NOTE(calebmer): Apps like Google Docs put a search under the URL input to
// allow easy linking to headings or other docs. Could be nice to have this
// capability too.

export type ContentEditorMobileLinkModalState = {
    readonly initialText: string;
    readonly isTextEditable: boolean;
    readonly initialUrl: string;
};

export function ContentEditorMobileLinkModal({
    viewRef,
    initialText,
    isTextEditable,
    initialUrl,
    onCloseWithAnimation,
}: {
    viewRef: RefObject<EditorView | null>;
    initialText: string;
    isTextEditable: boolean;
    initialUrl: string;
    onCloseWithAnimation: () => void;
}) {
    const urlInputRef = useRef<HTMLInputElement>(null);

    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        if (!NativeMobileBridge) {
            urlInputRef.current?.focus();
            urlInputRef.current?.select();
        } else {
            // Focus input after the push animation finishes. Otherwise the web view may
            // not be mounted to the screen.
            NativeMobileBridge.navigation.scheduleAfterAnimation(() => {
                urlInputRef.current?.focus();
                urlInputRef.current?.select();
            });
        }
    }, []);

    const [{text, hasTextChanged}, setTextState] = useState({
        text: initialText,
        hasTextChanged: false,
    });
    const [{url, hasUrlChanged}, setUrlState] = useState({url: initialUrl, hasUrlChanged: false});

    const save = () => {
        const view = assertExists(viewRef.current);
        const {state} = view;
        const schema = state.doc.type.schema;
        const linkMarkType = assertExists(schema.marks.link);

        // If the URL the user typed does not have a protocol then add `https://`.
        const finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;

        if (isTextEditable && hasTextChanged) {
            const selectionSlice = state.selection.content();

            let textNode = selectionSlice.content.firstChild;
            let count = selectionSlice.openStart;
            while (textNode && count > 0) {
                count--;
                textNode = textNode.firstChild;
            }

            let marks = textNode?.marks ?? [];

            if (hasUrlChanged) {
                if (url === "") {
                    marks = linkMarkType.removeFromSet(marks);
                } else {
                    marks = linkMarkType.create({url: finalUrl}).addToSet(marks);
                }
            }

            view.dispatch(
                state.tr.replaceSelection(
                    new Slice(Fragment.from([schema.text(text, marks)]), 0, 0),
                ),
            );
        } else if (hasUrlChanged) {
            if (url === "") {
                view.dispatch(
                    state.tr.removeMark(state.selection.from, state.selection.to, linkMarkType),
                );
            } else {
                // If the URL the user typed does not have a protocol then add `https://`.
                const finalUrl = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;

                view.dispatch(
                    state.tr.addMark(
                        state.selection.from,
                        state.selection.to,
                        linkMarkType.create({url: finalUrl}),
                    ),
                );
            }
        }

        onCloseWithAnimation();
    };

    return (
        <Box data-testid="ContentEditorMobileLinkModal" width="full">
            <Box paddingTop="safe-area-inset" />
            <Box
                height={navigationBarHeight}
                paddingX="3"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
                onPointerDownCapture={event => {
                    // Don't unfocus the input when our cancel or save button is pressed! We want to
                    // return focus to the underlying content editor without closing the virtual
                    // keyboard.
                    event.preventDefault();
                }}
            >
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-start"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        // Not focusable since we want to return focus to the underlying content editor
                        // when the button is pressed. The button itself should not be focused. If you
                        // have a keyboard you can use keyboard shortcuts instead of tabbing into these
                        // buttons.
                        isFocusable={false}
                        paddingX="2"
                        fontSize="100"
                        pressErrorTitle="Couldn&#x2019;t cancel"
                        onPress={onCloseWithAnimation}
                    >
                        Cancel
                    </Button>
                </Box>
                <Box fontSize="100" fontStyle="semi-bold">
                    Insert link
                </Box>
                <Box
                    flexGrow="1"
                    display="flex"
                    justifyContent="flex-end"
                    style={{flexBasis: spacing["10"]}}
                >
                    <Button
                        // Not focusable since we want to return focus to the underlying content editor
                        // when the button is pressed. The button itself should not be focused. If you
                        // have a keyboard you can use keyboard shortcuts instead of tabbing into these
                        // buttons.
                        isFocusable={false}
                        paddingX="2"
                        fontSize="100"
                        isDisabled={!hasTextChanged && !hasUrlChanged}
                        onPress={save}
                    >
                        Save
                    </Button>
                </Box>
            </Box>
            <Box paddingX={screenPaddingX}>
                <Spacer space="5" />
                <TextInput
                    // Don't auto-capitalize since this may be a snippet of text in a
                    // longer sentence.
                    autoCapitalize="none"
                    fontSize="100"
                    label="Text"
                    isReadOnly={!isTextEditable}
                    value={text}
                    onChange={text => setTextState({text, hasTextChanged: true})}
                    onEnter={save}
                />
                <Spacer space="5" />
                <TextInput
                    ref={urlInputRef}
                    inputMode="url"
                    fontSize="100"
                    label="URL"
                    placeholder="https://example.com"
                    value={url}
                    onChange={url => setUrlState({url, hasUrlChanged: true})}
                    onEnter={save}
                />
            </Box>
        </Box>
    );
}
