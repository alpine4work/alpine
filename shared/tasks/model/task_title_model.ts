import {Node} from "prosemirror-model";
import {yXmlFragmentToProsemirror} from "y-prosemirror";
import * as Y from "yjs";
import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {
    TaskTitle,
    TaskTitleProsemirrorSchema,
    TaskTitleSchema,
    TaskTitleUpdate,
    applyTaskTitleUpdate,
    emptyTaskTitle,
    getTaskTitleText,
    getYDocGuid,
} from "~/shared/tasks/task_title.js";

export const emptyTaskTitleModel = new Lazy(() => TaskTitleModel.new(emptyTaskTitle.get()));

export const taskFallbackTitle = "Untitled";

/**
 * Return the title string and if the title is empty then return a fallback
 * name like "Untitled".
 */
export function addFallbackToTaskTitle(title: string): string {
    return title.trim().length > 0 ? title : taskFallbackTitle;
}

export type TaskTitleYDoc = Y.Doc & {
    getUndoManager(): Y.UndoManager;
    retain(): void;
    release(): void;
};

/**
 * Model object representing a task's title.
 *
 * It keeps around the previous update to the task title in web browsers for
 * ~1s as an optimization for text editors.
 *
 * It also caches the title text, ProseMirror node, and prepares `Y.Doc`s
 * (on the client) should you need them.
 */
export class TaskTitleModel {
    public readonly raw: TaskTitle;
    private _text: string | null = null;

    private _previousUpdate: {
        readonly rawTitle: TaskTitle;
        readonly titleUpdate: TaskTitleUpdate;
    } | null = null;

    private _preparedYDoc: TaskTitleYDoc | null = null;
    private _prosemirrorNode: Node | null = null;

    public static empty = new Lazy(() => TaskTitleModel.new(emptyTaskTitle.get()));

    public static readonly schema = TaskTitleSchema.transform<TaskTitleModel>({
        serialize: title => title.raw,
        deserialize: title => new TaskTitleModel(title, null),
    });

    private constructor(
        raw: TaskTitle,
        previousUpdate: {
            readonly rawTitle: TaskTitle;
            readonly titleUpdate: TaskTitleUpdate;
        } | null,
    ) {
        this.raw = raw;

        // Previous update is only available in web browsers.
        this._previousUpdate = typeof window !== "undefined" ? previousUpdate : null;

        // In Jest eagerly call `getText()` which caches some data so
        // `expect().toEqual()` never shows uncached data as the reason why two objects
        // don't match. Seeing the cached data can also help determine the difference
        // in a diff.
        if (import.meta.jest) {
            this.getText();
        }

        // The previous title update is available for one second after the model is
        // constructed. Then it's cleared out so it can be garbage collected.
        if (previousUpdate !== null) {
            setTimeout(() => {
                this._previousUpdate = null;
            }, 1000);
        }
    }

    public static new(title: TaskTitle) {
        return new TaskTitleModel(title, null);
    }

    /**
     * Are these two titles equal?
     */
    public isEqual(otherTitle: TaskTitleModel) {
        if (this === otherTitle) return true;
        return areUint8ArraysEqual(this.raw, otherTitle.raw);
    }

    /**
     * Apply an update to our task title. Keeps the update around on the new module
     * object for ~1s as an optimization for editor implementations.
     */
    public apply(titleUpdate: TaskTitleUpdate) {
        return new TaskTitleModel(applyTaskTitleUpdate(this.raw, titleUpdate), {
            rawTitle: this.raw,
            titleUpdate,
        });
    }

    /**
     * Get the text for this title.
     *
     * This method caches the result so subsequent calls have the title available
     * immediately.
     */
    public getText() {
        this._text ??= getTaskTitleText(this.raw);
        return this._text;
    }

    /**
     * Get the previous update which was used to produce this model. The previous
     * update is only available for ~1s after which it's removed from the model to
     * allow for garbage collection.
     *
     * Only available in web browsers. Always returns null in other environments.
     */
    public getPreviousUpdate() {
        return this._previousUpdate;
    }

