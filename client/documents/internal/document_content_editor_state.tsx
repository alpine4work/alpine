import {Step} from "prosemirror-transform";
import {useEffect, useMemo, useReducer, useRef, useState} from "react";
import {ContentEditorState} from "~/client/content/content_editor_state";
import {useWebSocket} from "~/client/helpers/use_web_socket";
import {
    DocumentCollaborationMessageFromClientSchema,
    DocumentCollaborationMessageFromServerSchema,
} from "~/shared/documents/document_collaboration_schema";
import {DocumentContent} from "~/shared/documents/document_content_schema";
import {DocumentModel} from "~/shared/documents/document_model";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {Id, generateId} from "~/shared/id/id";

type State = {
    /**
     * We may get `ReceiveSteps` actions out of order (e.g. the server sends an
     * `UpdateContent` message before a `BackfillResponse` message). If we see an
     * action for a future version we put it in this array and re-apply the action
     * when older steps are applied.
     */
    readonly pendingActions: Array<ReceiveStepsAction>;
    /**
     * The current state of the editor.
     */
    readonly editorState: ContentEditorState<DocumentContent>;
    /**
     * Steps we have sent to the server which we are waiting on
     * acknowledgement for.
     */
    readonly pendingSendableSteps: {
        readonly steps: ReadonlyArray<Step>;
        readonly clientId: Id;
        readonly version: number;
        readonly messageId: Id;
    } | null;
};

function getInitialState(initialDocument: DocumentModel): State {
    const editorState = ContentEditorState.createCollab({
        version: initialDocument.version,
        content: initialDocument.content,
    });

    return {
        pendingActions: [],
        editorState,
        pendingSendableSteps: null,
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
    readonly acknowledgeMessageId: Id | null;
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

function reduceWithAction(oldState: State, action: Action): State {
    switch (action.type) {
        case "Edit": {
            if (oldState.pendingSendableSteps) {
                return {
                    ...oldState,
                    editorState: action.editorState,
                };
            }

            const pendingSendableSteps = action.editorState.sendableSteps();
            return {
                ...oldState,
                editorState: action.editorState,
                pendingSendableSteps: pendingSendableSteps
                    ? {
                          steps: pendingSendableSteps.steps,
                          version: pendingSendableSteps.version,
                          clientId: pendingSendableSteps.clientId,
                          messageId: generateId(),
                      }
                    : null,
            };
        }
        case "ReceiveSteps": {
            const oldVersion = oldState.editorState.getVersion();
            if (action.newVersion <= oldVersion) return oldState;

            // We may dispatch this action multiple times with the same steps. Remove any
            // steps we've already seen.
            const steps = action.steps.slice(action.steps.length - action.newVersion - oldVersion);
            assert(oldVersion + steps.length === action.newVersion);

            // If we've already seen all the steps, no change is needed.
            if (steps.length === 0) return oldState;

            let editorState = oldState.editorState;
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

            return {
                ...oldState,
                editorState,
                pendingSendableSteps:
                    oldState.pendingSendableSteps?.messageId === action.acknowledgeMessageId
                        ? null
                        : oldState.pendingSendableSteps,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function useDocumentContentEditorState(initialDocument: DocumentModel) {
    const documentId = initialDocument.id;

    const [state, dispatch] = useReducer(reduce, initialDocument, getInitialState);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // TODO(calebmer): We probably want some retry mechanism for the user? But
    // until the user retries, we don't want an infinite loop where we keep trying
    // to update the document content.
    if (errorState.hasError) throw errorState.error;

    const {isConnected, sendMessage} = useWebSocket(
        DocumentCollaborationMessageFromClientSchema,
        DocumentCollaborationMessageFromServerSchema,
        `/durable-objects/documents/${documentId}`,
        message => {
            switch (message.type) {
                case "BackfillResponse": {
                    dispatch({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps,
                        acknowledgeMessageId: null,
                    });
                    break;
                }
                case "UpdateContentWithoutPersistence": {
                    dispatch({
                        type: "ReceiveSteps",
                        newVersion: message.newVersion,
                        steps: message.steps.map(step => ({
                            step,
                            clientId: message.clientId,
                        })),
                        acknowledgeMessageId: message.acknowledgeMessageId,
                    });
                    break;
                }
                case "PersistedContent": {
                    // TODO(calebmer): Show a saving indicator until content has persisted!
                    break;
                }
                case "Error": {
                    setErrorState({
                        hasError: true,
                        error: message.error,
                    });
                    break;
                }
                default:
                    throw exhaustive(message);
            }
        },
    );

    const versionRef = useRef(state.editorState.getVersion());
    useEffect(() => {
        versionRef.current = state.editorState.getVersion();
    });

    // Whenever we successfully connect to the WebSocket, send a backfill request
    // so we can get any steps we missed while disconnected from the WebSocket.
    useEffect(() => {
        if (isConnected) {
            sendMessage({
                type: "BackfillRequest",
                version: versionRef.current,
            });
        }

        // NOTE(calebmer): Be careful about what you put into this dependency array! We
        // only want to re-run this effect when the `isConnected` flag flips.
    }, [isConnected, sendMessage]);

    useEffect(() => {
        // TODO(calebmer): If we disconnect then reconnect we will retry
        // `UpdateContent`. We should make sure `UpdateContent` is idempotent! If we
        // have an idempotent update, we still need to acknowledge the message so the
        // client can send more updates. Handle this.
        if (isConnected && state.pendingSendableSteps) {
            sendMessage({
                type: "UpdateContent",
                version: state.pendingSendableSteps.version,
                steps: state.pendingSendableSteps.steps,
                clientId: state.pendingSendableSteps.clientId,
                messageId: state.pendingSendableSteps.messageId,
            });
        }

        // NOTE(calebmer): Be careful about what you put into this dependency array! We
        // only want to re-run this effect when `pendingSendableSteps` changes. Or when
        // we disconnect then reconnect.
    }, [isConnected, sendMessage, state.pendingSendableSteps]);

    return {
        editorState: state.editorState,
        onChangeEditorState: (editorState: ContentEditorState<DocumentContent>) =>
            dispatch({type: "Edit", editorState}),
        phantomTextSelections: useMemo(() => [], []),
    };
}
