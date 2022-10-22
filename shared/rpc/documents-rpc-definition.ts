import {DocumentContentSchema} from "~/shared/documents/document-content-schema";
import {defineRpc} from "~/shared/rpc/internal/define-rpc";
import {Schema} from "~/shared/schema/schema";

export const createDocument = defineRpc({
    name: "createDocument",
    input: {
        id: Schema.id,
        content: DocumentContentSchema,
    },
    output: {},
});
