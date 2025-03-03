import {Node, Schema as ProsemirrorSchema, Slice} from "prosemirror-model";
import {prosemirrorToYXmlFragment, yXmlFragmentToProsemirror} from "y-prosemirror";
import * as Y from "yjs";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {deepFreeze} from "~/shared/helpers/control/deep_freeze.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {decodeId} from "~/shared/id/id.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {Schema} from "~/shared/schema/schema.js";

export const TaskTitleProsemirrorSchema = new ProsemirrorSchema({
    nodes: {
        doc: {content: "text*"},
        text: {inline: true},
    },
});

/**
 * The title of a task which is a Yjs doc containing a PromiseMirror doc.
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
 * We use the CRDT library Yjs to support collaborative editing of task
 * titles. Our task system depends on actions being commutative and idempotent
 * so that clients can make optimistic updates and so that our backend
 * distributed systems does not need to maintain any ordering guarantees. No
 * matter what order actions are applied in our clients should always converge
 * to the same state.
 *
 * ## Limitations
 *
 * The Yjs library represents collaborative documents as mutable objects. This
 * doesn't fit well with our task client state system which uses immutable data
 * (e.g. `TaskModel` and `TaskClientStore`)! Also [Yjs's ProseMirror support
 * (`y-prosemirror`) is poorly implemented and has some meaningful
 * limitations][1]. For these reasons we've built a custom immutable mode for Yjs
 * and custom Yjs to ProseMirror integration.
 *
 * Our immutable mode clones Yjs docs whenever we need to make an update. While
 * inefficient this should be fine for the scale of Yjs doc we're working with
 * (a single line of text). If this ever becomes a performance issue we should
 * reimplement Yjs using immutable data structures designed for efficient
 * updates.
 *
 * Our custom ProseMirror integration is built on translating ProseMirror steps
 * to Yjs updates (e.g. `ReplaceStep` becomes a `replace()` method on
 * `TaskTitleModel`) and making sure we can undo actions without a stateful
 * `Y.UndoManager`.
 *
 * Another limitation is like any CRDT, Yjs leaves gravestones for deleted
 * content. Yjs has a GC optimization for deleted content so this isn't too
 * bad.
 *
 * [1]: https://discuss.prosemirror.net/t/offline-peer-to-peer-collaborative-editing-using-yjs/2488
 */
export type TaskTitle = Uint8Array & TaskTitleUpdate & {readonly _TaskTitle: never};

// We don't validate the task title bytes since the `isTaskTitle()` function is
// actually quite expensive.
//
// Y.js is designed for scenarios where every client is trusted.
export const TaskTitleSchema = Schema.bytes as any as Schema<TaskTitle>;

export const emptyTaskTitleProsemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, []);

/**
 * We use the `RealmId` (really the first 32 bits of the `RealmId`) as the
 * `clientID` for Yjs. For this to work we must be careful to not create two
 * conflicting `TaskTitleUpdate`s within the same JavaScript realm. Otherwise
 * if we commit two conflicting updates the task title will be corrupted!
 */
export const realmTaskTitleClientId = new Lazy((): number => {
    const realmIdBytes = decodeId(getRealmId());
    const realmIdDataView = new DataView(
        realmIdBytes.buffer,
        realmIdBytes.byteOffset,
        realmIdBytes.byteLength,
    );
    return realmIdDataView.getUint32(0);
});

/**
 * Create a Yjs doc where the `clientID` is based on the `RealmId`
 * (specifically the first 32 bytes). We expect the code within a JavaScript
 * realm to NOT create conflicting updates.
 *
 * We create a Yjs document without using the initializer for more control and
 * for performance. (For instance, while profiling task grid view scrolling we
 * found Yjs's implementation of `guid` generation to be slow.)
 */
