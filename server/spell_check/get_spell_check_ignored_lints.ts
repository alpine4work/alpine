import {ServerActionContext} from "~/server/context/server_action_context.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {authorizeSpellCheckEntityIdAccess} from "~/server/spell_check/authorize_spell_check_entity_id_access.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {DynamoGeneralRealtimeQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";
import {SpellCheckEntityId} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

export async function getSpellCheckIgnoredLints(
    context: ServerActionContext,
    spellCheckEntityId: SpellCheckEntityId,
): Promise<DynamoGeneralRealtimeQueryResult<SpellCheckIgnoredLintModel>> {
    await authorizeSpellCheckEntityIdAccess(context, spellCheckEntityId, "View");

    const ignoredLints = await SpellCheckTable.realtimeQuery(context, {
        partitionKey: {partitionType: "IgnoredLint", spellCheckEntityId},
        startSortKey: {
            sortRangeType: "Attributes",
            key: minLabelString,
            kind: minLabelString,
        },
        endSortKey: {
            sortRangeType: "Attributes",
            key: maxLabelStringForDynamoKeyAttribute,
            kind: maxLabelStringForDynamoKeyAttribute,
        },
        limit: "All",
    });

    return ignoredLints;
}

/**
 * Creates a DynamoGeneralRealtimeQueryResult with an empty result of SpellCheckIgnoredLintModels
 * for the given entity ID. This is useful for ghost entities that have not yet
 * been persisted to the database.
 */
export function createEmptySpellCheckIgnoredLintsForNewEntity(
    spellCheckEntityId: SpellCheckEntityId,
): DynamoGeneralRealtimeQueryResult<SpellCheckIgnoredLintModel> {
    return SpellCheckTable.realtimeQueryIfYouAreCertainThePartitionIsEmpty({
        partitionKey: {partitionType: "IgnoredLint", spellCheckEntityId},
        startSortKey: {
            sortRangeType: "Attributes",
            key: minLabelString,
            kind: minLabelString,
        },
        endSortKey: {
            sortRangeType: "Attributes",
            key: maxLabelStringForDynamoKeyAttribute,
            kind: maxLabelStringForDynamoKeyAttribute,
        },
    });
}
