import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeDocumentAccess} from "~/server/documents/data/documents_actions.js";
import {authorizeTaskAccess} from "~/server/tasks/data/authorization/authorize_task_access.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {
    SpellCheckEntityId,
    parseSpellCheckEntityId,
} from "~/shared/spell_check/spell_check_entity_id.js";

export function authorizeSpellCheckEntityIdAccess(
    context: ServerActionContext,
    spellCheckEntityId: SpellCheckEntityId,
    expectedAccessLevel: AccessLevel,
) {
    const spellCheckEntityIdObject = parseSpellCheckEntityId(spellCheckEntityId);
    switch (spellCheckEntityIdObject.type) {
        case "Document":
            return authorizeDocumentAccess(
                context,
                spellCheckEntityIdObject.documentId,
                expectedAccessLevel,
            );
        case "Task":
            return authorizeTaskAccess(
                context,
                spellCheckEntityIdObject.taskId,
                expectedAccessLevel,
            );
    }
}
