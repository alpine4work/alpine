import {decodeBase64, encodeBase64} from "~/shared/helpers/binary/base64.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {DocumentId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorSelectionSchema,
    ProsemirrorSelectionWrapper,
} from "~/shared/prosemirror/prosemirror_selection_schema.js";
import {Schema} from "~/shared/schema/schema.js";

export type MobileContentEditorLinkRouteState = {
    readonly type: "Document";
    readonly documentId: DocumentId;
    readonly selection: ProsemirrorSelectionWrapper;
    readonly initialText: string;
    readonly isTextEditable: boolean;
    readonly initialUrl: string;
};

// Schema for the state. We use an efficient tuple format encoded in base64 for
// space efficiency in the URL.
export const MobileContentEditorLinkRouteStateSchema =
    Schema.string.transform<MobileContentEditorLinkRouteState>({
        serialize: state => {
            const stateString = JSON.stringify(
                MobileContentEditorLinkRouteStateObjectSchema.serialize(state),
            );

            const encoder = new TextEncoder();
            const stateBytes = encoder.encode(stateString);

            return encodeBase64(stateBytes, "Rfc4648Url");
        },
        deserialize: serializedState => {
            const stateBytes = decodeBase64(serializedState, "Rfc4648Url");

            const decoder = new TextDecoder();
            const stateString = decoder.decode(stateBytes);

            return MobileContentEditorLinkRouteStateObjectSchema.deserialize(
                JSON.parse(stateString),
            );
        },
    });

const MobileContentEditorLinkRouteStateObjectSchema = Schema.tuple([
    Schema.enum([1]),
    Schema.id(),
    ProsemirrorSelectionSchema,
    Schema.string,
    Schema.enum([0, 1]),
    Schema.string,
]).transform<MobileContentEditorLinkRouteState>({
    serialize: state => {
        // If we ever have different types, TypeScript will throw an error here.
        cast<"Document">(state.type);

        return [
            1,
            state.documentId,
            state.selection,
            state.initialText,
            state.isTextEditable ? 1 : 0,
            state.initialUrl,
        ];
    },
    deserialize: state => {
        cast<1>(state[0]);

        return {
            type: "Document",
            documentId: state[1] as DocumentId,
            selection: state[2],
            initialText: state[3],
            isTextEditable: state[4] === 1,
            initialUrl: state[5],
        };
    },
});
