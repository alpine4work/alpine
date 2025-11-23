import murmurhash from "murmurhash";
import {Selection, TextSelection} from "prosemirror-state";
import {Mapping, StepMap} from "prosemirror-transform";
import {useMemo} from "react";
import {ContentEditorPhantomSelection} from "~/client/web/content/content_editor.js";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {trimSelectionInvisibleExtensionIntoAdjacentNodes} from "~/client/web/content/state/trim_selection_invisible_extension_into_adjacent_nodes.js";
import {defaultThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {DocumentCollaborationPresenceState} from "~/shared/documents/document_collaboration_protocol.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable_map.js";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";

export function useDocumentContentEditorPhantomSelections({
    editorState,
    otherPresenceStateByConnectionId,
    rememberedSteps,
}: {
    editorState: ContentEditorState<DocumentContentWithReferences>;
    otherPresenceStateByConnectionId: ImmutableMap<
        WebSocketConnectionId,
        DocumentCollaborationPresenceState
    >;
    rememberedSteps: ReadonlyArray<{
        readonly stepMap: StepMap;
        readonly contentBeforeStep: Lazy<DocumentContent>;
        readonly contentAfterStep: Lazy<DocumentContent>;
    }>;
}) {
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

        for (const [connectionId, presenceState] of otherPresenceStateByConnectionId) {
            /* ========================================================================== *\
             * 1. Fast-forward outdated presence states if we can, otherwise drop         *
            \* ========================================================================== */

            const editorVersion = editorState.getVersion();

            // If the presence state version is equal to our editor version, then we don't
            // need to transform the selection.
            if (presenceState.version === editorVersion) {
                presenceStates.push({
                    connectionId,
                    selection: presenceState.selection.getAndMaybeDeserialize(
                        editorState.getDocWithoutSendableSteps(),
                    ),
                });
            }
            // We don't update presence states if the document changes but the selection
            // doesn't move. Instead clients are responsible for updating selections that
            // didn't move to the new document locally.
            //
            // We may not have enough `rememberedSteps` to fast-forward the presence
            // In this case we will drop the presence  We then fetch
            // steps required to fast-forward the presence state asynchronously.
            //
            // It's important that we record `smallestPresenceStateVersion` before this
            // step since we're about to update all our presence state versions.
            else if (
                presenceState.version < editorVersion &&
                presenceState.version >= editorVersion - rememberedSteps.length
            ) {
                const oldContent =
                    rememberedSteps[
                        rememberedSteps.length - (editorVersion - presenceState.version)
                    ]!.contentBeforeStep.get();

                let selection = presenceState.selection.getAndMaybeDeserialize(oldContent);

                for (let version = presenceState.version; version < editorVersion; version++) {
                    if (!selection) break;

                    const {stepMap, contentAfterStep} =
                        rememberedSteps[rememberedSteps.length - (editorVersion - version)]!;

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
                // 2. Presence states that we couldn't catch up because we don't have enough
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
        const sendableSteps = editorState.sendableSteps();
        if (sendableSteps) {
            const doc = editorState.getDoc();

            const mapping = new Mapping();
            for (const step of sendableSteps.steps) mapping.appendMap(step.getMap());

            presenceStates = presenceStates.map(presenceState => ({
                connectionId: presenceState.connectionId,
                selection: presenceState.selection.map(doc, mapping),
            }));
        }

        return presenceStates;
    }, [editorState, otherPresenceStateByConnectionId, rememberedSteps]);

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    const phantomSelections = useMemo(() => {
        const phantomSelections: Array<ContentEditorPhantomSelection> = [];

        const filteredThemeColors = themeColors.filter(
            // TODO(calebmer): When the theme color is configurable, we should use that
            // instead of `defaultThemeColor`.
            themeColor =>
                themeColor !== defaultThemeColor &&
                themeColor !== "yellow" &&
                // If our theme color is a shade of blue then don't allow selecting a color for
                // phantom cursors that's also a shade of blue.
                !(
                    (defaultThemeColor === "cyan" ||
                        defaultThemeColor === "blue" ||
                        defaultThemeColor === "indigo") &&
                    (themeColor === "cyan" || themeColor === "blue" || themeColor === "indigo")
                ),
        );

        for (const presenceState of presenceStates) {
            const color =
                filteredThemeColors[
                    murmurhash.v3(presenceState.connectionId) % filteredThemeColors.length
                ]!;

            const trimmedSelection = trimSelectionInvisibleExtensionIntoAdjacentNodes(
                presenceState.selection,
            );

            phantomSelections.push({
                key: presenceState.connectionId,
                color,
                $anchor:
                    presenceState.selection.anchor < presenceState.selection.head
                        ? trimmedSelection.$from
                        : trimmedSelection.$to,
                $head:
                    presenceState.selection.anchor < presenceState.selection.head
                        ? trimmedSelection.$to
                        : trimmedSelection.$from,
                isTextSelection: presenceState.selection instanceof TextSelection,
            });
        }

        return phantomSelections;
    }, [presenceStates]);

    return phantomSelections;
}