    private _createAndRetainYDoc(): TaskTitleYDoc {
        const yDoc = new Y.Doc({guid: getYDocGuid()});
        Y.applyUpdateV2(yDoc, this.raw);

        let hasUpdated = false;

        const handleUpdate = () => {
            if (this._preparedYDoc === yDoc) this._preparedYDoc = null;
            hasUpdated = true;
            yDoc.off("updateV2", handleUpdate);
        };

        yDoc.on("updateV2", handleUpdate);

        let yUndoManager: Y.UndoManager | null = null;

        const destroyYDoc = yDoc.destroy.bind(yDoc);
        let destroyYUndoManager: (() => void) | null = null;

        yDoc.destroy = () => {
            // Noop. Can only destroy by calling `release()`.
        };

        (yDoc as any).getUndoManager = () => {
            if (yUndoManager === null) {
                yUndoManager = new Y.UndoManager(yDoc.getXmlFragment("doc"));

                destroyYUndoManager = yUndoManager.destroy.bind(yUndoManager);

                yUndoManager.destroy = () => {
                    // Noop. Can only destroy by calling `release()`. This prevents an issue with
                    // `y-prosemirror`'s `yUndoPlugin()` prematurely trying to destroy our undo
                    // manager which needs to live after the component unmounts.
                };
            }

            return yUndoManager;
        };

        let referenceCount = 1;

        (yDoc as any).retain = () => {
            assert(referenceCount > 0);
            referenceCount++;
        };

        (yDoc as any).release = () => {
            assert(referenceCount > 0);
            referenceCount--;

            if (referenceCount === 0) {
                if (!hasUpdated && this._preparedYDoc === null) {
                    // If we're saving this for later it receives a new reference.
                    referenceCount++;

                    this._preparedYDoc = yDoc as any;
                } else {
                    destroyYDoc();
                    destroyYUndoManager?.();
                }
            }
        };

        return yDoc as any;
    }

    /**
     * Create a `Y.Doc`. As an optimization, we may have a `Y.Doc` already prepared
     * so we return that and create a new `Y.Doc` next time you call this function.
     *
     * The `Y.Doc` we return has a `release()` function. If no changes were made to
     * the `Y.Doc` then releasing will put it back in our `TaskTitleModel` so the
     * next person who calls `createAndRetainYDoc()` gets the already existing
     * object without needing to create a new one. This is nice in our virtualized
     * list when scrolling since we can reuse `Y.Doc`s after a task is scrolled
     * offscreen then back onscreen. You should not use the `Y.Doc` after calling
     * `release()`!
     */
    public createAndRetainYDoc(): TaskTitleYDoc {
        if (this._preparedYDoc !== null) {
            const yDoc = this._preparedYDoc;
            this._preparedYDoc = null;
            return yDoc;
        }

        const yDoc = this._createAndRetainYDoc();

        // Initialize the ProseMirror node when we create a `Y.Doc` so it's ready
        // for later.
        if (this._prosemirrorNode === null) {
            this._prosemirrorNode = yXmlFragmentToProsemirror(
                TaskTitleProsemirrorSchema,
                yDoc.getXmlFragment("doc"),
            );
        }

        return yDoc;
    }

    /**
     * Gets the ProseMirror node for this title. If we've already computed the node
     * we immediately return it. Otherwise we need to compute the node and
     * cache it.
     */
    public getProsemirrorNode(): Node {
        if (this._prosemirrorNode === null) {
            if (this._preparedYDoc === null) {
                this._preparedYDoc = this._createAndRetainYDoc();
            }

            this._prosemirrorNode = yXmlFragmentToProsemirror(
                TaskTitleProsemirrorSchema,
                this._preparedYDoc.getXmlFragment("doc"),
            );
        }

        return this._prosemirrorNode;
    }
}
