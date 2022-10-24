import {DocumentContentStepSchema} from "~/shared/documents/document-content-schema";
import {defineRealtimeChannel} from "~/shared/realtime/internal/define-realtime-channel";
import {Schema} from "~/shared/schema/schema";

export const DocumentRealtimeChannel = defineRealtimeChannel({
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
