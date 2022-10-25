import {
    DocumentContentSchema,
    DocumentContentStepSchema,
} from "~/shared/documents/document-content-schema";
import {Schema, SchemaType} from "~/shared/schema/schema";

export const DocumentCollaborationCommittedStepSchema = Schema.object({
    step: DocumentContentStepSchema,
    version: Schema.integer,
});
export type DocumentCollaborationCommittedStep = SchemaType<
    typeof DocumentCollaborationCommittedStepSchema
>;

/* ========================================================================== *\
 * Messages from server                                                       *
\* ========================================================================== */
const DocumentCollaborationStepsMessageFromServerSchema = Schema.object({
    type: Schema.value("steps"),
    steps: Schema.array(DocumentContentStepSchema),
    clientId: Schema.id,
    version: Schema.integer,
});

export const DocumentCollaborationMessageFromServerSchema = Schema.union({
    steps: DocumentCollaborationStepsMessageFromServerSchema,
});
export type DocumentCollaborationMessageFromServer = SchemaType<
    typeof DocumentCollaborationMessageFromServerSchema
>;

/* ========================================================================== *\
 * Messages from client                                                       *
\* ========================================================================== */
const DocumentCollaborationListenSinceMessageFromClientSchema = Schema.object({
    type: Schema.value("listenSince"),
    version: Schema.integer,
});

const DocumentCollaborationStepsMessageFromClientSchema = Schema.object({
    type: Schema.value("steps"),
    version: Schema.integer,
    clientId: Schema.id,
    steps: Schema.array(DocumentContentStepSchema),
});

export const DocumentCollaborationMessageFromClientSchema = Schema.union({
    listenSince: DocumentCollaborationListenSinceMessageFromClientSchema,
    steps: DocumentCollaborationStepsMessageFromClientSchema,
});

export type DocumentCollaborationMessageFromClient = SchemaType<
    typeof DocumentCollaborationMessageFromClientSchema
>;

/* ========================================================================== *\
 * HTTP Responses                                                             *
\* ========================================================================== */
function createResponse<T>(schema: Schema<T>) {
    return {
        send: (value: T) => {
            return new Response(JSON.stringify(schema.serialize(value)), {
                headers: {
                    "Content-Type": "application/json",
                },
            });
        },
        receive: async (response: Response) => {
            return schema.deserialize(await response.json());
        },
    };
}

export const DocumentCollaborationReadSnapshotResponse = createResponse(
    Schema.object({
        version: Schema.integer,
        snapshot: DocumentContentSchema,
    }),
);
