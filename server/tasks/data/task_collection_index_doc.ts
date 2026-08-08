import {
    OpensearchIndexAnalysisCustomAnalyzer,
    OpensearchIndexAnalysisCustomFilter,
} from "~/server/opensearch/opensearch_index_analysis.js";
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
import {AccessPolicyRegister, AccessPolicySchema} from "~/shared/access/access_policy.js";
import {ThemeColor} from "~/shared/design/core/theme_colors.js";
import {
    compareHybridLogicalTimes,
    zeroHybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.open_source.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.open_source.js";
import {isId} from "~/shared/id/id.open_source.js";
import {AccountId, SpaceId, TaskCollectionId} from "~/shared/id/types/id_types.open_source.js";
import {LabelStringRegister} from "~/shared/tasks/label_string_register.js";
import {TaskCollectionColorRegister} from "~/shared/tasks/task_collection_color.js";
import {TaskActorFromSchema} from "~/shared/tasks/task_creator.js";
import {
    TaskQueryDefaultsRegister,
    TaskQueryDefaultsSchema,
    emptyTaskQueryDefaults,
} from "~/shared/tasks/task_query_defaults.js";

// IMPORTANT: There are a couple small backwards incompatible changes we'd like to
// make to our search index. (e.g. Remove `accessPolicyAccountGrantIds` from the
// collection index as we don't use it anymore.) They haven't been worth setting up
// infrasturcture for backwards incompatible changes yet. If you're going to make a
// backwards incompatible change please consider incorporating all `NOTE` and
// `TODO` comments we've left in this file.

const TaskCollectionNameType = createCrdtRegisterOpensearchType(
    LabelStringRegister,
    // TODO(calebmer): Switch this to an un-indexed `keyword` type. This will improve
    // indexing performance. We set collection names up like this before we implemented
    // the general purpose search entity index. Which we now use to serve requests so
    // the extra indexing work we do here is completely unused.
    new OpensearchIndexSearchAsYouTypeType({
        // NOTE(calebmer): This analyzer is the same as
        // `opensearchIndexEnglishWithWordDelimiterGraphAnalyzer` except stop words aren't
        // removed. This analyzer was written before we [learned about
        // `cutoff_frequency`][1] which is a better approach at handling common terms.
        //
        // [1]:
        //     https://www.elastic.co/blog/stop-stopping-stop-words-a-look-at-common-terms-query
        analyzer: new OpensearchIndexAnalysisCustomAnalyzer("english_with_word_delimiter_graph", {
            tokenizer: "standard",
            filter: [
                new OpensearchIndexAnalysisCustomFilter("english_possessive_stemmer", {
                    type: "stemmer",
                    language: "possessive_english",
                }),
                "lowercase",
                new OpensearchIndexAnalysisCustomFilter("english_stop", {
                    type: "stop",
                    stopwords: "_english_",
                }),
                new OpensearchIndexAnalysisCustomFilter("english_stemmer", {
                    type: "stemmer",
                    language: "english",
                }),
                new OpensearchIndexAnalysisCustomFilter("english_word_delimiter_graph", {
                    type: "word_delimiter_graph",
                    // English possessives are already stemmed.
                    stem_english_possessive: false,
                }),
            ],
        }),
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

/**
 * The type of a document in our task collections index. Can be used to execute
 * arbitrary queries against tasks efficiently.
 *
 * This type is customized for use in `TaskRealtimeService` for representing
 * collections in-memory. So OpenSearch bookkeeping fields have been removed. For
 * the actual type we get from OpenSearch see `TaskCollectionIndexActualDoc`.
 */
export type TaskCollectionIndexDoc = MergeObjectIntersection<
    {
        readonly id: TaskCollectionId;
    } & OpensearchIndexTypeType<typeof TaskCollectionIndexDocType> & {
            // This type is used throughout `TaskRealtimeService` to represent a collection. It
            // should not include bookkeeping properties from OpenSearch that won't be updated
            // in-memory.
            readonly version?: undefined;
        }
>;

export type TaskCollectionIndexActualDoc = OpensearchIndexTypeType<
    typeof TaskCollectionIndexDocType
>;

export type TaskCollectionIndexDocBase = TaskCollectionIndexActualDoc;

assertAssignableTypes<TaskCollectionIndexDoc, TaskCollectionIndexDocBase>();
assertAssignableTypes<TaskCollectionIndexActualDoc, TaskCollectionIndexDocBase>();

export const TaskCollectionIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        spaceId: new OpensearchIndexKeywordType({
            isFilterable: true,
            isSortable: true,
        }).validate<SpaceId>(isId),
        createdTime: SortableHybridLogicalTimeType,
        creatorId: new OpensearchIndexKeywordType()
            .validate<AccountId>(isId)
            .nullable()
            .default(null),
        creatorFrom: new OpensearchIndexIgnoredObjectType(TaskActorFromSchema)
            .nullable()
            .default(null),

        // The `isDeleted` computed property definitively tells us whether a task is
        // deleted or not.
        rawDeletedTime: HybridLogicalTimeType.nullable(),
        rawUndeletedTime: HybridLogicalTimeType.nullable(),

        name: TaskCollectionNameType,
        color: TaskCollectionColorType,

        accessPolicy: createCrdtRegisterOpensearchType(
            AccessPolicyRegister,
            new OpensearchIndexIgnoredObjectType(AccessPolicySchema),
        ),

        // Collections indexed before defaults existed don't have this property so we
        // default to an empty register which loses to any update.
        defaults: createCrdtRegisterOpensearchType(
            TaskQueryDefaultsRegister,
            new OpensearchIndexIgnoredObjectType(TaskQueryDefaultsSchema),
        ).default(new TaskQueryDefaultsRegister(emptyTaskQueryDefaults, zeroHybridLogicalTime)),
    },
    computed: {
        fields: {
            isDeleted: new OpensearchIndexBooleanType({isFilterable: true, isSortable: true}),

            // Allow filtering on the elements of a collection access policy.
            accessPolicyAccountGrantIds: new OpensearchIndexArrayType(
                new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
            ),

            // NOTE(calebmer, 2025-01-14): When I first designed the `AccessPolicy` type I
            // thought public sharing via URL would be expressed as a union on the grant type.
            // So the type of `defaultGrant` would be
            // `{type: "Space"; level: AccessLevel} | {type: "Internet"; level: AccessLevel}`
            // or something like this. The problem with this design is we want to be able to
            // express an `AccessPolicy` where the public internet has `View` access and
            // internal space accounts have `Edit` access. Using a union makes it more
            // challenging to express this. So we scrapped the union and now `defaultGrant`
            // only refers to space access.
            //
            // However, since we've written this `accessPolicyDefaultGrantType` type to
            // OpenSearch, we can't change this to the ideal field (which would be a boolean
            // named something like `hasDefaultGrantInAccessPolicy`) without a migration. So
            // for now we're leaving the idea of a default grant type in OpenSearch and
            // basically treating it as a boolean.
            //
            // One more thing: If someone is running a migration in the future to change this
            // they should consider reusing `SearchEntityIndexAccessPolicyType` here.
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

            // NOTE(ifitzsimons, 2026-03-05): Task collection search used to be implemented in
            // the task collection index since search wasn't built at the time. That's also why
            // `TaskCollectionNameType` is using the `OpensearchIndexSearchAsYouTypeType` type.
            // This was switched over here:
            //
            // https://github.com/cyberworlds/cyberworlds/commit/1e7a5160da869dc4d2c0156e1ec484b67fd13776
            //
            // TODO: We should delete these deprecated fields from the index entirely someday.
            accessPolicyAccountGrantIds: [],
            accessPolicyDefaultGrantType: null,
        }),
    },
});
