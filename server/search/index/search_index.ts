import {
    OpensearchIndexArrayType,
    OpensearchIndexByteType,
    OpensearchIndexKeywordType,
    OpensearchIndexLongType,
    OpensearchIndexObjectType,
    OpensearchIndexTypeBase,
} from "~/server/opensearch/opensearch_index_type.js";
import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {
    IntegerMappingStringType,
    createEnumIntegerMapping,
} from "~/shared/helpers/string/create_enum_integer_mapping.js";
import {isId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

type SearchIndexDefaultGrantType = IntegerMappingStringType<
    typeof SearchIndexDefaultGrantTypeIntegerMapping
>;

const SearchIndexDefaultGrantTypeIntegerMapping = createEnumIntegerMapping({
    Space: 1,
});

const SearchIndexDocType = OpensearchIndexObjectType.new({
    fields: {
        // NOCOMMIT:
        // - Title
        // - Sub-headings
        // - Body
        // - Vector (chunks)
        // - Type
        //
        // `_source` excludes (exclude most things I think)

        accessPolicy: OpensearchIndexObjectType.new({
            fields: {
                accountGrantAccountIds: new OpensearchIndexArrayType(
                    new OpensearchIndexKeywordType({isFilterable: true}).validate<AccountId>(isId),
                ),
                defaultGrantType: new OpensearchIndexByteType({isFilterable: true})
                    .transform<SearchIndexDefaultGrantType>({
                        serialize: type => SearchIndexDefaultGrantTypeIntegerMapping.into(type),
                        deserialize: type =>
                            SearchIndexDefaultGrantTypeIntegerMapping.from(
                                SearchIndexDefaultGrantTypeIntegerMapping.assert(type),
                            ),
                    })
                    .nullable(),
            },
        }),

        dependencies: new OpensearchIndexArrayType(
            OpensearchIndexObjectType.new({
                fields: {
                    entityId: new OpensearchIndexKeywordType({
                        isFilterable: true,
                    }) as OpensearchIndexTypeBase<SearchEntityId, "this">,
                    version: new OpensearchIndexLongType(),
                },
            }),
        ),
    },
});
