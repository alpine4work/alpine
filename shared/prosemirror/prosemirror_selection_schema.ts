import {Node} from "prosemirror-model";
import {Selection} from "prosemirror-state";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {Schema, SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * A schema representing a Prosemirror `Selection` object.
 *
 * In order to deserialize a `Selection` you need access to the ProseMirror
 * `Node` which it is for. So we wrap the selection in a class that requires
 * you to always provided the `Node` associated with the `Selection` when
 * trying to access the selection.
 */
export const ProsemirrorSelectionSchema = Schema.unknown.transform<ProsemirrorSelectionWrapper>({
    serialize: selection => selection.toJSON(),
    deserialize: selection => {
        try {
            return ProsemirrorSelectionWrapper.fromJSON(selection);
        } catch (error) {
            throw SchemaDeserializationError.from(error);
        }
    },
});

type ProsemirrorSelectionWrapperData =
    | {
          isJson: true;
          selection: SchemaSerializedValue;
      }
    | {
          isJson: false;
          selection: Selection;
      };

/**
 * A selection wrapper wraps a `Selection` object that may or may not be
 * deserialized. You must always provide a `Node` when accessing the
 * `Selection` so if it is serialized we may deserialize it.
 *
 * If the `Selection` is deserialized, passing in a `Node` does nothing.
 */
export class ProsemirrorSelectionWrapper {
    private constructor(private _data: ProsemirrorSelectionWrapperData) {}

    public static new(selection: Selection): ProsemirrorSelectionWrapper {
        return new ProsemirrorSelectionWrapper({isJson: false, selection});
    }

    public static fromJSON(selection: SchemaSerializedValue): ProsemirrorSelectionWrapper {
        return new ProsemirrorSelectionWrapper({
            isJson: true,
            selection,
        });
    }

    public getAndMaybeDeserialize(doc: Node): Selection {
        if (this._data.isJson) {
            try {
                this._data = {
                    isJson: false,
                    selection: Selection.fromJSON(doc, this._data.selection),
                };
            } catch (error) {
                // Classify deserialization error as a `FailedPreconditionError` since the
                // selection needs to match the document.
                throw FailedPreconditionError.from(error);
            }
        }
        return this._data.selection;
    }

    public toJSON(): SchemaSerializedValue {
        if (this._data.isJson) {
            return this._data.selection;
        } else {
            return this._data.selection.toJSON();
        }
    }
}