function createDoc(): Y.Doc {
    const doc = Object.create(Y.Doc.prototype);

    // Always use a client ID based on our realm ID. There should never be any
    // concurrent updates within a single JavaScript realm.
    //
    // Define the property as read-only. When detecting potential corruption [Yjs
    // may try to change the `clientID`][1]. Instead of silently changing the
    // `clientID` we'd prefer to loudly throw an error.
    //
    // [1]: https://github.com/yjs/yjs/blob/8586806932e65b2c9957f5e4ecd74547baf301ad/src/utils/Transaction.js#L342
    Object.defineProperty(doc, "clientID", {
        configurable: true,
        enumerable: true,
        writable: false,
        value: realmTaskTitleClientId.get(),
    });

    // Make sure the Yjs GC is enabled.
    doc.gc = true;
    doc.gcFilter = () => true;

    // Core data storage for the doc.
    doc.share = new Map();
    doc.store = {clients: new Map(), pendingStructs: null, pendingDs: null};

    // Transaction state. Only one transaction can run on a document at a time.
    doc._transaction = null;
    doc._transactionCleanups = [];

    // Event emitter listener storage.
    doc._observers = new Map();

    return doc;
}

/**
 * Clones a Yjs doc, deeply. Yjs docs are mutable but our entire task client
 * state is built on immutable data (`TaskModel`). So to use Yjs we deeply
 * clone docs whenever we want to make an update. This is inefficient but
 * shouldn't be an issue for the scale of Yjs documents we work with (single
 * line of text).
 *
 * Correctly implementing Yjs doc cloning requires detailed knowledge of Yjs
 * internals. We wrote this while carefully cross referencing Yjs source code.
 * As a safety mechanism to make sure everything is properly cloned, we call
 * `deepFreeze()` in development on immutable Yjs docs.
 *
 * If cloning becomes a performance issue then we should consider writing
 * an implementation of Yjs with efficient immutable data structures from
 * scratch.
 */
function cloneDoc(doc: Y.Doc): Y.Doc {
    const clonedDoc = createDoc();
    const clonedItemByClockByClientId = new Map<number, Map<number, Y.Item>>();

    // 1. Clone all structs
    for (const [clientId, structs] of doc.store.clients.entries()) {
        const clonedStructs: Array<Y.GC | Y.Item> = [];
        clonedDoc.store.clients.set(clientId, clonedStructs);

        const clonedItemByClock = getOrSetDefaultMapValue(
            clonedItemByClockByClientId,
            clientId,
            () => new Map(),
        );

        for (const struct of structs) {
            if (struct instanceof Y.GC) {
                clonedStructs.push(new Y.GC(struct.id, struct.length));
            } else {
                const clonedItem = new Y.Item(
                    struct.id,
                    // Will update to a cloned reference in second `clonedDoc.store` loop below once
                    // we've cloned all items.
                    struct.left,
                    struct.origin,
                    // Will update to a cloned reference in second `clonedDoc.store` loop below once
                    // we've cloned all items.
                    struct.right,
                    struct.rightOrigin,
                    // Will update to the correct reference in `doc.share` loop below
                    null,
                    struct.parentSub,
                    struct.content.copy(),
                );

                clonedItem.redone = struct.redone;
                clonedItem.info = struct.info;

                clonedStructs.push(clonedItem);
                clonedItemByClock.set(clonedItem.id.clock, clonedItem);
            }
        }
    }

    // 2. Make sure struct references within cloned structs point to other
    // cloned structs
    for (const clonedStructs of clonedDoc.store.clients.values()) {
        for (const clonedStruct of clonedStructs) {
            if (!(clonedStruct instanceof Y.Item)) continue;

            if (clonedStruct.left !== null) {
                clonedStruct.left = assertExists(
                    clonedItemByClockByClientId
                        .get(clonedStruct.left.id.client)
                        ?.get(clonedStruct.left.id.clock),
                );
            }

            if (clonedStruct.right !== null) {
                clonedStruct.right = assertExists(
                    clonedItemByClockByClientId
                        .get(clonedStruct.right.id.client)
                        ?.get(clonedStruct.right.id.clock),
                );
            }
        }
    }

    const cloneTypeProperties = (
        type: Y.AbstractType<Y.YEvent<any>>,
        clonedType: Y.AbstractType<Y.YEvent<any>>,
    ) => {
        clonedType.doc = clonedDoc;
        clonedType._length = type._length;

        if (type._item !== null) {
            clonedType._item = assertExists(
                clonedItemByClockByClientId.get(type._item.id.client)?.get(type._item.id.clock),
            );
        }

        for (const [key, item] of type._map) {
            const clonedItem = assertExists(
                clonedItemByClockByClientId.get(item.id.client)?.get(item.id.clock),
            );

            clonedType._map.set(key, clonedItem);

            for (
                let nextClonedItem: Y.Item | null = clonedItem;
                nextClonedItem !== null;
                nextClonedItem = nextClonedItem.left
            ) {
                nextClonedItem.parent = clonedType;
            }
        }

        if (type._start !== null) {
            clonedType._start = assertExists(
                clonedItemByClockByClientId.get(type._start.id.client)?.get(type._start.id.clock),
            );
        }

        for (
            let nextClonedItem = clonedType._start;
            nextClonedItem !== null;
            nextClonedItem = nextClonedItem.right
        ) {
            nextClonedItem.parent = clonedType;
        }
    };

    // 3. Make sure types in `ContentType` are cloned appropriately.
    for (const [clientId, clonedStructs] of clonedDoc.store.clients) {
        for (let i = 0; i < clonedStructs.length; i++) {
            const clonedStruct = clonedStructs[i]!;
            if (!(clonedStruct instanceof Y.Item)) continue;

            if (clonedStruct.content instanceof Y.ContentType) {
                const item = assertExists(doc.store.clients.get(clientId)?.[i]);
                assert(item instanceof Y.Item);
                assert(item.content instanceof Y.ContentType);
                cloneTypeProperties(item.content.type, clonedStruct.content.type);
            }
        }
    }

    // 4. Clone shared types. This also sets `parent` on cloned structs.
    for (const [name, type] of doc.share.entries()) {
        const clonedType: Y.AbstractType<Y.YEvent<any>> =
            // @ts-expect-error: This is ok, type constructors don't take arguments
            new type.constructor();

        cloneTypeProperties(type, clonedType);

        clonedDoc.share.set(name, clonedType);
    }

    clonedDoc.store.pendingStructs = doc.store.pendingStructs
        ? {
              missing: new Map(doc.store.pendingStructs.missing),
              update: doc.store.pendingStructs.update.slice(),
          }
        : null;

    clonedDoc.store.pendingDs = doc.store.pendingDs ? doc.store.pendingDs.slice() : null;

    return clonedDoc;
}

