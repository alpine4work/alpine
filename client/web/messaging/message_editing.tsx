import {Transaction} from "prosemirror-state";
import {Step} from "prosemirror-transform";
import {Memo, MutableRefObject, ReactNode, useEffect, useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/web/content/state/content_editor_state.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useEvent} from "~/client/web/helpers/lifecycle/use_event.js";
import {MessageDeleteConfirmationDialog} from "~/client/web/messaging/internal/message_delete_confirmation_dialog.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {trimContentFragmentEndPos} from "~/shared/content/trim_content.js";
import {Platform} from "~/shared/design/core/platform.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    LinkedList,
    forEachLinkedList,
    reverseLinkedList,
} from "~/shared/helpers/immutable/linked_list.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageContentPayloadModel} from "~/shared/messaging/message_model.js";

export type MessageEditingState<RoomKey extends string> =
    | {
          readonly isEditing: false;
      }
    | ({
          readonly isEditing: true;
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly contentVersion: number;
          readonly contentEditorState: ContentEditorState<MessageContentWithReferences>;
          // We use `LinkedList` for O(1) insertion whenever the content changes.
          readonly contentSteps: LinkedList<ReadonlyArray<Step>>;
          readonly initialContent: MessageContent;
          readonly confirmationDialog: "Save" | "Delete" | null;
          readonly returnFocusAfterEditing: (() => void) | null;
      } & (
          | {
                readonly isSaving: false;
            }
          | {
                readonly isSaving: true;
                readonly isAwaitingSaveRef: MutableRefObject<boolean>;
                readonly savePromiseResolver: PromiseResolver<void> | null;
            }
      ));

export type MessageEditingAction<RoomKey extends string> =
    | {
          readonly type: "StartEditing";
          readonly messageRoomKey: RoomKey;
          readonly messageIndex: number;
          readonly messagePayload: MessageContentPayloadModel;
          readonly platform: Platform;
          readonly returnFocusAfterEditing: (() => void) | null;
      }
    | {
          readonly type: "ContentEditorStateChange";
          readonly state: ContentEditorState<MessageContentWithReferences>;
          readonly transaction: Transaction;
      }
    | {
          readonly type: "CancelEditing";
      }
    | {
          readonly type: "MaybeCancelEditing";
      }
    | {
          readonly type: "CloseConfirmingDialog";
          readonly confirmationDialog: "Save" | "Delete";
      }
    | {
          readonly type: "SaveEditedContent";
          readonly savePromiseResolver?: PromiseResolver<void>;
      }
    | {
          readonly type: "FinishedSavingContent";
          readonly shouldCancelEditing: boolean;
      };

function reduce<RoomKey extends string>(
    state: MessageEditingState<RoomKey>,
    action: MessageEditingAction<RoomKey>,
): MessageEditingState<RoomKey> {
    switch (action.type) {
        case "StartEditing": {
            return {
                isEditing: true,
                messageRoomKey: action.messageRoomKey,
                messageIndex: action.messageIndex,
                contentVersion: action.messagePayload.contentUpdate?.mappings.length ?? 0,
                contentEditorState: ContentEditorState.create(action.messagePayload.content, {
                    // The user is much more likely to need to edit from the end of the message than
                    // the start. But on mobile, if the message is long, editing should start at the
                    // start of the message so the cursor is visible.
                    selection: action.platform === "mobile" ? "start" : "end",
                }),
                contentSteps: null,
                initialContent: action.messagePayload.content.doc,
                returnFocusAfterEditing: action.returnFocusAfterEditing,
                isSaving: false,
                confirmationDialog: null,
            };
        }
        case "ContentEditorStateChange": {
            if (!state.isEditing || state.isSaving) return state;

            return {
                ...state,
                contentEditorState: action.state,
                contentSteps: {value: action.transaction.steps, next: state.contentSteps},
            };
        }
        case "CancelEditing": {
            return {
                isEditing: false,
            };
        }
        case "MaybeCancelEditing": {
            if (!state.isEditing || state.isSaving || state.confirmationDialog !== null)
                return state;

            if (state.contentEditorState.getDoc() === state.initialContent) {
                return {
                    isEditing: false,
                };
            } else {
                return {
                    ...state,
                    confirmationDialog: "Save",
                };
            }
        }
        case "CloseConfirmingDialog": {
            if (
                !state.isEditing ||
                state.isSaving ||
                state.confirmationDialog !== action.confirmationDialog
            ) {
                return state;
            }
            return {...state, confirmationDialog: null};
        }
        case "SaveEditedContent": {
            if (!state.isEditing || state.isSaving) return state;

            if (isContentEmpty(state.contentEditorState.getDoc())) {
                return {
                    ...state,
                    confirmationDialog: "Delete",
                };
            } else {
                return {
                    ...state,
                    isSaving: true,
                    isAwaitingSaveRef: {current: false},
                    savePromiseResolver: action.savePromiseResolver ?? null,
                };
            }
        }
        case "FinishedSavingContent": {
            if (!state.isEditing || !state.isSaving) return state;

            if (action.shouldCancelEditing) {
                return {
                    isEditing: false,
                };
            } else {
                return {
                    ...omitObject(state, ["isAwaitingSaveRef", "savePromiseResolver"]),
                    isSaving: false,
                };
            }
        }
        default:
            throw exhaustive(action);
    }
}

