import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {prosemirrorToYXmlFragment, yXmlFragmentToProsemirror} from "y-prosemirror";
import * as Y from "yjs";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

export const TaskTitleProsemirrorSchema = new ProsemirrorSchema({
    nodes: {
        doc: {content: "text*"},
        text: {inline: true},
    },
});

/**
 * The title of a task which is a Y.js doc containing a PromiseMirror doc.
 *
 * We use ProseMirror for task titles. Task titles are short single line
 * strings with no formatting options. So why bother with the complexity of
 * ProseMirror?
 *
 * - Gives us the flexibility to one day add decorations, like mentions or
 *   tokenization
 * - Supports collaborative features like presence cursor and collaborative
 *   editing (collaborative editing within a task title will be rare, but nice
 *   to have everything support collaborative editing in theory)
 * - Better programmatic control of the text editor, for example translating
 *   cursor placement to pixel coords and back (for arrow up/down keyboard
 *   shortcuts)
 *
 * Overall, using a programmatic text editor allows us to super-power this
 * input for long into the future.
 *
 * We use the CRDT library Y.js to support collaborative editing of task
 * titles. Our task system depends on actions being commutative and idempotent
 * so that clients can make optimistic updates and so that our backend
 * distributed systems does not need to maintain any ordering guarantees. No
 * matter what order actions are applied in our clients should always converge
 * to the same state.
 */
export type TaskTitle = Uint8Array & {readonly _TaskTitle: never};

function isTaskTitle(title: Uint8Array): title is TaskTitle {
    try {
        const doc = new Y.Doc();
        Y.applyUpdateV2(doc, title);
        yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, doc.getXmlFragment("doc"));
        return true;
    } catch {
        return false;
    }
}

export const TaskTitleSchema = Schema.bytes.transform<TaskTitle>({
    serialize: title => {
        assert(isTaskTitle(title), "Expected a `TaskTitle` Y.js update");
        return title;
    },
    deserialize: title => {
        if (!isTaskTitle(title))
            throw new SchemaDeserializationError("Expected a `TaskTitle` Y.js update");

        return title;
    },
});

export const emptyTaskTitle = new Lazy(() => {
    const node = TaskTitleProsemirrorSchema.node("doc", {}, []);
    const doc = new Y.Doc();
    prosemirrorToYXmlFragment(node, doc.getXmlFragment("doc"));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitle;
});

export function getTaskTitleProsemirrorNode(title: TaskTitle): Node {
    const doc = new Y.Doc();
    Y.applyUpdateV2(doc, title);
    return yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, doc.getXmlFragment("doc"));
}

/**
 * A Y.js update to a `TaskTitle`.
 */
export type TaskTitleUpdate = Uint8Array & {readonly _TaskTitleUpdate: never};

export const TaskTitleUpdateSchema = Schema.bytes.transform<TaskTitleUpdate>({
    serialize: update => update,
    deserialize: update => update as TaskTitleUpdate,
});

export function applyTaskTitleUpdate(title: TaskTitle, titleUpdate: TaskTitleUpdate): TaskTitle {
    return Y.mergeUpdatesV2([title, titleUpdate]) as TaskTitle;
}
