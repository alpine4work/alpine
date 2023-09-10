import {areUint8ArraysEqual} from "~/shared/helpers/binary/are_uint8_arrays_equal.js";
import {
    TaskTitle,
    TaskTitleSchema,
    TaskTitleUpdate,
    applyTaskTitleUpdate,
    getTaskTitleText,
} from "~/shared/tasks/task_title.js";

/**
 * Model object representing a task's title.
 *
 * It keeps around the previous update to the task title in web browsers for
 * ~1s as an optimization for text editors.
 *
 * It also caches the title text should you need it.
 */
export class TaskTitleModel {
    public readonly raw: TaskTitle;
    private _text: string | null = null;

    private _previousUpdate: {
        readonly rawTitle: TaskTitle;
        readonly titleUpdate: TaskTitleUpdate;
    } | null = null;

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
}