/**
 * An empty `TaskTitle`.
 */
export const emptyTaskTitle = new Lazy(() => {
    const doc = createDoc();
    prosemirrorToYXmlFragment(emptyTaskTitleProsemirrorNode, doc.getXmlFragment("doc"));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitle;
});

/**
 * Checks if a `Uint8Array` is a valid `TaskTitle`.
 */
export function isTaskTitle(title: Uint8Array): title is TaskTitle {
    try {
        getTaskTitleProsemirrorNode(title as TaskTitle);
        return true;
    } catch {
        return false;
    }
}

/**
 * Gets a ProseMirror node from a `TaskTitle`.
 */
export function getTaskTitleProsemirrorNode(title: TaskTitle): Node {
    const doc = createDoc();
    Y.applyUpdateV2(doc, title);
    return yXmlFragmentToProsemirror(TaskTitleProsemirrorSchema, doc.getXmlFragment("doc"));
}

/**
 * Get the plain text string of the task title without any styles from a
 * ProseMirror node.
 */
export function getTaskTitleProsemirrorNodeText(node: Node): string {
    let text = "";

    node.descendants(childNode => {
        if (childNode.isText) {
            text += childNode.textContent;
        }
    });

    return text;
}

/**
 * Get the plain text string of the `TaskTitle` without any styles.
 */
export function getTaskTitleText(title: TaskTitle): string {
    const node = getTaskTitleProsemirrorNode(title);
    return getTaskTitleProsemirrorNodeText(node);
}

/**
 * Creates a Yjs encoded task title from a string.
 */
