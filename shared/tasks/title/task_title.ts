import {Node, Schema as ProsemirrorSchema, Slice} from "prosemirror-model";
import {
    absolutePositionToRelativePosition,
    prosemirrorToYXmlFragment,
    relativePositionToAbsolutePosition,
    yXmlFragmentToProsemirror,
} from "y-prosemirror";
import * as Y from "yjs";
import {Snapshot} from "yjs";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {deepFreeze} from "~/shared/helpers/control/deep_freeze.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {decodeId} from "~/shared/id/id.js";
import {getRealmId} from "~/shared/id/realm_id.js";
import {Schema} from "~/shared/schema/schema.js";

export const taskTitleMaxLength = 512;

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

// Put this in a constant so Jest `expect().toEqual()` checks will pass.
const gcFilter = () => true;

/**
 * Create a Yjs doc where the `clientID` is based on the `RealmId`
 * (specifically the first 32 bytes). We expect the code within a JavaScript
 * realm to NOT create conflicting updates.
 *
 * We create a Yjs document without using the initializer for more control and
 * for performance. (For instance, while profiling task grid view scrolling we
 * found Yjs's implementation of `guid` generation to be slow.)
 */
function createDoc({clientIdForTest}: {clientIdForTest?: number} = {}): Y.Doc {
    const doc = Object.create(Y.Doc.prototype);

    // Can only change the client ID in tests.
    if (!import.meta.jest) {
        assert(clientIdForTest === undefined);
    }

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
        value: clientIdForTest ?? realmTaskTitleClientId.get(),
    });

    // Make sure the Yjs GC is enabled.
    doc.gc = true;
    doc.gcFilter = gcFilter;

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
function cloneDoc(doc: Y.Doc, options?: {clientIdForTest?: number}): Y.Doc {
    const clonedDoc = createDoc(options);
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
 *
 * An empty `TaskTitle` contains no client IDs which means it can be freely
 * merged with any title without fear of conflicting updates.
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

    return text.substring(0, taskTitleMaxLength);
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
export function createTaskTitleFromText(
    titleText: string,
    options?: {clientIdForTest?: number},
): TaskTitle {
    const prosemirrorNode = TaskTitleProsemirrorSchema.node(
        "doc",
        {},
        titleText.length > 0 ? [TaskTitleProsemirrorSchema.text(titleText)] : [],
    );

    const doc = createDoc(options);
    prosemirrorToYXmlFragment(prosemirrorNode, doc.getXmlFragment("doc"));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitle;
}

/**
 * A Yjs update to a `TaskTitle`.
 */
export type TaskTitleUpdate = Uint8Array & {readonly _TaskTitleUpdate: never};

export const TaskTitleUpdateSchema = Schema.bytes as any as Schema<TaskTitleUpdate>;

export function applyTaskTitleUpdate(title: TaskTitle, titleUpdate: TaskTitleUpdate): TaskTitle {
    // We don't use `Y.mergeUpdatesV2()` because the result won't be in an
    // optimized form. Specifically, adjacent items won't be merged. See the test
    // "applying task title update to task title produces optimized form" for an
    // example.
    const doc = createDoc();
    Y.applyUpdateV2(doc, assertExists(title));
    Y.applyUpdateV2(doc, assertExists(titleUpdate));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitle;
}

export function mergeTaskTitleUpdates(
    titleUpdate1: TaskTitleUpdate,
    titleUpdate2: TaskTitleUpdate,
): TaskTitleUpdate {
    // We don't use `Y.mergeUpdatesV2()` because the result won't be in an
    // optimized form. Specifically, adjacent items won't be merged. See the test
    // "applying task title update to task title produces optimized form" for an
    // example.
    const doc = createDoc();
    Y.applyUpdateV2(doc, assertExists(titleUpdate1));
    Y.applyUpdateV2(doc, assertExists(titleUpdate2));
    return Y.encodeStateAsUpdateV2(doc) as TaskTitleUpdate;
}

/**
 * A Yjs snapshot of a `TaskTitle` at some state. Yjs snapshots can be used to
 * tell if two `TaskTitle`s are identical without needing the full `TaskTitle`.
 * Snapshots only contain version information from a `TaskTitle` at a specific
 * point in time.
 *
 * Yjs snapshots can be used to restore Yjs docs to a specific point in time
 * but only if the Yjs doc has GC disabled (`gc: false`). When GC is disabled a
 * Yjs doc contains its entire editing history. When GC is enabled this isn't
 * the case.
 *
 * [Yjs snapshots aren't currently documented][1].
 *
 * [1]: https://discuss.yjs.dev/t/documentation-for-yjs-snapshots
 */
export type TaskTitleSnapshot = Uint8Array & {readonly _TaskTitleSnapshot: never};

export const TaskTitleSnapshotSchema = Schema.bytes as any as Schema<TaskTitleSnapshot>;

export function decodeTaskTitleSnapshot(snapshot: TaskTitleSnapshot): Snapshot {
    return Y.decodeSnapshotV2(snapshot);
}

export const emptyTaskTitleModel = new Lazy(() => new TaskTitleModel(emptyTaskTitle.get()));

export const emptyTaskTitleUpdateModel = new Lazy(
    () =>
        new TaskTitleUpdateModel(
            emptyTaskTitle.get(),
            new Y.StackItem(new Y.DeleteSet(), new Y.DeleteSet()),
            emptyTaskTitleModel.get(),
            emptyTaskTitleModel.get(),
        ),
);

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
 * ### Avoid conflicting updates
 *
 * You must be a little careful to avoid conflicting updates. All updates
 * created in this JavaScript realm have the same Yjs `clientID`. If you
 * generate two conflicting updates within the JavaScript realm an error will
 * be thrown when you try to apply the update. Here's an example of how you
 * might cause conflicting updates:
 *
 * ```ts
 * const title1 = emptyTaskTitleModel.get();
 * const updateA = title1.replace(0, 0, "a");
 * const updateB = title1.replace(0, 0, "b");
 * const title2 = title1.apply(updateA);
 * const title3 = title2.apply(updateB);
 * ```
 *
 * This will throw an error because under the hood `updateA` and `updateB`
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
 * const updateA = title1.replace(0, 0, "a");
 * const title2 = updateA.newTitle;
 * const updateB = title2.replace(0, 0, "b");
 * const title3 = updateB.newTitle;
 * ```
 *
 * This is fine since the ID for `"a"` will be `(realmId, 0)` and the ID for
 * `"b"` will be `(realmId, 1)` since we generate the `"b"` update on top of
 * the `"a"` update.
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
    private _snapshot: TaskTitleSnapshot | null = null;

    constructor(doc: Y.Doc | TaskTitle) {
        if (doc instanceof Y.Doc) {
            // In development and test environments, make sure `doc` isn't mutated by
            // deeply freezing the value. Since deep freezing is a potentially expensive
            // operation we don't do it in production.
            //
            // We only freeze `doc.store` since sometimes Yjs creates transactions in code
            // read paths.
            if (process.env.NODE_ENV !== "production") {
                // Make sure we initialize the type so it's available later.
                doc.getXmlFragment("doc");

                deepFreeze(
                    doc.store,
                    // Don't freeze `Uint8Array`. It'll throw with an error message of: "Cannot
                    // freeze array buffer views with elements". We accept this limitation.
                    // Hopefully freezing the rest of the object is sufficient for making sure there
                    // are no more mutations on the doc.
                    value => !(value instanceof Uint8Array),
                );
            }

            this._doc = doc;
            this._raw = null;
        } else {
            this._doc = null;
            this._raw = doc;
        }
    }

    public static fromText(text: string, options?: {clientIdForTest?: number}) {
        const prosemirrorNode = TaskTitleProsemirrorSchema.node("doc", {}, [
            TaskTitleProsemirrorSchema.text(text),
        ]);

        const doc = createDoc(options);
        prosemirrorToYXmlFragment(prosemirrorNode, doc.getXmlFragment("doc"));

        return new TaskTitleModel(doc);
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
                // Make sure we initialize the type so it's available later.
                doc.getXmlFragment("doc");

                deepFreeze(
                    doc.store,
                    // Don't freeze `Uint8Array`. It'll throw with an error message of: "Cannot
                    // freeze array buffer views with elements". We accept this limitation.
                    // Hopefully freezing the rest of the object is sufficient for making sure there
                    // are no more mutations on the doc.
                    value => !(value instanceof Uint8Array),
                );
            }

            this._doc = doc;
        }

        return this._doc;
    }

    public getDocForTest() {
        assert(import.meta.jest);
        return this._getDoc();
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
     * Get the Yjs CRDT snapshot for this title.
     */
    public getSnapshot(): TaskTitleSnapshot {
        this._snapshot ??= Y.encodeSnapshotV2(Y.snapshot(this._getDoc())) as TaskTitleSnapshot;
        return this._snapshot;
    }

    /**
     * Are these two titles equal?
     */
    public isEqual(otherTitle: TaskTitleModel): boolean {
        if (this === otherTitle) return true;
        return areUint8ArraysEqual(this.getRaw(), otherTitle.getRaw());
    }

    /**
     * Convert a ProseMirror absolute position into a Yjs relative position.
     */
    public intoRelativePosition(pos: number): Y.RelativePosition {
        return absolutePositionToRelativePosition(
            pos,
            this._getDoc().getXmlFragment("doc"),
            // @ts-expect-error: A read-only map should be fine. This function shouldn't
            // perform any mutations on the map. An empty map should be fine. We only need
            // mappings for `Y.XmlElement`s.
            emptyMap,
        );
    }

    /**
     * Convert a Yjs relative position back into a ProseMirror absolute position.
     */
    public fromRelativePosition(relativePosition: Y.RelativePosition): number | null {
        const doc = this._getDoc();

        return relativePositionToAbsolutePosition(
            doc,
            doc.getXmlFragment("doc"),
            relativePosition,
            // @ts-expect-error: A read-only map should be fine. This function shouldn't
            // perform any mutations on the map. An empty map should be fine. We only need
            // mappings for `Y.XmlElement`s.
            emptyMap,
        );
    }

    /**
     * Clones the underlying Yjs doc. You should only call this in `task_title.ts`.
     * That's why it's prefixed with an underscore.
     */
    public _cloneDoc(options?: {clientIdForTest?: number}): Y.Doc {
        return cloneDoc(this._getDoc(), options);
    }

    /**
     * Create a task title update using the same properties as ProseMirror's
     * `ReplaceStep`. You can use this to translate ProseMirror updates into Yjs
     * updates.
     *
     * You have to be a little careful to avoid corrupting your task title. See the
     * comment on `TaskTitleModel` for more information.
     */
    public replace(
        from: number,
        to: number,
        text: string,
        options?: {clientIdForTest?: number},
    ): TaskTitleUpdateModel {
        return this.replaceMany([{from, to, text}], options);
    }

    /**
     * Create a task title update using the same properties as ProseMirror's
     * `ReplaceStep` using multiple steps. You can use this to translate
     * ProseMirror updates into Yjs updates.
     *
     * You have to be a little careful to avoid corrupting your task title. See the
     * comment on `TaskTitleModel` for more information.
     */
    public replaceMany(
        steps: Iterable<{from: number; to: number} & ({text: string} | {slice: Slice})>,
        options?: {clientIdForTest?: number},
    ): TaskTitleUpdateModel {
        return this.replaceManyWithStepWithTruncatedCharacterCount(steps, options).update;
    }

    /**
     * Create a task title update using the same properties as ProseMirror's
     * `ReplaceStep` using multiple steps. You can use this to translate
     * ProseMirror updates into Yjs updates. This also returns extra metadata
     * useful for tracking UI state based on the steps applied.
     *
     * You have to be a little careful to avoid corrupting your task title. See the
     * comment on `TaskTitleModel` for more information.
     */
    public replaceManyWithStepWithTruncatedCharacterCount(
        steps: Iterable<{from: number; to: number} & ({text: string} | {slice: Slice})>,
        options?: {clientIdForTest?: number},
    ): {update: TaskTitleUpdateModel; truncatedCharacterCount: number} {
        const doc = cloneDoc(this._getDoc(), options);
        const fragment = doc.getXmlFragment("doc");

        let update: TaskTitleUpdate | null = null;

        doc.on("updateV2", newUpdate => {
            if (update === null) {
                update = newUpdate;
            } else {
                update = mergeTaskTitleUpdates(update, newUpdate);
            }
        });

        let isEmptyFromTruncation = true;
        let truncatedCharacters = 0;

        const transaction = doc.transact(transaction => {
            let hasSteps = false;

            for (const step of steps) {
                hasSteps = true;

                const {from, to} = step;
                let finalFrom = from;
                let finalTo = to;

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

                assert(Number.isSafeInteger(from), "Step `from` must be an integer");
                assert(Number.isSafeInteger(to), "Step `to` must be an integer");
                assert(to >= from, "Step `to` must be greater than or equal to `from`");
                assert(from >= 0, "Step `from` must be greater than or equal to 0");
                assert(from !== to || text.length > 0, "Step must either delete or insert text");

                // Calculate current text length and enforce character limit
                let currentLength = 0;
                let child = fragment.firstChild;
                while (child !== null) {
                    // Task titles only contain text nodes for now.
                    assert(child instanceof Y.XmlText);
                    currentLength += child.length;
                    child = child.nextSibling;
                }

                const deletedLength = to - from;
                const finalLengthAfterDeletion = currentLength - deletedLength;
                const maxAllowedInsertLength = Math.max(
                    0,
                    taskTitleMaxLength - finalLengthAfterDeletion,
                );

                // isEmptyFromTruncation should only be true if ALL steps result in an empty
                // text _strictly_ due to truncation. As soon as we see a step that has any allowed
                // insert length, we know the final result can't be empty due to truncation alone.
                if (maxAllowedInsertLength > 0) {
                    isEmptyFromTruncation = false;
                }

                // Truncate the text if it would exceed the limit
                if (text.length > maxAllowedInsertLength) {
                    truncatedCharacters = text.length - maxAllowedInsertLength;
                    text = text.substring(0, maxAllowedInsertLength);

                    finalTo -= truncatedCharacters;
                    if (finalFrom > taskTitleMaxLength) {
                        finalFrom = taskTitleMaxLength;
                    }
                }

                // Our task title is a simple string, for now. There shouldn't be nested
                // `Y.XmlElement`s.
                assert(fragment.firstChild === null || fragment.firstChild instanceof Y.XmlText);

                if (fragment.firstChild === null) {
                    assert(finalTo <= 0, "`to` is out of bounds");

                    if (text.length > 0) {
                        fragment.insert(0, [new Y.XmlText(text)]);
                    }
                } else {
                    let untilFromChildLength = 0;
                    let untilToChildLength = 0;
                    let fromChild: Y.XmlText | null = null;
                    let toChild: Y.XmlElement | Y.XmlText | null = fragment.firstChild;
                    while (toChild !== null) {
                        assert(toChild instanceof Y.XmlText);

                        untilToChildLength += toChild.length;

                        if (fromChild === null && finalFrom <= untilToChildLength) {
                            untilFromChildLength = untilToChildLength;
                            fromChild = toChild;
                        }

                        if (finalTo <= untilToChildLength) break;

                        toChild = toChild.nextSibling;
                    }

                    assert(toChild !== null, "Step `to` is out of bounds");
                    assert(fromChild !== null);

                    const fromChildLengthBeforeDelete = fromChild.length;

                    if (finalFrom !== finalTo) {
                        let remainingDeleteLength = finalTo - finalFrom;
                        let deleteChild: Y.XmlElement | Y.XmlText | null = fromChild;

                        while (remainingDeleteLength > 0) {
                            assert(deleteChild instanceof Y.XmlText);

                            const deleteFrom =
                                deleteChild === fromChild
                                    ? finalFrom - (untilFromChildLength - fromChild.length)
                                    : 0;

                            const deleteLength = Math.min(
                                remainingDeleteLength,
                                deleteChild.length - deleteFrom,
                            );

                            deleteChild.delete(deleteFrom, deleteLength);

                            remainingDeleteLength -= deleteLength;
                            deleteChild = deleteChild.nextSibling;
                        }
                    }

                    if (text.length > 0) {
                        fromChild.insert(
                            finalFrom - (untilFromChildLength - fromChildLengthBeforeDelete),
                            text,
                        );
                    }
                }
            }

            assert(hasSteps, "Must have at least one step");

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

        const finalUpdate: TaskTitleUpdate = isEmptyFromTruncation
            ? emptyTaskTitle.get()
            : // TypeScript thinks `update` is null even though we assign to it in the
              // `"updateV2"` event handler.
              assertExists<TaskTitleUpdate>(update);

        return {
            update: new TaskTitleUpdateModel(
                finalUpdate,
                getUndoStackItem(transaction),
                this,
                new TaskTitleModel(doc),
            ),
            truncatedCharacterCount: truncatedCharacters,
        };
    }

    /**
     * Create a task title update that clears everything from the title. This is a
     * little different from `replace(0, length, "")` since it also clears some XML
     * structural metadata from the Yjs doc.
     */
    public clear(options?: {clientIdForTest?: number}) {
        const doc = cloneDoc(this._getDoc(), options);
        const fragment = doc.getXmlFragment("doc");

        let update: TaskTitleUpdate | null = null;

        doc.on("updateV2", newUpdate => {
            if (update === null) {
                update = newUpdate;
            } else {
                update = mergeTaskTitleUpdates(update, newUpdate);
            }
        });

        const transaction = doc.transact(transaction => {
            while (fragment.firstChild !== null) {
                fragment.delete(0);
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

        return new TaskTitleUpdateModel(
            // @ts-expect-error: TypeScript thinks `update` is null even though we assign
            // to it in the `"updateV2"` event handler.
            assertExists(update, "Can\u2019t clear if already empty"),
            getUndoStackItem(transaction),
            this,
            new TaskTitleModel(doc),
        );
    }

    /**
     * Apply an update to the task title.
     *
     * Prefer passing in `TaskTitleUpdateModel` since we may be able to use an
     * optimized path where we can return `update.newTitle` instead of applying the
     * update from scratch.
     */
    public apply(
        update: TaskTitleModel | TaskTitleUpdateModel | TaskTitleUpdate,
        options?: {clientIdForTest?: number},
    ): TaskTitleModel {
        if (update instanceof TaskTitleUpdateModel) {
            if (update.oldTitle === this) {
                return update.newTitle;
            }

            update = update.raw;
        } else if (update instanceof TaskTitleModel) {
            update = update.getRaw();
        }

        const doc = cloneDoc(this._getDoc(), options);
        Y.applyUpdateV2(doc, update);

        return new TaskTitleModel(doc);
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

function cloneDeleteSet(deleteSet: Y.DeleteSet): Y.DeleteSet {
    const newDeleteSet = new Y.DeleteSet();

    for (const [clientId, items] of deleteSet.clients) {
        newDeleteSet.clients.set(
            clientId,
            items.map(item => new Y.DeleteItem(item.clock, item.len)),
        );
    }

    return newDeleteSet;
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
     * Merge two updates together.
     */
    public merge(other: TaskTitleUpdateModel): TaskTitleUpdateModel {
        return new TaskTitleUpdateModel(
            mergeTaskTitleUpdates(this.raw, other.raw),
            new Y.StackItem(
                Y.mergeDeleteSets([
                    cloneDeleteSet(this.undoStackItem.deletions),
                    cloneDeleteSet(other.undoStackItem.deletions),
                ]),
                Y.mergeDeleteSets([
                    cloneDeleteSet(this.undoStackItem.insertions),
                    cloneDeleteSet(other.undoStackItem.insertions),
                ]),
            ),
            this.oldTitle,
            this.newTitle.apply(other),
        );
    }

    /**
     * Invert this update. Used to undo the update. You must pass in the current
     * title since Yjs needs to reference the latest IDs in the Yjs doc to produce
     * an update that will correctly override previous data.
     */
    public invert(
        currentTitle: TaskTitleModel,
        options?: {clientIdForTest?: number},
    ): TaskTitleUpdateModel | null {
        const doc = currentTitle._cloneDoc(options);
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
