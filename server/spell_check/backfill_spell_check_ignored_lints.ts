import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {RynamoBackfillResult} from "~/shared/dynamo/rynamo_types.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";
import {ServerSynchronizationCheckpoint} from "~/shared/web_socket/server_synchronization_checkpoint.js";

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillSpellCheckIgnoredLints(
    context: ServerActionContext,
    {
        entityId,
        checkpoint,
    }: {
        entityId: SpellCheckEntityId;
        checkpoint: ServerSynchronizationCheckpoint;
    },
): Promise<RynamoBackfillResult<SpellCheckIgnoredLintModel>> {
    await authorizeSpellCheckEntityIdAccess(context, entityId, "View");

    const result = await SpellCheckTable.backfillRealtimeQuery(context, {
        partitionKey: {partitionType: "IgnoredLint", spellCheckEntityId: entityId},
        checkpoint,
    });

    return result;
}