export function createTaskTitleFromText(titleText: string): TaskTitle {
    const prosemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, [
        TaskTitleProsemirrorSchema.text(titleText),
    ]);

    const doc = createDoc();
    prosemirrorToYXmlFragment(prosemirrorNode, doc.getXmlFragment("doc"));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitle;
}

/**
 * A Yjs update to a `TaskTitle`.
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

export const emptyTaskTitleModel = new Lazy(() => new TaskTitleModel(emptyTaskTitle.get()));

export const taskFallbackTitle = "Untitled";

/**
 * Return the title string and if the title is empty then return a fallback
 * name like "Untitled".
 */
export function addFallbackToTaskTitle(title: string): string {
    return title.trim().length > 0 ? title : taskFallbackTitle;
}

/**
 * Model representing a task title. Represents a `TaskTitle` CRDT and provides
 * convenience functions (e.g. `getText()`) and tracks additional information
 * useful for client applications.
 *
 * Importantly, the title model tracks essential undo metadata. Specifically
 * the `Y.Doc` which backs the title model has a `redone` property on all
 * `Y.Item` structs it contains. The `redone` property on deleted items is
 * essential for undo since it points to the new item that recreated the
 * deleted old item.
 *
 * ### Avoiding corruption
 *
 * You must be a little careful to avoid data corruption. All updates created
 * in this JavaScript realm have the same Yjs `clientID`. If you generate two
 * conflicting updates within the JavaScript realm it will cause data
 * corruption. Here's an example of how you might cause data corruption:
 *
 * ```ts
 * const title1 = emptyTaskTitleModel.get();
 * const updateA = assertExists(title1.replace(0, 0, "a"));
 * const updateB = assertExists(title1.replace(0, 0, "b"));
 * const title2 = applyTaskTitleUpdate(title1.getRaw(), updateA.raw);
 * const title3 = applyTaskTitleUpdate(title2, updateB.raw);
 * ```
 *
 * Corruption here occurs because `updateA` and `updateB` under the hood
 * generate a conflicting ID for `"a"` and `"b"`. IDs are a tuple of
 * `(clientId, clock)`. `clientId` is the first 32 bits of our JavaScript
 * `RealmId`. `clock` is +1 from the highest `clock` value for the same
 * `clientId` in the title. The reason the above example creates a corrupted
 * title is `updateA` uses the ID `(realmId, 0)` for `"a"` and `updateB` also
 * uses the ID `(realmId, 0)` for `"b"`.
 *
 * The following is ok:
 *
 * ```ts
 * const title1 = emptyTaskTitleModel.get();
 * const updateA = assertExists(title1.replace(0, 0, "a"));
 * const title2 = updateA.newTitle;
 * const updateB = assertExists(title2.replace(0, 0, "b"));
 * const title3 = updateB.newTitle;
 * ```
 *
 * This is fine since the ID for `"a"` will be `(realmId, 0)` and the ID for
 * `"b"` will be `(realmId, 1)` since we generate the `"b"` update on top of
 * the `"a"` update.
 *
 * You'll notice in our data corruption example we're using `titleUpdate.raw`
 * and `applyTaskTitleUpdate()`, A good rule of thumb for avoiding corruption
 * is if you're using `titleUpdate.raw` or `title.getRaw()` to apply your
 * update you're at risk of corrupting your title. By default the model types
 * will make sure you only make updates in a way that won't corrupt your
 * title.
 */
export class TaskTitleModel {
    public static schema = Schema.bytes.transform<TaskTitleModel>({
        serialize: title => title.getRaw(),
        deserialize: title => new TaskTitleModel(title as TaskTitle),
    });

    private _doc: Y.Doc | null;
    private _raw: TaskTitle | null;
    private _prosemirrorNode: Node | null = null;
    private _text: string | null = null;

    constructor(doc: Y.Doc | TaskTitle) {
        if (doc instanceof Y.Doc) {
            // In development and test environments, make sure `doc` isn't mutated by
            // deeply freezing the value. Since deep freezing is a potentially expensive
            // operation we don't do it in production.
            //
            // We only freeze `doc.store` since sometimes Yjs creates transactions in code
            // read paths.
            if (process.env.NODE_ENV !== "production") {
                deepFreeze(doc.store);
            }

            this._doc = doc;
            this._raw = null;
        } else {
            this._doc = null;
            this._raw = doc;
        }
    }

