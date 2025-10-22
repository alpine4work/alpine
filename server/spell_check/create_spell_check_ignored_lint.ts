import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {DynamoGeneralRealtimeEvent} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

export async function createSpellCheckIgnoredLint(
    context: ServerSessionActionContext,
    spellCheckEntityId: SpellCheckEntityId,
    key: string,
    kind: string,
): Promise<{
    getDynamoGeneralRealtimeEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<DynamoGeneralRealtimeEvent<SpellCheckIgnoredLintModel>>>;
}> {
    await authorizeSpellCheckEntityIdAccess(context, spellCheckEntityId, "Edit");

    const createdTime = new Date();
    const creatorId = context.actor.getAccountId();

    const {getEvent} = await SpellCheckTable.createItem(context, {
        partitionType: "IgnoredLint",
        sortRangeType: "Attributes",
        spellCheckEntityId,
        key,
        kind,
        createdTime,
        creatorId,
    });

    return {
        getDynamoGeneralRealtimeEventTransaction: async context => [await getEvent(context)],
    };
}
