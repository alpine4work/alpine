import {Node} from "prosemirror-model";
import {Selection} from "prosemirror-state";
import {
    ContentTableCellSelection,
    ContentTableCellSelectionJson,
} from "~/shared/content/table/content_table_cell_selection.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {Schema, SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * A schema representing a Prosemirror `Selection` object.
 *
 * In order to deserialize a `Selection` you need access to the ProseMirror
 * `Node` which it is for. So we wrap the selection in a class that requires
 * you to always provided the `Node` associated with the `Selection` when
 * trying to access the selection.
 */
export const ContentSelectionSchema = Schema.unknown().transform<ContentSelectionWrapper>({
    serialize: selection => selection.toJSON(),
    deserialize: selection => {
        try {
            return ContentSelectionWrapper.fromJSON(selection);
        } catch (error) {
            throw SchemaDeserializationError.from(error);
        }
    },
});

type ContentSelectionWrapperData =
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
export class ContentSelectionWrapper {
    private constructor(private _data: ContentSelectionWrapperData) {}

    public static new(selection: Selection): ContentSelectionWrapper {
        return new ContentSelectionWrapper({isJson: false, selection});
    }

    public static fromJSON(selection: SchemaSerializedValue): ContentSelectionWrapper {
        return new ContentSelectionWrapper({
            isJson: true,
            selection,
        });
    }

    public getAndMaybeDeserialize(doc: Node): Selection {
        if (this._data.isJson) {
            try {
                this._data = {
                    isJson: false,
                    selection:
                        // NOTE(calebmer): We don't register the cell selection class with
                        // `Selection.jsonID()`. Because our hot reloading implementation makes global
                        // registry patterns like the one used by `Selection.jsonID()` difficult (if
                        // not impossible) to work with. Since if we hot reload this file then
                        // `Selection.jsonID()` will be called twice for the type `"cell"` which throws
                        // an error. Instead if you're serializing a selection from JSON you should be
                        // using `ContentSelectionSchema` which has built-in knowledge of cell
                        // selections.
                        isObject(this._data.selection) && this._data.selection.type === "cell"
                            ? ContentTableCellSelection.fromJSON(
                                  doc,
                                  this._data.selection as ContentTableCellSelectionJson,
                              )
                            : Selection.fromJSON(doc, this._data.selection),
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