    /**
     * Get the Yjs doc for this title model.
     */
    private _getDoc() {
        if (this._doc === null) {
            const doc = createDoc();
            Y.applyUpdateV2(doc, assertExists(this._raw));

            // In development and test environments, make sure `doc` isn't mutated by
            // deeply freezing the value. Since deep freezing is a potentially expensive
            // operation we don't do it in production.
            //
            // We only freeze `doc.store` since sometimes Yjs creates transactions in code
            // read paths.
            if (process.env.NODE_ENV !== "production") {
                deepFreeze(doc.store);
            }

            this._doc = doc;
        }

        return this._doc;
    }

    /**
     * Get the binary `TaskTitle` representation of this `TaskTitleModel`.
     */
    public getRaw(): TaskTitle {
        this._raw ??= Y.encodeStateAsUpdateV2(assertExists(this._doc)) as TaskTitle;
        return this._raw;
    }

    /**
     * Get the ProseMirror node for this title.
     */
    public getProsemirrorNode(): Node {
        this._prosemirrorNode ??= yXmlFragmentToProsemirror(
            TaskTitleProsemirrorSchema,
            this._getDoc().getXmlFragment("doc"),
        );
        return this._prosemirrorNode;
    }

    /**
     * Get the plain text string without formatting for this title.
     */
    public getText(): string {
        this._text ??= getTaskTitleProsemirrorNodeText(this.getProsemirrorNode());
        return this._text;
    }

    /**
     * Are these two titles equal?
     */
    public isEqual(otherTitle: TaskTitleModel): boolean {
        if (this === otherTitle) return true;
        return areUint8ArraysEqual(this.getRaw(), otherTitle.getRaw());
    }

    /**
     * Clones the underlying Yjs doc. You should only call this in `task_title.ts`.
     * That's why it's prefixed with an underscore.
     */
    public _cloneDoc(): Y.Doc {
        return cloneDoc(this._getDoc());
    }

    /**
     * Create a task title update using the same properties as ProseMirror's
     * `ReplaceStep`. You can use this to translate ProseMirror updates into Yjs
     * updates.
     *
     * You have to be a little careful to avoid corrupting your task title. See the
     * comment on `TaskTitleModel` for more information.
     */
    public replace(from: number, to: number, text: string): TaskTitleUpdateModel | null {
        return this.replaceMany([{from, to, text}]);
    }

    public replaceMany(
        steps: Iterable<{from: number; to: number} & ({text: string} | {slice: Slice})>,
    ): TaskTitleUpdateModel | null {
        const doc = cloneDoc(this._getDoc());
        const xmlFragment = doc.getXmlFragment("doc");

        let update: TaskTitleUpdate | null = null;

        doc.on("updateV2", newUpdate => {
            if (update === null) {
                update = newUpdate;
            } else {
                update = mergeTaskTitleUpdates(update, newUpdate);
            }
        });

        const transaction = doc.transact(transaction => {
            for (const step of steps) {
                const {from, to} = step;

                let text: string;
                if ("text" in step) {
                    text = step.text;
                } else {
                    text = "";

                    step.slice.content.descendants(childNode => {
                        if (childNode.isText) {
                            text += childNode.textContent;
                        }
                    });
                }

                assert(Number.isSafeInteger(from), "`from` must be an integer");
                assert(Number.isSafeInteger(to), "`to` must be an integer");
                assert(to >= from, "`to` must be greater than or equal to `from`");
                assert(from >= 0, "`from` must be greater than or equal to 0");

                // Our task title is a simple string, for now. There shouldn't be nested
                // `Y.XmlElement`s.
                assert(
                    xmlFragment.firstChild === null || xmlFragment.firstChild instanceof Y.XmlText,
                );

                if (xmlFragment.firstChild === null) {
                    assert(to <= 0, "`to` is out of bounds");

                    if (text.length > 0) {
                        xmlFragment.insert(0, [new Y.XmlText(text)]);
                    }
                } else {
                    assert(to <= xmlFragment.firstChild.length, "`to` is out of bounds");

                    if (from !== to) {
                        xmlFragment.firstChild.delete(from, to - from);
                    }

                    if (text.length > 0) {
                        xmlFragment.firstChild.insert(from, text);
                    }
                }
            }

            // make sure that deleted structs are not gc'd
            Y.iterateDeletedStructs(transaction, transaction.deleteSet, struct => {
                if (!(struct instanceof Y.Item)) return;

                let item: Y.Item | null = struct;
                while (item !== null && item.keep !== true) {
                    item.keep = true;
                    item = (item.parent as Y.AbstractType<any>)._item;
                }
            });

            return transaction;
        });

        if (update === null) return null;

        return new TaskTitleUpdateModel(
            update,
            getUndoStackItem(transaction),
            this,
            new TaskTitleModel(doc),
        );
    }
}

