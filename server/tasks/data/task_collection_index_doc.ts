import {opensearchIndexEnglishWithWordDelimiterGraphAnalyzer} from "~/server/opensearch/helpers/opensearch_index_english_with_word_delimiter_graph_analyzer.js";
import {OpensearchClientDocWithVersion} from "~/server/opensearch/opensearch_client.js";
import {
    OpensearchIndexArrayType,
    OpensearchIndexBooleanType,
    OpensearchIndexIgnoredObjectType,
    OpensearchIndexKeywordType,
    OpensearchIndexObjectType,
    OpensearchIndexSearchAsYouTypeType,
    OpensearchIndexTypeType,
} from "~/server/opensearch/opensearch_index_type.js";
import {createCrdtRegisterOpensearchType} from "~/server/tasks/data/internal/create_crdt_register_opensearch_type.js";
import {
    HybridLogicalTimeType,
    SortableHybridLogicalTimeType,
} from "~/server/tasks/data/internal/hybrid_logical_time_type.js";
import {ThemeColor} from "~/shared/design/theme_colors.js";
import {compareHybridLogicalTimes} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {
    TaskCollectionAccessPolicyRegister,
    TaskCollectionAccessPolicySchema,
} from "~/shared/tasks/task_collection_access_policy.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";

const TaskCollectionNameType = createCrdtRegisterOpensearchType(
    LabelStringRegister,
    new OpensearchIndexSearchAsYouTypeType({
        analyzer: opensearchIndexEnglishWithWordDelimiterGraphAnalyzer,
    }),
);

const TaskCollectionColorType = createCrdtRegisterOpensearchType(
    TaskCollectionColorRegister,
    new OpensearchIndexKeywordType()
        .transform<ThemeColor>({
            serialize: themeColor => themeColor,
            deserialize: themeColor => themeColor as ThemeColor,
        })
        .nullable(),
);

const TaskCollectionAccessPolicyType = createCrdtRegisterOpensearchType(
    TaskCollectionAccessPolicyRegister,
    new OpensearchIndexIgnoredObjectType(TaskCollectionAccessPolicySchema),
);

/**
 * The type of a document in our task collections index. Can be used to execute
 * arbitrary queries against tasks efficiently.
 */
export type TaskCollectionIndexDoc = MergeObjectIntersection<
    {
        readonly id: TaskCollectionId;
    } & OpensearchIndexTypeType<typeof TaskCollectionIndexDocType>
>;

export type TaskCollectionIndexDocWithVersion =
    OpensearchClientDocWithVersion<TaskCollectionIndexDoc>;

export const TaskCollectionIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),
        createdTime: SortableHybridLogicalTimeType,

        // The `isDeleted` computed property definitively tells us whether a task is
        // deleted or not.
        rawDeletedTime: HybridLogicalTimeType.nullable(),
        rawUndeletedTime: HybridLogicalTimeType.nullable(),

        name: TaskCollectionNameType,
        color: TaskCollectionColorType,
        accessPolicy: TaskCollectionAccessPolicyType,
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),

            // Allow filtering on the elements of a collection access policy.
            accessPolicyAccountGrantIds: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
            ),
            accessPolicyDefaultGrantType: new OpensearchIndexKeywordType({isFilterable: true})
                .validate((type): type is "Space" => type === "Space")
                .nullable(),
        },
        compute: collection => ({
            isDeleted:
                !!collection.rawDeletedTime &&
                (!collection.rawUndeletedTime ||
                    compareHybridLogicalTimes(
                        collection.rawDeletedTime,
                        collection.rawUndeletedTime,
                    ) > 0),

            accessPolicyAccountGrantIds: Array.from(
                collection.accessPolicy.value.accountGrantById.keys(),
            ),
            accessPolicyDefaultGrantType: collection.accessPolicy.value.defaultGrant?.type ?? null,
        }),
    },
});
