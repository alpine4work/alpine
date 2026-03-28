import {getAccountTimeZoneIfExists} from "~/server/accounts/with_spaces/get_account_time_zone_if_exists.js";
import {createDocument} from "~/server/documents/data/documents_actions.js";
import {addFeedAccountCandidateEntry, addFeedCandidateEntry} from "~/server/feed/feed_actions.js";
import {ImporterServiceSystemActionContext} from "~/server/importer/importer_service_context.js";
import {parseNotionImportFileName} from "~/server/importer/notion/internal/parse_notion_import_file_name.js";
import {impersonateAccountAsSystemContext} from "~/server/spaces/impersonate_account_as_system_context.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {fromApiContent} from "~/shared/api/content/from_api_content.js";
import {
    ApiContent,
    ApiContentBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    DocumentContentProsemirrorSchema,
    assertDocumentContent,
} from "~/shared/documents/document_content_schema.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {AccountId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

export interface CreateNotionImportTeamspaceRootDocumentOptions {
    spaceId: SpaceId;
    creatorId: AccountId;
    workspaceName: string;
    teamspaceName: string;
    isPublic: boolean;
    // This is the document ID of the teamspace itself This will be replaced by sites.
    // TODO(#sites-notion-import)
    teamspaceRootDocumentId: DocumentId;
    teamspaceDocuments: {
        [filePath: string]: {
            id: DocumentId;
            parent: {documentId: DocumentId; relativeFilePath: string} | null;
            children: Set<DocumentId>;
        };
    };
    /** Documents created for root-level CSV databases. */
    csvDatabaseDocumentIds: Map<string, DocumentId>;
}

/**
 * Create a teamspace root document that contains:
 *
 * - A note about the import with mention of the account who started it
 * - Links to all first-layer documents in the teamspace
 *
 * @see README.md "Teamspace Root Documents" section for the structure and purpose
 * of these synthetic documents.
 */
export async function createNotionImportTeamspaceRootDocument(
    context: ImporterServiceSystemActionContext,
    options: CreateNotionImportTeamspaceRootDocumentOptions,
): Promise<void> {
    const {
        spaceId,
        creatorId,
        workspaceName,
        teamspaceName,
        isPublic,
        teamspaceRootDocumentId,
        teamspaceDocuments,
        csvDatabaseDocumentIds,
    } = options;

    // Find first-layer documents (those whose parent is the teamspace root)
    const firstLayerDocuments: Array<{path: string; id: DocumentId; title: string}> = [];
    for (const [path, documentInfo] of Object.entries(teamspaceDocuments)) {
        if (documentInfo.parent?.documentId === teamspaceRootDocumentId) {
            const title =
                parseNotionImportFileName(path.split("/").pop() ?? "")?.title ?? "Untitled";
            firstLayerDocuments.push({path, id: documentInfo.id, title});
        }
    }

    // Also include CSV database documents
    for (const [csvPath, documentId] of csvDatabaseDocumentIds) {
        const title =
            parseNotionImportFileName(csvPath.split("/").pop() ?? "")?.title ?? "Untitled";
        firstLayerDocuments.push({path: csvPath, id: documentId, title});
    }

    // If no documents, skip creating the root document
    if (firstLayerDocuments.length === 0) return;

    // Sort alphabetically by title
    firstLayerDocuments.sort((a, b) => a.title.localeCompare(b.title));

    // Get the user's time zone for date formatting
    const userTimeZone = (await getAccountTimeZoneIfExists(context, creatorId)) ?? defaultTimeZone;

    // Build API content directly
    const elements: Array<ApiContentBlockElement> = [];

    // Add import note with account mention (italic text + mention + date)
    const today = new Date();
    const dateStr = today.toLocaleDateString("en-US", {
        timeZone: userTimeZone,
        month: "long",
        day: "numeric",
        year: "numeric",
    });
    elements.push({
        type: "Paragraph",
        elements: [
            {
                type: "Text",
                text: `This teamspace was imported from the ${workspaceName} workspace in Notion by `,
                marks: [{type: "Italic"}],
            },
            {
                type: "Mention",
                reference: {type: "Account", id: creatorId},
                marks: [{type: "Italic"}],
            },
            {type: "Text", text: ` on ${dateStr}.`, marks: [{type: "Italic"}]},
        ],
    });

    // Add heading for documents section
    elements.push({
        type: "Heading",
        level: 2,
        elements: [{type: "Text", text: "Documents"}],
    });

    // Add list of first-layer documents as mentions
    elements.push({
        type: "UnorderedList",
        items: firstLayerDocuments.map(document => ({
            elements: [
                {
                    type: "Paragraph" as const,
                    elements: [
                        {
                            type: "Mention" as const,
                            reference: {type: "Document" as const, id: document.id},
                        },
                    ],
                },
            ],
        })),
    });

    const apiContent: ApiContent = {elements};

    // Convert API content to ProseMirror document
    const bodyContent = fromApiContent(DocumentContentProsemirrorSchema, apiContent);

    // Create access policy
    const accessPolicy: AccessPolicy = {
        // TODO(ifitzsimmons, #notion-import-site-integration): This might be a site access
        // policy depending on the import options.
        type: "Local",
        accountGrantById: new Map([[creatorId, {level: "Manage", generation: 0}]]),
        defaultGrant: isPublic ? {level: "Edit"} : null,
        urlGrant: null,
    };

    // Build the document content with title. If there's no teamspace name or it
    // matches the workspace name (implicit teamspace), just use the workspace name to
    // avoid duplication like "Export | Export".
    const titleText =
        teamspaceName && teamspaceName !== workspaceName
            ? `${workspaceName} | ${teamspaceName}`
            : workspaceName;
    const titleNode = DocumentContentProsemirrorSchema.node("title", {}, [
        DocumentContentProsemirrorSchema.text(titleText),
    ]);

    const bodyNodes = bodyContent.content.content;

    const documentContent = assertDocumentContent(
        DocumentContentProsemirrorSchema.node("doc", {accessPolicy}, [titleNode, ...bodyNodes]),
    );

    // Create the document using the pre-generated ID
    const {createdTime} = await impersonateAccountAsSystemContext(context, creatorId, context =>
        createDocument(context, {
            id: teamspaceRootDocumentId,
            spaceId,
            creatorId,
            content: documentContent,
            createFeedEntry: false,
            from: {type: "Importer", source: {type: "Notion"}},
        }),
    );

    // Send feed entry for teamspace document (feed filters by access)
    if (isPublic) {
        await addFeedCandidateEntry(context, spaceId, {
            type: "Document",
            documentId: teamspaceRootDocumentId,
            sharedTime: createdTime,
            sharerId: creatorId,
            creator: {
                id: creatorId,
                from: {type: "Importer", source: {type: "Notion"}},
            },
            event: "Created",
        });
    } else {
        await addFeedAccountCandidateEntry(context, spaceId, creatorId, {
            type: "Document",
            documentId: teamspaceRootDocumentId,
            sharedTime: createdTime,
            sharerId: creatorId,
            creator: {
                id: creatorId,
                from: {type: "Importer", source: {type: "Notion"}},
            },
            event: "Created",
        });
    }
}
