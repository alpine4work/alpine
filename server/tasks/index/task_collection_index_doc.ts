import {
    OpensearchIndexBooleanType,
    OpensearchIndexDateType,
    OpensearchIndexIgnoredObjectType,
    OpensearchIndexKeywordType,
    OpensearchIndexObjectType,
    OpensearchIndexSearchAsYouTypeType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {createCrdtRegisterOpensearchType} from "~/server/tasks/index/internal/create_crdt_register_opensearch_type.js";
import {HybridLogicalTimeType} from "~/server/tasks/index/internal/hybrid_logical_time_type.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {iterableFirst} from "~/shared/helpers/iterable/iterable_first.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {
    TaskCollectionAccessPolicyRegister,
    TaskCollectionAccessPolicySchema,
} from "~/shared/tasks/task_collection_access_policy.js";

const TaskCollectionNameType = createCrdtRegisterOpensearchType(
    LabelStringRegister,
    // NOCOMMIT: Test different searches. Including fuzzy searches.
    new OpensearchIndexSearchAsYouTypeType({
        // When localizing our product we should also index with other
        // language analyzers.
        analyzer: "english",
    }),
);

const TaskCollectionAccessPolicyType = createCrdtRegisterOpensearchType(
    TaskCollectionAccessPolicyRegister,
    new OpensearchIndexIgnoredObjectType(TaskCollectionAccessPolicySchema),
);

/**
 * The type of a document in our task collections index. Can be used to execute
 * arbitrary queries against tasks efficiently.
 */
export type TaskCollectionIndexDoc = OpensearchIndexTypeType<typeof TaskCollectionIndexDocType> & {
    readonly version?: {
        readonly sequenceNumber: number;
        readonly primaryTerm: number;
    };
};

export const TaskCollectionIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),
        createdTime: new OpensearchIndexDateType({isSortable: true}),

        // The `isDeleted` computed property definitively tells us whether a task is
        // deleted or not.
        rawDeletedTime: HybridLogicalTimeType.nullable(),
        rawUndeletedTime: HybridLogicalTimeType.nullable(),

        name: TaskCollectionNameType,
        accessPolicy: TaskCollectionAccessPolicyType,
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),

            // If this is a private, personal collection for a single account then we put
            // that `AccountId` here. This field is included in the index sort so we can
            // efficiently filter out personal collections.
            personalAccessPolicyAccountId: new OpensearchIndexKeywordType({
                isFilterable: true,
                isSortable: true,
            })
                .validate<AccountId>(isId)
                .nullable(),
        },
        compute: taskCollection => ({
            isDeleted:
                !!taskCollection.rawDeletedTime &&
                (!taskCollection.rawUndeletedTime ||
                    compareHybridLogicalTimes(
                        taskCollection.rawDeletedTime,
                        taskCollection.rawUndeletedTime,
                    ) > 0),

            personalAccessPolicyAccountId:
                taskCollection.accessPolicy.value.defaultGrant === null &&
                taskCollection.accessPolicy.value.accountGrantById.size === 1
                    ? iterableFirst(taskCollection.accessPolicy.value.accountGrantById.keys())!
                    : null,
        }),
    },
});
