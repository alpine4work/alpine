import {DotsThreeVertical} from "phosphor-react";
import {EditorState} from "prosemirror-state";

import {EditorView} from "prosemirror-view";
import React from "react";
import {tableCellToolbarClassName} from "~/shared/content/content_styles.js";

interface ContentEditorTableToolbarProps {
    state: EditorState;
    view: EditorView;
}

export const ContentEditorTableToolbar = ({state, view}: ContentEditorTableToolbarProps) => {
    console.log("state", state);
    console.log("view", view);
    return (
        <div className={tableCellToolbarClassName}>
            <DotsThreeVertical />
        </div>
    );
};
