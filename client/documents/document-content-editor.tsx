import murmurhash from "murmurhash";
import Head from "next/head";
import {TextSelection} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {useEffect, useMemo, useReducer, useState} from "react";
import {
    ContentEditor,
    ContentEditorPhantomTextSelection,
    ContentEditorState,
} from "~/client/content/content-editor";
import {sprinkles} from "~/client/design/sprinkles.css";
import {useNetworkChannel} from "~/client/network/use-network-channel";
import {useNetworkPresenceChannel} from "~/client/network/use-network-presence-channel";
import {defaultThemeColor} from "~/shared/design/color-scheme.css";
import {themeColors} from "~/shared/design/theme-colors";
import {DocumentContent} from "~/shared/documents/document-content-schema";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document-model";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id} from "~/shared/id/id";
import {
    DocumentChannel,
    DocumentEditorPresenceChannel,
    updateDocumentContent,
} from "~/shared/network/documents-network-definition";

type State = {
    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContent>;
    /**
     * The current text selection to broadcast over presence and the version at
     * which the selection was recorded.
     *
     * We only broadcast a selection update when the user makes a change to keep
     * the number of updates low. Other clients will rebase the selection forward
     * to display it on their editor.
     */
    readonly presenceSelection: {
        readonly version: number;
        readonly selection: TextSelection;
    } | null;
    /**
     * We may get `ReceiveSteps` actions out of order. If we see an action for a
     * future version we put it in this array and re-apply the action when older
     * steps are applied.
     */
    readonly pendingActions: Array<ReceiveStepsAction>;
};

function getInitialState(initialDocument: DocumentModel): State {
    const editorState = ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });

    return {
        editorState,
        presenceSelection: null,
        pendingActions: [],
    };
}

type Action = EditAction | ReceiveStepsAction;

type EditAction = {
    readonly type: "Edit";
    readonly editorState: ContentEditorState<DocumentContent>;
};

type ReceiveStepsAction = {
    readonly type: "ReceiveSteps";
    readonly newVersion: number;
    readonly steps: ReadonlyArray<{readonly step: Step; readonly clientId: Id}>;
};

function reduce(state: State, action: Action): State {
    const oldVersion = state.editorState.getVersion();
    state = reduceWithAction(state, action);
    const newVersion = state.editorState.getVersion();

    // If the version changed then we want to retry our pending actions since they
    // may be ok to run now.
    if (oldVersion === newVersion) return state;

    // We may receive actions out of order, but make sure we run them in order
    // now.
    const pendingActions = [...state.pendingActions].sort((pendingAction1, pendingAction2) => {
        const baseVersion1 = pendingAction1.newVersion - pendingAction1.steps.length;
        const baseVersion2 = pendingAction2.newVersion - pendingAction2.steps.length;
        return baseVersion1 - baseVersion2;
    });

    // We are going to try and run all pending actions. If actions are still
    // pending they will be put back into this array.
    state = {...state, pendingActions: []};

    return pendingActions.reduce(reduceWithAction, state);
}

function reduceWithAction(state: State, action: Action): State {
    switch (action.type) {
        case "Edit": {
            const textSelection = action.editorState.getTextSelection();

            return {
                ...state,
                editorState: action.editorState,
                presenceSelection: textSelection
                    ? {
                          version: action.editorState.getVersion(),
                          selection: textSelection,
                      }
                    : null,
            };
        }
        case "ReceiveSteps": {
            const oldVersion = state.editorState.getVersion();
            if (action.newVersion <= oldVersion) return state;

            // If we received an action that's applied on a future version of our content,
            // we can't commit it until our local state has caught up. So stick it in
            // pending actions and we'll come back to it.
            if (oldVersion < action.newVersion - action.steps.length) {
                return {
                    ...state,
                    pendingActions: [...state.pendingActions, action],
                };
            }

            // We may dispatch this action multiple times with the same steps. Remove any
            // steps we've already seen.
            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0) return state;

            let editorState = state.editorState;
            let stepTransaction: Array<{step: Step; clientId: Id}> = [];

            // `prosemirror-collab` needs steps from our `clientId` to be at the beginning
            // of the `receiveSteps()` call. So call `receiveSteps()` whenever the
            // `clientId` of our steps change.
            //
            // Arguably, this is a bug in `prosemirror-collab`.
            //
            // Here is the code which requires our steps to be first this:
            // https://github.com/ProseMirror/prosemirror-collab/blob/94df0cc9288960e7e64dc9721abbf8f656df444f/src/collab.ts#L125-L129
            for (const {step, clientId} of steps) {
                if (
                    stepTransaction.length > 0 &&
                    stepTransaction[stepTransaction.length - 1]!.clientId !== clientId
                ) {
                    editorState = editorState.receiveSteps(stepTransaction);
                    stepTransaction = [];
                }

                stepTransaction.push({step, clientId});
            }

            editorState = editorState.receiveSteps(stepTransaction);
            stepTransaction = [];

            return {...state, editorState};
        }
        default:
            throw exhaustive(action);
    }
}

