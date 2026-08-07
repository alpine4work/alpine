import {newTaskCollectionNamePlaceholder} from "~/client/web/styles/tasks_shared_styles.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {defaultOpenGraphImageUrl, getOpenGraphTitle} from "~/shared/content/open_graph_content.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

type HeadMetaDescriptor = {[key: string]: string};

type OpenGraph = {
    readonly title: string;
    readonly description: string | null;
    readonly image: string;
};

/**
 * Adds Open Graph meta descriptors from a pre-computed `openGraph` object. If
 * `openGraph` is null, no descriptors are added.
 */
function addOpenGraphDescriptors(
    descriptors: Array<HeadMetaDescriptor>,
    openGraph: OpenGraph | null,
) {
    if (!openGraph) return;

    descriptors.push({property: "og:title", content: openGraph.title});
    descriptors.push({property: "og:image", content: openGraph.image});
    if (openGraph.description) {
        descriptors.push({property: "og:description", content: openGraph.description});
        descriptors.push({name: "description", content: openGraph.description});
    }
}

/**
 * Create head meta descriptors for a document.
 *
 * If `openGraph` is provided, OG metadata is included. The `openGraph` should be
 * computed using `getOpenGraphContent()`.
 */
export function createHeadMetaForDocument(
    document: {
        title: string;
        openGraph: OpenGraph | null;
    } | null,
): Array<HeadMetaDescriptor> {
    const title = document?.title ?? documentFallbackTitle;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];
    addOpenGraphDescriptors(descriptors, document?.openGraph ?? null);
    return descriptors;
}

/**
 * Create head meta descriptors for a channel.
 *
 * If `openGraph` is provided, OG metadata is included. The `openGraph` should be
 * computed using `getOpenGraphContent()`.
 */
export function createHeadMetaForChannel(
    channel: {
        name: string;
        openGraph: OpenGraph | null;
    } | null,
): Array<HeadMetaDescriptor> {
    const title = channel?.name ?? "";
    const descriptors: Array<HeadMetaDescriptor> = [{title}];
    addOpenGraphDescriptors(descriptors, channel?.openGraph ?? null);
    return descriptors;
}

/**
 * Create head meta descriptors for a chat room.
 *
 * If the room is publicly shared (has urlGrant), generates OG metadata including
 * the room name as the title.
 */
export function createHeadMetaForRoomChat(room: {
    name: string;
    accessPolicy: AccessPolicyModel;
}): Array<HeadMetaDescriptor> {
    const title = room.name;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    let hasUrlGrant: boolean;
    switch (room.accessPolicy.data.type) {
        case "Local":
            hasUrlGrant = room.accessPolicy.data.urlGrant !== null;
            break;
        case "Site":
            // We don't bother trying to keep the `<head>` up-to-date in realtime.
            // eslint-disable-next-line cyberworlds/no-model-initial-data
            hasUrlGrant = room.accessPolicy.data.site.initialData.accessPolicy.urlGrant !== null;
            break;
        default:
            throw exhaustive(room.accessPolicy.data);
    }

    if (hasUrlGrant) {
        descriptors.push({property: "og:title", content: getOpenGraphTitle(title)});
        descriptors.push({property: "og:image", content: defaultOpenGraphImageUrl});
    }

    return descriptors;
}

/**
 * Create head meta descriptors for a task.
 *
 * If `openGraph` is provided, OG metadata is included. The `openGraph` should be
 * computed using `getOpenGraphContent()`.
 */
export function createHeadMetaForTask(task: {
    title: string;
    openGraph: OpenGraph | null;
}): Array<HeadMetaDescriptor> {
    const title = task.title;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];
    addOpenGraphDescriptors(descriptors, task.openGraph);
    return descriptors;
}

/**
 * Create head meta descriptors for a task collection.
 *
 * If the collection is publicly shared (has urlGrant), generates OG metadata
 * including title.
 */
export function createHeadMetaForTaskCollection(
    collection: {name: string; hasUrlGrant: boolean} | null,
): Array<HeadMetaDescriptor> {
    const title = collection?.name || newTaskCollectionNamePlaceholder;
    const descriptors: Array<HeadMetaDescriptor> = [{title}];

    if (collection?.hasUrlGrant) {
        descriptors.push({property: "og:title", content: getOpenGraphTitle(title)});
        descriptors.push({property: "og:image", content: defaultOpenGraphImageUrl});
    }

    return descriptors;
}
