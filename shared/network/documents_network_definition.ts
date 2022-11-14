import {DocumentContentSchema} from "~/shared/documents/document_content_schema";
import {defineNetworkFunction} from "~/shared/network/internal/define_network_function";
import {Schema} from "~/shared/schema/schema";

export const createDocument = defineNetworkFunction({
    name: "createDocument",
    input: {
        id: Schema.id,
        content: DocumentContentSchema,
    },
    output: {},
});
