import {
    createHeadMetaForChannel,
    createHeadMetaForDocument,
    createHeadMetaForRoomChat,
    createHeadMetaForTask,
    createHeadMetaForTaskCollection,
} from "~/app/helpers/create_head_meta.js";
import {newTaskCollectionNamePlaceholder} from "~/client/web/styles/tasks_shared_styles.js";
import {AccessPolicyModel} from "~/shared/access/model/access_policy_model.js";
import {defaultOpenGraphImageUrl} from "~/shared/content/open_graph_content.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";

function createTestAccessPolicy(options: {urlGrant?: boolean}): AccessPolicyModel {
    return new AccessPolicyModel({
        type: "Local",
        accountGrantById: new Map(),
        defaultGrant: null,
        urlGrant: options.urlGrant ? {level: "View"} : null,
    });
}

const ogImageUrl = defaultOpenGraphImageUrl;

describe("createHeadMetaForDocument", () => {
    test("returns title only when no openGraph", () => {
        const result = createHeadMetaForDocument({
            title: "My Document",
            openGraph: null,
        });

        expect(result).toEqual([{title: "My Document"}]);
    });

    test("returns fallback title when document is null", () => {
        const result = createHeadMetaForDocument(null);

        expect(result).toEqual([{title: documentFallbackTitle}]);
    });

    test("returns OG metadata when openGraph is provided", () => {
        const result = createHeadMetaForDocument({
            title: "Public Document",
            openGraph: {
                title: "Public Document | Alpine",
                description: "This is the body content.",
                image: ogImageUrl,
            },
        });

        expect(result).toMatchObject([
            {title: "Public Document"},
            {property: "og:title", content: "Public Document | Alpine"},
            {property: "og:image", content: ogImageUrl},
            {property: "og:description", content: "This is the body content."},
            {name: "description", content: "This is the body content."},
        ]);
    });

    test("returns no description when openGraph has null description", () => {
        const result = createHeadMetaForDocument({
            title: "Empty Document",
            openGraph: {
                title: "Empty Document | Alpine",
                description: null,
                image: ogImageUrl,
            },
        });

        expect(result).toEqual([
            {title: "Empty Document"},
            {property: "og:title", content: "Empty Document | Alpine"},
            {property: "og:image", content: ogImageUrl},
        ]);
    });
});

describe("createHeadMetaForChannel", () => {
    test("returns title only when no openGraph", () => {
        const result = createHeadMetaForChannel({
            name: "My Channel",
            openGraph: null,
        });

        expect(result).toEqual([{title: "My Channel"}]);
    });

    test("returns empty title when channel is null", () => {
        const result = createHeadMetaForChannel(null);

        expect(result).toEqual([{title: ""}]);
    });

    test("returns OG metadata when openGraph is provided", () => {
        const result = createHeadMetaForChannel({
            name: "Public Channel",
            openGraph: {
                title: "Public Channel | Alpine",
                description: "This is a public channel about engineering.",
                image: ogImageUrl,
            },
        });

        expect(result).toMatchObject([
            {title: "Public Channel"},
            {property: "og:title", content: "Public Channel | Alpine"},
            {property: "og:image", content: ogImageUrl},
            {property: "og:description", content: "This is a public channel about engineering."},
            {name: "description", content: "This is a public channel about engineering."},
        ]);
    });

    test("returns no description when openGraph has null description", () => {
        const result = createHeadMetaForChannel({
            name: "Empty Channel",
            openGraph: {
                title: "Empty Channel | Alpine",
                description: null,
                image: ogImageUrl,
            },
        });

        expect(result).toEqual([
            {title: "Empty Channel"},
            {property: "og:title", content: "Empty Channel | Alpine"},
            {property: "og:image", content: ogImageUrl},
        ]);
    });
});

describe("createHeadMetaForRoomChat", () => {
    test("returns title only when room is not publicly shared", () => {
        const result = createHeadMetaForRoomChat({
            name: "My Room",
            accessPolicy: createTestAccessPolicy({urlGrant: false}),
        });

        expect(result).toEqual([{title: "My Room"}]);
    });

    test("returns OG metadata when room is publicly shared", () => {
        const result = createHeadMetaForRoomChat({
            name: "Public Room",
            accessPolicy: createTestAccessPolicy({urlGrant: true}),
        });

        expect(result).toEqual([
            {title: "Public Room"},
            {property: "og:title", content: "Public Room | Alpine"},
            {property: "og:image", content: ogImageUrl},
        ]);
    });
});

describe("createHeadMetaForTask", () => {
    test("returns title only when no openGraph", () => {
        const result = createHeadMetaForTask({
            title: "My Task",
            openGraph: null,
        });

        expect(result).toEqual([{title: "My Task"}]);
    });

    test("returns OG metadata when openGraph is provided", () => {
        const result = createHeadMetaForTask({
            title: "Public Task",
            openGraph: {
                title: "Public Task | Alpine",
                description: "These are the task notes.",
                image: ogImageUrl,
            },
        });

        expect(result).toMatchObject([
            {title: "Public Task"},
            {property: "og:title", content: "Public Task | Alpine"},
            {property: "og:image", content: ogImageUrl},
            {property: "og:description", content: "These are the task notes."},
            {name: "description", content: "These are the task notes."},
        ]);
    });

    test("returns no description when openGraph has null description", () => {
        const result = createHeadMetaForTask({
            title: "Public Task",
            openGraph: {
                title: "Public Task | Alpine",
                description: null,
                image: ogImageUrl,
            },
        });

        expect(result).toEqual([
            {title: "Public Task"},
            {property: "og:title", content: "Public Task | Alpine"},
            {property: "og:image", content: ogImageUrl},
        ]);
    });
});

describe("createHeadMetaForTaskCollection", () => {
    test("returns title only when collection is not publicly shared", () => {
        const collection = {name: "My Tasks", hasUrlGrant: false};

        const result = createHeadMetaForTaskCollection(collection);

        expect(result).toEqual([{title: "My Tasks"}]);
    });

    test("returns fallback title when collection is null", () => {
        const result = createHeadMetaForTaskCollection(null);

        expect(result).toEqual([{title: newTaskCollectionNamePlaceholder}]);
    });

    test("returns OG metadata when collection is publicly shared", () => {
        const collection = {name: "Public Tasks", hasUrlGrant: true};

        const result = createHeadMetaForTaskCollection(collection);

        expect(result).toEqual([
            {title: "Public Tasks"},
            {property: "og:title", content: "Public Tasks | Alpine"},
            {property: "og:image", content: ogImageUrl},
        ]);
    });
});
