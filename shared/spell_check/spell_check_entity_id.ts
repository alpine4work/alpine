import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {DocumentId, TaskId} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

export type SpellCheckEntityId = `Document:${DocumentId}` | `Task:${TaskId}`;

export const SpellCheckEntityIdSchema = Schema.string as Schema<SpellCheckEntityId>;

/**
 * Parsed representation of a `SpellCheckEntityId` string for easier manipulation.
 * Convert `SpellCheckEntityId` to this object with `parseSpellCheckEntityId()`.
 */
export type SpellCheckEntityIdObject =
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Task"; readonly taskId: TaskId};

/**
 * Parse a `SpellCheckEntityId` into a more convenient to use object format.
 */
export function parseSpellCheckEntityId(id: SpellCheckEntityId): SpellCheckEntityIdObject {
    const [idType, idPayload] = id.split(":");
    const idPayloadParts = idPayload?.split("-") ?? [];

    switch (idType) {
        case "Document":
            return {type: "Document", documentId: idPayloadParts[0] as DocumentId};
        case "Task":
            return {type: "Task", taskId: idPayloadParts[0] as TaskId};
        default:
            throw new InternalError(
                quote`Unrecognized \`SpellCheckEntityId\` type ${idType ?? ""}`,
            );
    }
}