export type MessageEditing<RoomKey extends string> = {
    readonly state: MessageEditingState<RoomKey>;
    readonly dispatch: Memo<(action: MessageEditingAction<RoomKey>) => void>;
};

/**
 * Use state for managing message editing. Message editing state is hoisted to
 * the message virtualized list level because:
 *
 * - We only want to allow editing one message at a time.
 * - We don't want to lose editing state if the message is unmounted by the
 *   virtualized list.
 *
 * This message editing code was forked into `usePostEditing()`. If you make a
 * change here, you might want to make a change there as well.
 */
export function useMessageEditing<RoomKey extends string>({
    messageNoun,
    onUpdateMessageContent: onUpdateMessageContentFromProps,
    onDeleteMessage,
}: {
    messageNoun: string;
    onUpdateMessageContent: (options: {
        roomKey: RoomKey;
        messageIndex: number;
        contentVersion: number;
        steps: ReadonlyArray<Step>;
    }) => Promise<void>;
    onDeleteMessage: (options: {roomKey: RoomKey; messageIndex: number}) => Promise<void>;
}): {
    messageEditing: MessageEditing<RoomKey>;
    modals: ReactNode;
} {
    const reporter = useReporter();

    const [state, dispatch] = useReducer<
        MessageEditingState<RoomKey>,
        [MessageEditingAction<RoomKey>]
    >(reduce, {isEditing: false});

    const onUpdateMessageContent = useEvent(onUpdateMessageContentFromProps);

    useEffect(() => {
        if (!state.isEditing || !state.isSaving) return;

        if (state.isAwaitingSaveRef.current) return;
        // eslint-disable-next-line react-compiler/react-compiler
        state.isAwaitingSaveRef.current = true;

        const doc = state.contentEditorState.getDoc();
        const trimPos = trimContentFragmentEndPos(doc.content);
        const trimTransaction =
            trimPos !== null ? state.contentEditorState.delete(trimPos)[1] : null;

        const steps: Array<Step> = [];

        forEachLinkedList(reverseLinkedList(state.contentSteps), additionalSteps => {
            for (const step of additionalSteps) {
                steps.push(step);
            }
        });

        if (trimTransaction !== null) {
            for (const step of trimTransaction.steps) {
                steps.push(step);
            }
        }

        // If the content hasn't actually changed, skip the update. This way we
        // don't mark the message as edited if the user enters edit mode, makes
        // changes, and then reverts back to the original content.
        const finalDoc = trimTransaction !== null ? trimTransaction.doc : doc;
        if (finalDoc.eq(state.initialContent)) {
            state.savePromiseResolver?.resolve();
            dispatch({type: "FinishedSavingContent", shouldCancelEditing: true});
            return;
        }

        onUpdateMessageContent({
            roomKey: state.messageRoomKey,
            messageIndex: state.messageIndex,
            contentVersion: state.contentVersion,
            steps,
        }).then(
            () => {
                state.savePromiseResolver?.resolve();

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: true});
            },
            error => {
                // Expect the promise resolver to handle the error.
                if (state.savePromiseResolver) {
                    state.savePromiseResolver.reject(error);
                } else {
                    reporter.displayError(`Couldn\u2019t update ${messageNoun}`, error);
                }

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: false});
            },
        );
    }, [messageNoun, onUpdateMessageContent, reporter, state]);

    return {
        messageEditing: useMemo(
            () => ({
                state,
                dispatch: dispatch as Memo<(action: MessageEditingAction<RoomKey>) => void>,
            }),
            [state],
        ),
        modals: (
            <>
                {state.isEditing && state.confirmationDialog === "Save" && (
                    <ModalDialog
                        title={`Save ${messageNoun}`}
                        description={`Would you like to save the changes you made to this ${messageNoun}?`}
                        onClose={() => {
                            dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Save",
                            });
                        }}
                        primaryButtonLabel="Save"
                        primaryButtonPressErrorTitle={`Couldn\u2019t save ${messageNoun}`}
                        onPrimaryButtonPress={() => {
                            const savePromiseResolver = createPromiseResolver();

                            dispatch({type: "SaveEditedContent", savePromiseResolver});

                            return savePromiseResolver.promise;
                        }}
                        cancelButtonLabel="Discard changes"
                        onCancelButtonPress={() => {
                            dispatch({type: "CancelEditing"});
                        }}
                    />
                )}
                {state.isEditing && state.confirmationDialog === "Delete" && (
                    <MessageDeleteConfirmationDialog
                        messageNoun={messageNoun}
                        onClose={() => {
                            dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Delete",
                            });
                        }}
                        onDeleteMessage={async () => {
                            await onDeleteMessage({
                                roomKey: state.messageRoomKey,
                                messageIndex: state.messageIndex,
                            });
                        }}
                    />
                )}
            </>
        ),
    };
}
