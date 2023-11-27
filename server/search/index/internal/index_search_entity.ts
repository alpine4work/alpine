import {ServerSystemActionContext} from "~/server/context/server_action_context.js";
import {getDocument} from "~/server/documents/data/documents_table.js";
import {chunkSearchContent} from "~/server/search/index/internal/chunk_search_content.js";
import {CohereEnglishLightLanguageModel} from "~/server/search/index/internal/cohere_english_light_language_model.js";
import {LanguageModelBase} from "~/server/search/index/internal/language_model_base.js";
import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {SearchEntityIndexAccessPolicy} from "~/server/search/index/internal/search_entity_index_doc.js";
import {truncateTokens} from "~/server/search/index/internal/truncate_tokens.js";
import {getAccountIfExists} from "~/server/spaces/spaces_table.js";
import {AccountModel} from "~/shared/accounts/account_model.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {DocumentModel, getDocumentContentTitle} from "~/shared/documents/document_model.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {AccountId, ContentMentionAccountId, DocumentId} from "~/shared/id/types/id_types.js";

// NOCOMMIT: Small messages like "Nice!" shouldn't be embedded at all?

type SearchEntity = {
    readonly id: SearchEntityId;
    readonly version: number;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly title: string | null;
    readonly body: string | null;
    readonly embeddingChunks: ReadonlyArray<{
        readonly preambleEndIndex: number;
        readonly text: string;
    }>;
};

class SearchEntityIndexer {
    private readonly _context: ServerSystemActionContext;
    public readonly model: LanguageModelBase;

    private readonly _accountDependencyById = new Map<
        AccountId | ContentMentionAccountId,
        Promise<AccountModel | null>
    >();
    private readonly _documentDependencyById = new Map<DocumentId, Promise<DocumentModel>>();

    private constructor(context: ServerSystemActionContext, model: LanguageModelBase) {
        this._context = context;
        this.model = model;
    }

    public static async new(context: ServerSystemActionContext) {
        const model = await CohereEnglishLightLanguageModel.get();
        return new SearchEntityIndexer(context, model);
    }

    // Arrow function form so we can pass as a function parameter
    // (e.g. `chunkSearchContent(content, {getAccountIfExists: indexer.getAccountIfExists}))`)
    public readonly getAccountIfExists = (
        accountId: AccountId | ContentMentionAccountId,
    ): Promise<AccountModel | null> => {
        return getOrSetDefaultMapValue(this._accountDependencyById, accountId, () =>
            getAccountIfExists(this._context, this._context.actor.getSpaceId(), accountId),
        );
    };

    public getDocument(documentId: DocumentId) {
        return getOrSetDefaultMapValue(this._documentDependencyById, documentId, () =>
            getDocument(this._context, documentId),
        );
    }
}

export function indexSearchEntity() {
    // NOCOMMIT
}

async function indexDocumentSearchEntity(
    indexer: SearchEntityIndexer,
    documentId: DocumentId,
): Promise<SearchEntity> {
    const document = await indexer.getDocument(documentId);

    const {getFullText, chunks} = await chunkDocumentSearchContent(document.content.doc, indexer);

    return {
        id: `Document:${documentId}`,

        version: document.version,

        // TODO(calebmer): Documents are currently accessible to everyone in a space.
        // When we add access controls we need to update this with proper access policy
        // information.
        accessPolicy: {
            accountGrantAccountIds: [],
            defaultGrantType: "Space",
        },

        title: document.getTitle(),
        body: getFullText(),
        embeddingChunks: chunks,
    };
}

export function chunkDocumentSearchContent(
    content: DocumentContent,
    {
        model,
        getAccountIfExists,
    }: {
        model: LanguageModelBase;
        getAccountIfExists: (
            accountId: AccountId | ContentMentionAccountId,
        ) => Promise<AccountModel | null>;
    },
) {
    // For reference "The quick brown fox jumps over the lazy dog" is 9 tokens.
    // "How we’re designing our personal task management product" is 10 tokens.
    // 32 tokens (16 tokens for title, 16 tokens for section heading) is ~6% of
    // our 512 token window for Cohere's embedding models.
    //
    // 16 tokens feels like a good balance between fitting titles without taking
    // up too much space.
    const titleTokenCount = 16;

    const truncatedTitle = new Lazy(() =>
        truncateTokens(model, getDocumentContentTitle(content), titleTokenCount),
    );

    const truncatedSectionHeading = new LazyMap((sectionHeading: string) =>
        truncateTokens(model, sectionHeading, titleTokenCount),
    );

    return chunkSearchContent(content, {
        model,
        getAccountIfExists,
        getChunkPreamble: ({context, isInitialChunk}) => {
            if (isInitialChunk) return {text: "", lineMarginBottom: 0};

            return {
                text: `This is from the “${truncatedTitle.get()}” document${
                    context.sectionHeading !== null
                        ? ` in the “${truncatedSectionHeading.get(context.sectionHeading)}” section`
                        : ""
                }:`,
                lineMarginBottom: 2,
            };
        },
    });
}
