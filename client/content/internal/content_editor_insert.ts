/* eslint-disable @typescript-eslint/unbound-method */
import {Node, ResolvedPos} from "prosemirror-model";
import {Command, NodeSelection, Selection, TextSelection} from "prosemirror-state";
import {EditorView} from "prosemirror-view";
import {createToggleBlockTypeCommand} from "~/client/content/internal/helpers/create_toggle_block_type_command.js";
import {createToggleListItemsCommand} from "~/client/content/internal/helpers/create_toggle_list_items_command.js";
import {assert} from "~/shared/helpers/control/assert.js";

function getInsertPosOrSelection(selection: Selection): number | Selection {
    const doc = selection.$anchor.doc;

    // If the selection is on a file we'll insert below the file instead of
    // replacing the file. Since files take a lot of intention to add to the
    // document so it's likely the user wants to keep it around.
    //
    // This is the same logic we have when the user presses the "Enter" key on a
    // file or a letter key on a file. We start typing in an empty paragraph below
    // the file instead of replacing the file.
    if (selection instanceof NodeSelection && selection.node.type.name === "file") {
        return selection.$anchor.after();
    }

    // Since we don't insert in the title, don't display our phantom insert cursor
    // in the title. Move the cursor out of the title.
    const adjustedAnchor =
        selection.$anchor.parent.type.name === "title"
            ? selection.$anchor.after()
            : selection.anchor;

    const adjustedHead =
        selection.$head.parent.type.name === "title" ? selection.$head.after() : selection.head;

    return adjustedAnchor !== selection.anchor || adjustedHead !== selection.head
        ? TextSelection.between(doc.resolve(adjustedAnchor), doc.resolve(adjustedHead))
        : selection;
}

/**
 * Insert a node into the editor.
 * Core insertion logic that handles:
 * - Inserting at specific positions
 * - Replacing selected content
 * - Handling empty vs non-empty selections
 * - Scrolling to show inserted content
 *
 * @param view - The editor view.
 * @param node - The node to insert.
 * @param commandIfNotEmpty - An optional command to run if the node is not empty.
 */
function insertNode(view: EditorView, node: Node, commandIfNotEmpty?: Command) {
    const {state} = view;

    const insertPosOrSelection = getInsertPosOrSelection(state.selection);

    if (
        commandIfNotEmpty &&
        insertPosOrSelection instanceof Selection &&
        !(insertPosOrSelection instanceof NodeSelection) &&
        insertPosOrSelection.from !== insertPosOrSelection.to
    ) {
        view.focus();
        commandIfNotEmpty(state, view.dispatch.bind(view), view);
        return;
    }

    const transaction = state.tr;

    if (!(insertPosOrSelection instanceof Selection)) {
        transaction.insert(insertPosOrSelection, node);
    } else {
        transaction.replaceRangeWith(
            insertPosOrSelection.$from.parentOffset === 0
                ? insertPosOrSelection.from - 1
                : insertPosOrSelection.from,
            insertPosOrSelection.to,
            node,
        );
    }

    const $pos = findInsertedNodeAfterReplaceRangeWith(
        insertPosOrSelection instanceof Selection
            ? insertPosOrSelection.$from
            : state.doc.resolve(insertPosOrSelection),
        transaction.doc,
        node,
    );
    if ($pos) {
        transaction.setSelection(Selection.near($pos)).scrollIntoView();
    }

    view.focus();
    view.dispatch(transaction);
}

export function findInsertedNodeAfterReplaceRangeWith(
    $replaceFrom: ResolvedPos,
    newDoc: Node,
    node: Node,
): ResolvedPos | null {
    if ($replaceFrom.parentOffset === 0) {
        let $pos = newDoc.resolve(Math.min($replaceFrom.pos + node.nodeSize, newDoc.nodeSize - 2));
        while ($pos.nodeBefore !== node && $pos.depth > 0) {
            $pos = newDoc.resolve($pos.before());
        }

        if ($pos.nodeBefore === node) {
            $pos = newDoc.resolve($pos.pos - node.nodeSize);
            assert($pos.nodeAfter === node);
            return $pos;
        }
    } else {
        let $pos = newDoc.resolve($replaceFrom.pos);
        while ($pos.nodeAfter !== node && $pos.depth > 0) {
            $pos = newDoc.resolve($pos.after());
        }

        if ($pos.nodeAfter === node) {
            return $pos;
        }
    }

    return null;
}

export function insertContentUnorderedListItem(view: EditorView) {
    const {schema} = view.state;

    const node = schema.node("unorderedListItem", {}, [schema.node("paragraph")]);

    insertNode(view, node, createToggleListItemsCommand(node.type));
}

export function insertContentOrderedListItem(view: EditorView) {
    const {schema} = view.state;

    const node = schema.node("orderedListItem", {}, [schema.node("paragraph")]);

    insertNode(view, node, createToggleListItemsCommand(node.type));
}

export function insertContentCheckListItem(view: EditorView) {
    const {schema} = view.state;

    const node = schema.node("checkListItem", {}, [schema.node("paragraph")]);

    insertNode(view, node, createToggleListItemsCommand(node.type));
}

export function insertContentHeading(view: EditorView, level: 1 | 2 | 3) {
    const {schema} = view.state;

    insertNode(
        view,
        schema.node("heading", {level}),
        createToggleBlockTypeCommand(schema.nodes.heading!, {level}),
    );
}

export function insertContentDivider(view: EditorView) {
    const {schema} = view.state;

    insertNode(view, schema.node("divider"));
}

export function insertContentQuoteBlock(view: EditorView) {
    const {schema} = view.state;

    insertNode(view, schema.node("quoteBlock", {}, [schema.node("paragraph")]));
}

export function insertContentCodeBlock(view: EditorView) {
    const {schema} = view.state;

    insertNode(view, schema.node("codeBlock", {}, [schema.node("codeBlockLine")]));
}

export function insertContentFiles(
    view: EditorView & {
        insertFiles: (posOrSelection: number | Selection, files: ReadonlyArray<File>) => void;
    },
    files: ReadonlyArray<File>,
) {
    const insertPosOrSelection =
        // If the user has selected a file in a file row then let's try inserting our
        // files into the file row instead of below the file row.
        view.state.selection instanceof NodeSelection &&
        view.state.selection.node.type.name === "file" &&
        view.state.selection.$anchor.parent.type.name === "fileRow"
            ? view.state.selection.anchor + 1
            : getInsertPosOrSelection(view.state.selection);

    view.insertFiles(insertPosOrSelection, files);
}

export function insertContentTable(view: EditorView) {
    const {schema} = view.state;
    const cell = schema.node("table_cell", {}, [schema.node("paragraph")]);
    const table_row = schema.node("table_row", {}, [cell, cell]);
    const table = schema.node("table", {}, [table_row, table_row]);

    insertNode(view, table);

    // Apply initial table commands after insertion
    const commands = schema.nodes.table?.spec.commands;
    commands?.fixTables?.(view.state, view.dispatch);
    commands?.setAlignment?.({alignment: "center"})(view.state, view.dispatch);
}
