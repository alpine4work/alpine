import {Node, Schema as ProsemirrorSchema} from "prosemirror-model";
import {prosemirrorToYXmlFragment, yXmlFragmentToProsemirror} from "y-prosemirror";
import * as Y from "yjs";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {Schema} from "~/shared/schema/schema.js";

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
 *
 * ## Limitations
 *
 * While Y.js gives us the commutative/idempotent properties we need for
 * working with the task system, [`y-prosemirror` has some important
 * limitations][1]. Remote updates don't use the ProseMirror step API (which
 * generates a position `Mapping`) and instead replaces state. This breaks some
 * ProseMirror plugins. The author has [asked for funding][2] to implement a v2
 * of `y-prosemirror` based on learnings.
 *
 * We are fine with these limitations for our very simple task title
 * ProseMirror schema but should hesitate before using Y.js to power
 * collaborative editing in `<ContentEditor>`.
 *
 * Also, as with any text editing CRDT there's also the gravestone problem.
 * Y.js is well optimized to avoid gravestones but there are still some.
 *
 * [1]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488
 * [2]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488/32
 */
export type TaskTitle = Uint8Array & TaskTitleUpdate & {readonly _TaskTitle: never};

/**
 * Checks if a `Uint8Array` is a valid `TaskTitle`.
 */
export function isTaskTitle(title: Uint8Array): title is TaskTitle {
    try {
        const doc = new Y.Doc({guid: getYDocGuid()});
        Y.applyUpdateV2(doc, title);
        yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, doc.getXmlFragment("doc"));
        return true;
    } catch {
        return false;
    }
}

// We don't validate the task title bytes since the `isTaskTitle()` function is
// actually quite expensive.
//
// Y.js is designed for scenarios where every client is trusted.
export const TaskTitleSchema = Schema.bytes as any as Schema<TaskTitle>;

export const emptyTaskTitleProsemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, []);

export const emptyTaskTitle = new Lazy(() => {
    const yDoc = new Y.Doc({guid: getYDocGuid()});
    prosemirrorToYXmlFragment(emptyTaskTitleProsemirrorNode, yDoc.getXmlFragment("doc"));
    const title = Y.encodeStateAsUpdateV2(yDoc) as TaskTitle;
    yDoc.destroy();
    return title;
});

export function getTaskTitleProsemirrorNode(title: TaskTitle): Node {
    const yDoc = new Y.Doc({guid: getYDocGuid()});
    Y.applyUpdateV2(yDoc, title);
    const node = yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, yDoc.getXmlFragment("doc"));
    yDoc.destroy();
    return node;
}

let nextYDocGuid = 0;

/**
 * Optimized function for generating a GUID for `new Y.Doc()`. When creating
 * many `Y.Doc`s in a hot code path (like scrolling a task grid view) we don't
 * want to get random values from WebCrypto since that shows up as expensive in
 * profiling.
 */
export function getYDocGuid() {
    return `${getRealmId()}-${nextYDocGuid++}`;
}

/**
 * Get the plain text string of the task title without any styles.
 */
export function getTaskTitleText(title: TaskTitle): string {
    const node = getTaskTitleProsemirrorNode(title);

    let text = "";

    node.descendants(childNode => {
        if (childNode.isText) {
            text += childNode.textContent;
        }
    });

    return text;
}

/**
 * Creates a Y.js encoded task title from a string.
 */
export function createTaskTitleFromText(titleText: string): TaskTitle {
    const prosemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, [
        TaskTitleProsemirrorSchema.text(titleText),
    ]);

    const yDoc = new Y.Doc({guid: getYDocGuid()});
    prosemirrorToYXmlFragment(prosemirrorNode, yDoc.getXmlFragment("doc"));
    const title = Y.encodeStateAsUpdateV2(yDoc) as TaskTitle;
    yDoc.destroy();
    return title;
}

/**
 * A Y.js update to a `TaskTitle`.
 */
export type TaskTitleUpdate = Uint8Array & {readonly _TaskTitleUpdate: never};

export const TaskTitleUpdateSchema = Schema.bytes as any as Schema<TaskTitleUpdate>;

export function applyTaskTitleUpdate(title: TaskTitle, titleUpdate: TaskTitleUpdate): TaskTitle {
    return Y.mergeUpdatesV2([title, titleUpdate]) as TaskTitle;
}

export function mergeTaskTitleUpdates(
    titleUpdate1: TaskTitleUpdate,
    titleUpdate2: TaskTitleUpdate,
): TaskTitleUpdate {
    return Y.mergeUpdatesV2([titleUpdate1, titleUpdate2]) as TaskTitleUpdate;
}
