import {useEffect, useMemo, useRef, useState} from "react";
import {useParams} from "react-router";
import {getContentEditorMobileKeyboardSubstituteClosingAnimationPromise} from "~/client/content/get_content_editor_mobile_keyboard_substitute_closing_animation_promise.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {navigationBarHeight} from "~/client/design/navigation_bar.js";
import {Spacer} from "~/client/design/spacer.js";
import {TextInput} from "~/client/design/text_input.js";
import {MobileContentEditorLinkRouteStateSchema} from "~/client/remix/mobile_content_editor_link_route_state.js";
import {NativeMobileBridge} from "~/client/remix/native_mobile_bridge.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";

// NOTE(calebmer): Apps like Google Docs put a search under the URL input to
// allow easy linking to headings or other docs. Could be nice to have this
// capability too.

export function meta() {
    return [{title: `Insert Link${metaTitlePostfix}`}];
}

export async function clientLoader() {
    // Wait for the keyboard substitute closing animation to finish before finally
    // navigating to our link route.
    await getContentEditorMobileKeyboardSubstituteClosingAnimationPromise();
}

export default function MobileEditorLinkRoute() {
    const params = useParams();
    const navigate = useNavigate();

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
            NativeMobileBridge.navigation.scheduleAfterPushAnimation(() => {
                urlInputRef.current?.focus();
                urlInputRef.current?.select();
            });
        }
    }, []);

    // Parse state from the URL.
    const state = useMemo(
        () => MobileContentEditorLinkRouteStateSchema.deserialize(params.state ?? ""),
        [params.state],
    );

    const [text, setText] = useState(state.initialText);
    const [url, setUrl] = useState(state.initialUrl);

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
                <Button
                    fontSize="100"
                    pressErrorTitle="Couldn’t go back"
                    onPress={() => navigate(-1)}
                >
                    Cancel
                </Button>
                <Box fontSize="100" fontStyle="semi-bold">
                    Insert Link
                </Box>
                <Button fontSize="100">Save</Button>
            </Box>
            <Box paddingX="4">
                <Spacer space="8" />
                <TextInput
                    // Don't auto-capitalize since this may be a snippet of text in a
                    // longer sentence.
                    autoCapitalize="none"
                    fontSize="100"
                    label="Text"
                    isReadOnly={!state.isTextEditable}
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
