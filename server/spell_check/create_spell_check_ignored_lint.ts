import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {RynamoEvent} from "~/shared/dynamo/rynamo_types.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

export async function createSpellCheckIgnoredLint(
    context: ServerSessionActionContext,
    spellCheckEntityId: SpellCheckEntityId,
    key: string,
    kind: string,
): Promise<{
    getRynamoEventTransaction: (
        context: ServerActionContext,
    ) => Promise<ReadonlyArray<RynamoEvent<SpellCheckIgnoredLintModel>>>;
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
        getRynamoEventTransaction: async context => [await getEvent(context)],
    };
}
