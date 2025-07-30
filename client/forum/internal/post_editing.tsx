import {Memo, MutableRefObject, ReactNode, useEffect, useMemo, useReducer} from "react";
import {ContentEditorState} from "~/client/content/state/content_editor_state.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useReporter} from "~/client/design/reporter.js";
import {useEvent} from "~/client/helpers/lifecycle/use_event.js";
import {trimContentEnd} from "~/shared/content/trim_content.js";
import {Platform} from "~/shared/design/core/platform.js";
import {PostContent, PostContentWithReferences} from "~/shared/forum/post_content_schema.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {PostId} from "~/shared/id/types/id_types.js";

export type PostEditingState =
    | {
          readonly isEditing: false;
      }
    | ({
          readonly isEditing: true;
          readonly postId: PostId;
          readonly contentEditorState: ContentEditorState<PostContentWithReferences>;
          readonly initialContent: PostContent;
          readonly confirmationDialog: "Save" | null;
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

export type PostEditingAction =
    | {
          readonly type: "StartEditing";
          readonly postId: PostId;
          readonly currentContent: PostContentWithReferences;
          readonly platform: Platform;
      }
    | {
          readonly type: "ContentEditorStateChange";
          readonly contentEditorState: ContentEditorState<PostContentWithReferences>;
      }
    | {
          readonly type: "CancelEditing";
      }
    | {
          readonly type: "MaybeCancelEditing";
      }
    | {
          readonly type: "CloseConfirmingDialog";
          readonly confirmationDialog: "Save";
      }
    | {
          readonly type: "SaveEditedContent";
          readonly savePromiseResolver?: PromiseResolver<void>;
      }
    | {
          readonly type: "FinishedSavingContent";
          readonly shouldCancelEditing: boolean;
      };

function reduce(state: PostEditingState, action: PostEditingAction): PostEditingState {
    switch (action.type) {
        case "StartEditing": {
            return {
                isEditing: true,
                postId: action.postId,
                contentEditorState: ContentEditorState.create(action.currentContent, {
                    // Put the selection at the start of the post so the cursor is visible when we
                    // enter edit mode and we don't have to scroll.
                    selection: "start",
                }),
                initialContent: action.currentContent.doc,
                isSaving: false,
                confirmationDialog: null,
            };
        }
        case "ContentEditorStateChange": {
            if (!state.isEditing || state.isSaving) return state;

            return {
                ...state,
                contentEditorState: action.contentEditorState,
            };
        }
        case "CancelEditing": {
            if (!state.isEditing) return state;

            return {isEditing: false};
        }
        case "MaybeCancelEditing": {
            if (!state.isEditing || state.isSaving || state.confirmationDialog !== null)
                return state;

            if (state.contentEditorState.getDoc() === state.initialContent) {
                return {isEditing: false};
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

            // TODO(calebmer): If the user tries to save empty content throw up a delete
            // confirmation dialog instead, like with messages.
            return {
                ...state,
                isSaving: true,
                isAwaitingSaveRef: {current: false},
                savePromiseResolver: action.savePromiseResolver ?? null,
            };
        }
        case "FinishedSavingContent": {
            if (!state.isEditing || !state.isSaving) return state;

            if (action.shouldCancelEditing) {
                return {isEditing: false};
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

export type PostEditing = {
    readonly state: PostEditingState;
    readonly dispatch: Memo<(action: PostEditingAction) => void>;
};

/**
 * Use state for managing post editing. Post editing state is hoisted to
 * the post virtualized list level because:
 *
 * - We only want to allow editing one post at a time.
 * - We don't want to lose editing state if the post is unmounted by the
 *   virtualized list.
 *
 * This post editing state code was forked from `useMessageEditing()`. If you
 * make a change here, you might want to make a change there as well.
 */
export function usePostEditing({
    onUpdatePostContent: _onUpdatePostContent,
}: {
    onUpdatePostContent: (options: {postId: PostId; content: PostContent}) => Promise<void>;
}): {
    postEditing: PostEditing;
    modals: ReactNode;
} {
    const reporter = useReporter();

    const [state, dispatch] = useReducer<
        (state: PostEditingState, action: PostEditingAction) => PostEditingState
    >(reduce, {isEditing: false});

    const onUpdatePostContent = useEvent(_onUpdatePostContent);

    useEffect(() => {
        if (!state.isEditing || !state.isSaving) return;

        if (state.isAwaitingSaveRef.current) return;
        // eslint-disable-next-line react-compiler/react-compiler
        state.isAwaitingSaveRef.current = true;

        const {savePromiseResolver} = state;

        onUpdatePostContent({
            postId: state.postId,
            content: trimContentEnd(state.contentEditorState.getDoc()),
        }).then(
            () => {
                savePromiseResolver?.resolve();

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: true});
            },
            error => {
                // Expect the promise resolver to handle the error.
                if (savePromiseResolver) {
                    savePromiseResolver.reject(error);
                } else {
                    reporter.displayError("Couldn’t update post", error);
                }

                dispatch({type: "FinishedSavingContent", shouldCancelEditing: false});
            },
        );
    }, [onUpdatePostContent, reporter, state]);

    return {
        postEditing: useMemo(
            () => ({
                state,
                dispatch: dispatch as Memo<(action: PostEditingAction) => void>,
            }),
            [state],
        ),
        modals: (
            <>
                {state.isEditing && state.confirmationDialog === "Save" && (
                    <ModalDialog
                        title="Save post"
                        description="Would you like to save the changes you made to this post?"
                        onClose={() => {
                            dispatch({
                                type: "CloseConfirmingDialog",
                                confirmationDialog: "Save",
                            });
                        }}
                        primaryButtonLabel="Save"
                        primaryButtonPressErrorTitle="Couldn’t save post"
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
            </>
        ),
    };
}
