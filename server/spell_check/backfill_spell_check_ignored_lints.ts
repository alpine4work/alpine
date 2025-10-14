import {ServerActionContext} from "~/server/context/server_action_context.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {DynamoGeneralRealtimeBackfillResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

/**
 * Backfill any realtime updates to catch up our client after it's been
 * disconnected from realtime.
 */
export async function backfillSpellCheckIgnoredLints(
    context: ServerActionContext,
    {
        entityId,
        readTime,
    }: {
        entityId: SpellCheckEntityId;
        readTime: Date;
    },
): Promise<DynamoGeneralRealtimeBackfillResult<SpellCheckIgnoredLintModel>> {
    await authorizeSpellCheckEntityIdAccess(context, entityId, "View");

    const result = await SpellCheckTable.backfillRealtimeQuery(context, {
        partitionKey: {partitionType: "IgnoredLint", spellCheckEntityId: entityId},
        readTime,
    });

    return result;
}