export function DocumentContentEditor({document}: {document: DocumentModel}) {
    return (
        <DocumentContentEditorStateful
            // If a document prop with a different version is passed in then remount our
            // stateful content editor component.
            key={document.version}
            initialDocument={document}
        />
    );
}

function DocumentContentEditorStateful({initialDocument}: {initialDocument: DocumentModel}) {
    const documentId = initialDocument.id;

    const [isUpdating, setIsUpdating] = useState(false);
    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    useEffect(() => {
        // If we're already updating then don't send another update mutation. Once
        // the current mutation is done we'll send another.
        if (isUpdating || errorState.hasError) return;

        // If there are no new sendable steps from this client then don’t send a
        // mutation.
        const sendableSteps = state.editorState.sendableSteps();
        if (!sendableSteps) return;
        const {version, steps, clientId} = sendableSteps;

        runPromiseWithoutAwaiting(async () => {
            setIsUpdating(true);
            try {
                const {newVersion, newSteps, conflictingSteps} = await updateDocumentContent({
                    id: documentId,
                    version,
                    steps,
                    clientId,
                });

                dispatch({
                    type: "ReceiveSteps",
                    newVersion,
                    steps: [...conflictingSteps, ...newSteps.map(step => ({step, clientId}))],
                });
            } catch (error) {
                setErrorState({hasError: true, error});
            } finally {
                setIsUpdating(false);
            }
        });

        // This effect intentionally doesn’t have a dependency array. It shouldn't
        // need one for correctness.
    });

    useNetworkChannel(DocumentChannel, {documentId}, message => {
        dispatch({
            type: "ReceiveSteps",
            newVersion: message.newVersion,
            steps: message.steps.map(step => ({
                step,
                clientId: message.clientId,
            })),
        });
    });

    // TODO(calebmer): The pricing limits on presence from Ably are...not great. We
    // probably need to migrate presence to Cloudflare Workers eventually.
    // https://faqs.ably.com/why-do-you-have-a-limit-on-the-number-of-members-present-on-a-channel
    const presenceStates = useNetworkPresenceChannel(
        DocumentEditorPresenceChannel,
        {documentId},
        state.presenceSelection
            ? {
                  version: state.presenceSelection.version,
                  selection: {
                      anchor: state.presenceSelection.selection.$anchor.pos,
                      head: state.presenceSelection.selection.$head.pos,
                  },
              }
            : null,
    );

    // Transform the presence states of our connected clients into cursor
    // decorations. We drop any cursors from before our document loaded because we
    // don't have the steps to map their positions.
    //
    // TODO(calebmer): Load older steps from the backend so we can map cursors at
    // older positions.
    const phantomTextSelections = useMemo(() => {
        const phantomTextSelections: Array<ContentEditorPhantomTextSelection> = [];

        const filteredThemeColors = themeColors.filter(
            // TODO(calebmer): When the theme color is configurable, we should use that
            // instead of the default theme color.
            themeColor => themeColor !== defaultThemeColor && themeColor !== "yellow",
        );

        for (const presenceState of presenceStates) {
            if (presenceState.version !== state.editorState.getVersion()) continue;

            const color =
                filteredThemeColors[murmurhash.v3(presenceState.key) % filteredThemeColors.length]!;

            phantomTextSelections.push({
                key: presenceState.key,
                color,
                anchor: presenceState.selection.anchor,
                head: presenceState.selection.head,
            });
        }

        return phantomTextSelections;
    }, [presenceStates, state.editorState]);

    return (
        <>
            <Head>
                <title>{getDocumentContentTitle(state.editorState.getContent())}</title>
            </Head>
            <ContentEditor
                state={state.editorState}
                onChange={editorState => dispatch({type: "Edit", editorState})}
                aria-label="Document editor"
                placeholder="Share your ideas…"
                className={sprinkles({paddingBottom: "24"})}
                phantomTextSelections={phantomTextSelections}
            />
        </>
    );
}
