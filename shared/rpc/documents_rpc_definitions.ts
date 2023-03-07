import {DocumentContentStepSchema} from "~/shared/content/document_content_schema";
import {ContentEditorClientId, DocumentId} from "~/shared/id/types/id_types";
import {defineRpc} from "~/shared/rpc/internal/define_rpc";
import {Schema} from "~/shared/schema/schema";

export const getDocumentContentSteps = defineRpc({
    name: "getDocumentContentSteps",
    input: {
        id: Schema.id<DocumentId>(),
        startVersion: Schema.integer,
        endVersion: Schema.integer,
    },
    output: {
        steps: Schema.array(
            Schema.object({
                step: DocumentContentStepSchema,
                invertedStep: DocumentContentStepSchema,
                clientId: Schema.id<ContentEditorClientId>(),
            }),
        ),
    },
});
