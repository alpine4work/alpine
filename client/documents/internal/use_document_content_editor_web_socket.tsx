import murmurhash from "murmurhash";
import {Selection, TextSelection} from "prosemirror-state";
import {Mapping} from "prosemirror-transform";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {ContentEditorPhantomSelection} from "~/client/content/content_editor";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useAppContext} from "~/client/context/app_context";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {DocumentContentEditorWebSocketClient} from "~/client/documents/internal/document_content_editor_web_socket_client";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {useStore} from "~/client/helpers/store/use_store";
import {DocumentContentProsemirrorSchema} from "~/shared/content/document_content_schema";
import {defaultThemeColor, themeColors} from "~/shared/design/theme_colors";
import {WebSocketConnectionId} from "~/shared/id/types/id_types";
import {DocumentContentWithReferences, DocumentModel} from "~/shared/models/document_model";

export function useDocumentContentEditorWebSocket(initialDocument: DocumentModel) {
    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    // We use `useState()` here instead of `useMemo()` since we don't want the
    // client to change when `initialDocument` changes.
    const [client] = useState(
        () => new DocumentContentEditorWebSocketClient(() => contextRef.current, initialDocument),
    );

    const [shouldConnect, setShouldConnect] = useState(true);

    useEffect(() => {
        if (!client || !shouldConnect) return;

        client.connect();
        return () => client.disconnect();
    }, [client, shouldConnect]);

    const toggleShouldConnect = useCallback(() => {
        setShouldConnect(shouldConnect => !shouldConnect);
    }, []);

    const state = useStore(client.state);

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (state.errorState.hasError) throw state.errorState.error;

    // The presence states we get from our presence channel may be outdated because
    // when the document updates and the cursor needs to move, we do not send a
    // `UpdateOtherPresenceState` update as this would cause a thundering herd of
    // presence updates on every content update.
    //
    // There may be some performance optimizations we could be doing here. If you
    // have 100 cursors but only 1 is moving you only need to recompute that 1.
    const presenceStates = useMemo(() => {
        let presenceStates: Array<{
            connectionId: WebSocketConnectionId;
            selection: Selection;
        }> = [];

        for (const [connectionId, presenceState] of state.otherPresenceStateByConnectionId) {
            /* ========================================================================== *\
             * 1. Fast-forward outdated presence states if we can, otherwise drop         *
            \* ========================================================================== */

            const editorVersion = state.editorState.getVersion();

            // If the presence state version is equal to our editor version, then we don't
            // need to transform the selection.
            if (presenceState.version === editorVersion) {
                presenceStates.push({
                    connectionId,
                    selection: presenceState.selection.getAndMaybeDeserialize(
                        state.editorState.getDocWithoutSendableSteps(),
                    ),
                });
            }
            // We don't update presence states if the document changes but the selection
            // doesn't move. Instead clients are responsible for updating selections that
            // didn't move to the new document locally.
            //
            // We may not have enough `rememberedSteps` to fast-forward the presence state.
            // In this case we will drop the presence state. We then fetch
            // steps required to fast-forward the presence state asynchronously.
            //
            // It's important that we record `smallestPresenceStateVersion` before this
            // step since we're about to update all our presence state versions.
            else if (
                presenceState.version < editorVersion &&
                presenceState.version >= editorVersion - state.rememberedSteps.length
            ) {
                const oldContent =
                    state.rememberedSteps[
                        state.rememberedSteps.length - (editorVersion - presenceState.version)
                    ]!.contentBeforeStep.get();

                let selection = presenceState.selection.getAndMaybeDeserialize(oldContent);

                for (let version = presenceState.version; version < editorVersion; version++) {
                    if (!selection) break;

                    const {stepMap, contentAfterStep} =
                        state.rememberedSteps[
                            state.rememberedSteps.length - (editorVersion - version)
                        ]!;

                    selection = selection.map(contentAfterStep.get(), stepMap);
                }

                presenceStates.push({
                    connectionId,
                    selection,
                });
            } else {
                // The remaining cases here are:
                //
                // 1. Presence states at a future version. (Should not happen.)
                // 2. Presence states that we couldn't catch because we don't have enough
                //    `rememberedSteps`. Our backfill should have given us all the steps we
                //    need though.
                //
                // We are ok dropping these presence states.
            }
        }

        /* ========================================================================== *\
         * 2. Apply local, unconfirmed, steps to presence states                      *
        \* ========================================================================== */

        // Other clients do not know about our local, unconfirmed, steps in
        // `sendableSteps()`. So we need to apply those steps to every single presence
        // state.
        const sendableSteps = state.editorState.sendableSteps();
        if (sendableSteps) {
            const doc = state.editorState.getDoc();

            const mapping = new Mapping();
            for (const step of sendableSteps.steps) mapping.appendMap(step.getMap());

            presenceStates = presenceStates.map(presenceState => ({
                connectionId: presenceState.connectionId,
                selection: presenceState.selection.map(doc, mapping),
            }));
        }

        return presenceStates;
    }, [state.editorState, state.otherPresenceStateByConnectionId, state.rememberedSteps]);

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    const phantomSelections = useMemo(() => {
        const phantomSelections: Array<ContentEditorPhantomSelection> = [];

        const filteredThemeColors = themeColors.filter(
            // TODO(calebmer): When the theme color is configurable, we should use that
            // instead of the default theme color.
            themeColor => themeColor !== defaultThemeColor && themeColor !== "yellow",
        );

        for (const presenceState of presenceStates) {
            const color =
                filteredThemeColors[
                    murmurhash.v3(presenceState.connectionId) % filteredThemeColors.length
                ]!;

            phantomSelections.push({
                key: presenceState.connectionId,
                color,
                anchor: presenceState.selection.anchor,
                head: presenceState.selection.head,
                isTextSelection: presenceState.selection instanceof TextSelection,
            });
        }

        return phantomSelections;
    }, [presenceStates]);

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

    return {
        editorState: state.editorState,
        onChangeEditorState: (editorState: ContentEditorState<DocumentContentWithReferences>) =>
            client.changeEditorState(editorState),
        phantomSelections,
    };
}
