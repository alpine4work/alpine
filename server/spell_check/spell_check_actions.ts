import {
    ServerActionContext,
    ServerSessionActionContext,
} from "~/server/context/server_action_context.js";
import {authorizeDocumentAccess} from "~/server/documents/data/documents_actions.js";
import {maxLabelStringForDynamoKeyAttribute} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {SpellCheckTable} from "~/server/spell_check/internal/spell_check_table.js";
import {authorizeTaskAccess} from "~/server/tasks/data/task_table.js";
import {AccessLevel} from "~/shared/access/access_policy.js";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {parallelMapAsyncIterableToArray} from "~/shared/helpers/iterable/parallel_map_async_iterable_to_array.js";
import {minLabelString} from "~/shared/schema/helpers/label_string_schema.js";
import {
    SpellCheckEntityId,
    parseSpellCheckEntityId,
} from "~/shared/spell_check/spell_check_entity_id.js";
import {SpellCheckIgnoredLintModel} from "~/shared/spell_check/spell_check_model.js";

function authorizeSpellCheckEntityIdAccess(
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

export async function getSpellCheckIgnoredLints(
    context: ServerActionContext,
    spellCheckEntityId: SpellCheckEntityId,
): Promise<ReadonlyArray<DynamoGeneralRealtimeItem<SpellCheckIgnoredLintModel>>> {
    await authorizeSpellCheckEntityIdAccess(context, spellCheckEntityId, "Edit");

    const ignoredLints = await parallelMapAsyncIterableToArray(
        SpellCheckTable.query(context, {
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
        }),
        async item => {
            return SpellCheckTable.buildRealtimeItem(context, item);
        },
    );

    return ignoredLints.filter(isNonNullable);
}

export async function createSpellCheckIgnoredLint(
    context: ServerSessionActionContext,
    spellCheckEntityId: SpellCheckEntityId,
    key: string,
    kind: string,
): Promise<void> {
    await authorizeSpellCheckEntityIdAccess(context, spellCheckEntityId, "Edit");

    const createdTime = new Date();
    const creatorId = context.actor.getAccountId();

    await SpellCheckTable.createItem(context, {
        partitionType: "IgnoredLint",
        sortRangeType: "Attributes",
        spellCheckEntityId,
        key,
        kind,
        createdTime,
        creatorId,
    });
}
