import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";

// NOTE(calebmer): Apps like Google Docs put a search under the URL input to
// allow easy linking to headings or other docs. Could be nice to have this
// capability too.

export type ContentEditorMobileLinkRouteState = {
    readonly initialText: string;
    readonly isTextEditable: boolean;
    readonly initialUrl: string;
};

export function ContentEditorMobileLinkRoute({
    initialText,
    isTextEditable,
    initialUrl,
    onCancel,
}: {
    initialText: string;
    isTextEditable: boolean;
    initialUrl: string;
    onCancel: () => void;
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

    const [text, setText] = useState(initialText);
    const [url, setUrl] = useState(initialUrl);

    return (
        <Box width="full">
            <Box style={{paddingTop: "var(--safe-area-inset-top, 0px)"}} />
            <Box
                height={navigationBarHeight}
                paddingX="3"
                display="flex"
                justifyContent="space-between"
                alignItems="center"
            >
                <Button fontSize="100" pressErrorTitle="Couldn’t go back" onPress={onCancel}>
                    Cancel
                </Button>
                <Box fontSize="100" fontStyle="semi-bold">
                    Insert Link
                </Box>
                <Button fontSize="100" isDisabled={true}>
                    Save
                </Button>
            </Box>
            <Box paddingX="4">
                <Spacer space="8" />
                <TextInput
                    // Don't auto-capitalize since this may be a snippet of text in a
                    // longer sentence.
                    autoCapitalize="none"
                    fontSize="100"
                    label="Text"
                    isReadOnly={!isTextEditable}
                    value={text}
                    onChange={setText}
                />
                <Spacer space="5" />
                <TextInput
                    ref={urlInputRef}
                    inputMode="url"
                    fontSize="100"
                    label="URL"
                    placeholder="https://example.com"
                    value={url}
                    onChange={setUrl}
                />
            </Box>
        </Box>
    );
}
