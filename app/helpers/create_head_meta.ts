import {Node} from "prosemirror-model";
import {newTaskCollectionNamePlaceholder} from "~/client/web/styles/tasks_shared_styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {getContentSnippet} from "~/shared/content/get_content_snippet.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {DocumentContentWithReferences} from "~/shared/documents/document_content_references.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {DocumentModel} from "~/shared/documents/document_model.js";
import {ChannelModel} from "~/shared/forum/channel_model.js";

type HeadMetaDescriptor = {[key: string]: string};

const ogImageUrl = "https://alpine.inc/images/og.jpg";

/**
 * Maximum length for the OG description in characters.
 */
const maxDescriptionLength = 300;

/**
 * Get an OG description from content by extracting a snippet and printing it as
 * single-line text. Returns null if the content has no text.
 */
function getContentOgDescription(doc: Node, references: ContentReferences): string | null {
    const snippet = getContentSnippet(
        doc.resolve(0),
        {linesAbove: 0, linesBelow: 3},
        {ignoreLineBreaks: true},
    );

    const text = printContentSingleLineTextSnippet(snippet, {
        getAccountIfExists: accountId => references.accountById.get(accountId)?.initialData ?? null,
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            const entityData = entity.entity.initialData;
            const entityDataMedia = entityData.media;

            return {
                isPrivate: false,
                title: entityData.title,
                getAccountMediaShortName:
                    entityDataMedia?.type === "Account"
                        ? () =>
                              getAccountShortNameWithoutFullNameTooltip(
                                  entityDataMedia.account.initialData,
                              )
                        : null,
            };
        },
        getFileIfExists: fileId => references.fileById?.get(fileId)?.file.initialData ?? null,
    });

    if (text.length === 0) return null;

    if (text.length > maxDescriptionLength) {
        return text.slice(0, maxDescriptionLength) + "\u2026";
    }

    // If the snippet was truncated from the full content, add ellipsis.
    if (snippet.nodeSize < doc.nodeSize) {
        return text + "\u2026";
    }

    return text;
}

/**
 * Get a description for a document suitable for OG (Open Graph) metadata. Extracts
 * the first few lines of body content (skipping the title) and prints it as a
 * single-line text snippet. Returns null if there's no text content after the
 * title.
 */
export function getDocumentOgDescription(content: DocumentContentWithReferences): string | null {
    const doc = content.doc;

    // If there's no content after the title, return null.
    if (doc.childCount <= 1) {
        return null;
    }

    // Cut body content, skipping the title (first child).
    const bodyContent = doc.cut(doc.child(0).nodeSize);

    return getContentOgDescription(bodyContent, content.references);
}

/**
 * Create head meta descriptors for a document.
 *
 * If the document is publicly shared (has urlGrant), generates OG metadata
 * including title and description extracted from the document content.
 */
export function createHeadMetaForDocument(
    document: DocumentModel | null,
): Array<HeadMetaDescriptor> {
    const title = document?.getTitle() ?? documentFallbackTitle;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    // If the document is publicly shared (has urlGrant), generate OG metadata. The
    // access policy is stored as a ProseMirror attribute on the root doc node of the
    // document content.
    if (document?.content.doc.attrs.accessPolicy.urlGrant) {
        descriptors.push({property: "og:title", content: `${title} | Alpine`});
        descriptors.push({property: "og:image", content: ogImageUrl});

        const description = getDocumentOgDescription(document.content);
        if (description) {
            descriptors.push({property: "og:description", content: description});
            descriptors.push({name: "description", content: description});
        }
    }

    return descriptors;
}

/**
 * Create head meta descriptors for a channel.
 *
 * If the channel is publicly shared (has urlGrant), generates OG metadata
 * including title and description extracted from the channel description.
 */
export function createHeadMetaForChannel(channel: ChannelModel | null): Array<HeadMetaDescriptor> {
    const title = channel?.name ?? "";
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    if (channel?.accessPolicy.urlGrant) {
        descriptors.push({property: "og:title", content: `${title} | Alpine`});
        descriptors.push({property: "og:image", content: ogImageUrl});

        const description = getContentOgDescription(
            channel.description.doc,
            channel.description.references,
        );
        if (description) {
            descriptors.push({property: "og:description", content: description});
            descriptors.push({name: "description", content: description});
        }
    }

    return descriptors;
}

/**
 * Create head meta descriptors for a chat room.
 *
 * If the room is publicly shared (has urlGrant), generates OG metadata including
 * the room name as the title.
 */
export function createHeadMetaForChatRoom(
    room: {name: string; accessPolicy: AccessPolicy} | null,
): Array<HeadMetaDescriptor> {
    const title = room?.name ?? "";
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    if (room?.accessPolicy.urlGrant) {
        descriptors.push({property: "og:title", content: `${title} | Alpine`});
        descriptors.push({property: "og:image", content: ogImageUrl});
    }

    return descriptors;
}

/**
 * Create head meta descriptors for a task.
 *
 * If the task is publicly shared (has urlGrant), generates OG metadata including
 * title and description extracted from task notes.
 */
export function createHeadMetaForTask(task: {
    title: string;
    hasUrlGrant: boolean;
    notesDoc: Node;
    notesReferences: ContentReferences;
}): Array<HeadMetaDescriptor> {
    const title = task.title;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    if (task.hasUrlGrant) {
        descriptors.push({property: "og:title", content: `${title} | Alpine`});
        descriptors.push({property: "og:image", content: ogImageUrl});

        const description = getContentOgDescription(task.notesDoc, task.notesReferences);
        if (description) {
            descriptors.push({property: "og:description", content: description});
            descriptors.push({name: "description", content: description});
        }
    }

    return descriptors;
}

/**
 * Create head meta descriptors for a task collection.
 *
 * If the collection is publicly shared (has urlGrant), generates OG metadata
 * including title and a description.
 */
export function createHeadMetaForTaskCollection(
    collection: {name: string; accessPolicy: AccessPolicy} | null,
): Array<HeadMetaDescriptor> {
    const title = collection?.name || newTaskCollectionNamePlaceholder;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    // If the collection is publicly shared (has urlGrant), generate OG metadata.
    if (collection?.accessPolicy.urlGrant) {
        descriptors.push({property: "og:title", content: `${title} | Alpine`});
        descriptors.push({property: "og:image", content: ogImageUrl});
    }

    return descriptors;
}