function getUndoStackItem(transaction: Y.Transaction): Y.StackItem {
    const insertions = new Y.DeleteSet();
    for (const [client, endClock] of transaction.afterState) {
        const startClock = transaction.beforeState.get(client) ?? 0;
        const length = endClock - startClock;
        if (length > 0) {
            Y.addToDeleteSet(insertions, client, startClock, length);
        }
    }

    return new Y.StackItem(transaction.deleteSet, insertions);
}

/**
 * Model representing a task title update. Wraps a binary `TaskTitleUpdate` and
 * provides some extra helpers and information for client applications.
 *
 * If you only use `title.replace().newTitle` to get a new title after an
 * update then you'll never be at risk of producing a corrupted title.
 */
export class TaskTitleUpdateModel {
    public readonly raw: TaskTitleUpdate;
    public readonly undoStackItem: Y.StackItem;
    public readonly oldTitle: TaskTitleModel;
    public readonly newTitle: TaskTitleModel;

    constructor(
        raw: TaskTitleUpdate,
        undoStackItem: Y.StackItem,
        oldTitle: TaskTitleModel,
        newTitle: TaskTitleModel,
    ) {
        // In development and test environments, make sure `undoStackItem` isn't
        // mutated by deeply freezing the value. Since deep freezing is a potentially
        // expensive operation we don't do it in production.
        if (process.env.NODE_ENV !== "production") {
            deepFreeze(undoStackItem);
        }

        this.raw = raw;
        this.undoStackItem = undoStackItem;
        this.oldTitle = oldTitle;
        this.newTitle = newTitle;
    }

    /**
     * Invert this update. Used to undo the update. You must pass in the current
     * title since Yjs needs to reference the latest IDs in the Yjs doc to produce
     * an update that will correctly override previous data.
     */
    public invert(currentTitle: TaskTitleModel): TaskTitleUpdateModel | null {
        const doc = currentTitle._cloneDoc();
        const xmlFragment = doc.getXmlFragment("doc");

        const undoManager = new Y.UndoManager(xmlFragment);
        undoManager.undoStack = [this.undoStackItem];

        let update: TaskTitleUpdate | null = null;

        doc.on("updateV2", newUpdate => {
            if (update === null) {
                update = newUpdate;
            } else {
                update = mergeTaskTitleUpdates(update, newUpdate);
            }
        });

        const transaction = doc.transact(transaction => {
            undoManager.undo();

            // make sure that deleted structs are not gc'd
            //
            // NOTE(calebmer): I'm not sure if this is necessary. I couldn't write a unit
            // test that failed when this code was removed. This is necessary in
            // `replace()` but maybe something else is setting `keep = true` on these items
            // making this unnecessary.
            Y.iterateDeletedStructs(transaction, transaction.deleteSet, struct => {
                if (!(struct instanceof Y.Item)) return;

                let item: Y.Item | null = struct;
                while (item !== null && item.keep !== true) {
                    item.keep = true;
                    item = (item.parent as Y.AbstractType<any>)._item;
                }
            });

            return transaction;
        });

        if (update === null) return null;

        return new TaskTitleUpdateModel(
            update,
            getUndoStackItem(transaction),
            currentTitle,
            new TaskTitleModel(doc),
        );
    }
}
