import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document-content-schema";
import {defineNetworkChannel} from "~/shared/network/internal/define-network-channel";
import {defineNetworkFunction} from "~/shared/network/internal/define-network-function";
import {Schema} from "~/shared/schema/schema";

export const createDocument = defineNetworkFunction({
    name: "createDocument",
    input: {
        id: Schema.id,
        content: DocumentContentSchema,
    },
    output: {},
});

export const updateDocumentContent = defineNetworkFunction({
    name: "updateDocumentContent",
    input: {
        id: Schema.id,
        version: Schema.integer,
        steps: Schema.array(DocumentContentStepSchema),
        clientId: Schema.id,
    },
    output: {
        newVersion: Schema.integer,
        newSteps: Schema.array(DocumentContentStepSchema),
        conflictingSteps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                clientId: Schema.id,
            }),
        ),
    },
});

export const DocumentNetworkChannel = defineNetworkChannel({
    name: "Document",
    key: {
        documentId: Schema.id,
    },
    messages: {
        UpdateContent: Schema.object({
            type: Schema.value("UpdateContent"),
            newVersion: Schema.integer,
            steps: Schema.array(DocumentContentStepSchema),
            clientId: Schema.id,
        }),
    },
});
