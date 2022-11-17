import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document_content_schema";
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

export const getDocumentContentSteps = defineNetworkFunction({
    name: "getDocumentContentSteps",
    input: {
        id: Schema.id,
        startVersion: Schema.integer,
        endVersion: Schema.integer,
    },
    output: {
        steps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                invertedStep: DocumentContentStepSchema,
                clientId: Schema.id,
            }),
        ),
    },
});
