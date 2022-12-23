import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document_content_schema";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const createDocument = defineRpc({
    name: "createDocument",
    input: {
        id: Schema.id,
        spaceId: Schema.id,
        content: DocumentContentSchema,
    },
    output: {},
});

export const getDocumentContentSteps = defineRpc({
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
