import {Mark} from "prosemirror-model";
import {RefObject} from "react";
import {WebSocketConnectionId} from "~/shared/id/types/id_types.js";

export type ContentEditorPointerToolbarFloaterState = {
    readonly type: "PointerToolbar";
    readonly previousState: Exclude<
        ContentEditorFloaterState,
        ContentEditorPointerToolbarFloaterState
    > | null;
};

export type ContentEditorKeyboardHighlightFloaterState = {
    readonly type: "KeyboardHighlight";
    readonly range: {
        readonly from: number;
        readonly to: number;
    };
};

export type ContentEditorKeyboardLinkFloaterState = {
    readonly type: "KeyboardLink";
    readonly range: {
        readonly from: number;
        readonly to: number;
    };
};

export type ContentEditorPointerLinkFloaterState = {
    readonly type: "PointerLink";
    readonly key: WebSocketConnectionId;
    readonly mark: Mark;
    readonly range: {
        readonly from: number;
        readonly to: number;
    };
    readonly hasPointerLeftMark: boolean;
};

export type ContentEditorMentionFloaterState = {
    readonly type: "Mention";

    /**
     * The character that triggered the mention floater. We support both `@` (the
     * standard mention trigger) and `/` (for users coming from Slack or Notion where
     * `/` is the slash command trigger).
     */
    readonly triggerCharacter: "@" | "/";

    /**
     * `from` should always be the trigger character (`@` or `/`). If it's not we
     * should clear the floater. `to` should be the end of the mention search query.
     * The user can move their selection within this range and make edits to the search
     * query.
     */
    readonly range: {
        readonly from: number;
        readonly to: number;
    };

    /**
     * The search query we will look for to pick a mention.
     */
    readonly searchQuery: string;

    /**
     * The `<ContentEditorMentionFloater>` component will `useImperativeHandle()` to
     * provide an implementation of this function which the content editor should call.
     * If `event.preventDefault()` was called then this function has handled the event.
     */
    readonly handleKeyDownRef: RefObject<((event: KeyboardEvent) => void) | null>;

    /**
     * The `<ContentEditorMentionFloater>` component will `useImperativeHandle()` to
     * provide an implementation of this function which the content editor should call.
     */
    readonly handleKeyUpRef: RefObject<((event: KeyboardEvent) => void) | null>;

    /**
     * Is the mention floater in the closing animation? Other floaters manage their
     * closing animation state locally but we do it here since we close the floater
     * from `ContentEditorState`.
     */
    readonly isClosing: boolean;
};

export type ContentEditorCommentInputFloaterState = {
    readonly type: "CommentInput";
    readonly range: {
        readonly from: number;
        readonly to: number;
    };
};

export type ContentEditorFloaterState =
    | ContentEditorPointerToolbarFloaterState
    | ContentEditorKeyboardHighlightFloaterState
    | ContentEditorKeyboardLinkFloaterState
    | ContentEditorPointerLinkFloaterState
    | ContentEditorMentionFloaterState
    | ContentEditorCommentInputFloaterState;
