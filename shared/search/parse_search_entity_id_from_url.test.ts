import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    PostId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {parseSearchEntityIdFromUrl} from "~/shared/search/parse_search_entity_id_from_url.js";

const accountId = "a93hre935d0yd7akahtrwcvv30" as AccountId;
const channelId = "c93hre935d0yd7akahtrwcvv30" as ChannelId;
const chatId = "ch3hre935d0yd7akahtrwcvv30" as ChatId;
const documentId = "d93hre935d0yd7akahtrwcvv30" as DocumentId;
const postId = "p93hre935d0yd7akahtrwcvv30" as PostId;
const siteId = "s93hre935d0yd7akahtrwcvv30" as SiteId;
const spaceId = "c2pwxmpv3z7b3db19tsn6y1qfg" as SpaceId;
const taskCollectionId = "tc3hre935d0yd7akahtrwcvv30" as TaskCollectionId;
const taskId = "t93hre935d0yd7akahtrwcvv30" as TaskId;

beforeEach(() => {
    history.replaceState(null, "", "/home");
});

test.each([
    {
        path: `/mention/${accountId}`,
        entityId: `Account:${accountId}`,
    },
    {
        path: `/account/${accountId}/${spaceId}`,
        entityId: `Account:${accountId}`,
    },
    {
        path: `/chat/with/${accountId}/${spaceId}`,
        entityId: `Account:${accountId}`,
    },
    {
        path: `/doc/${documentId}`,
        entityId: `Document:${documentId}`,
    },
    {
        path: `/channel/${channelId}`,
        entityId: `Channel:${channelId}`,
    },
    {
        path: `/chat/${chatId}`,
        entityId: `Chat:${chatId}`,
    },
    {
        path: `/post/${postId}`,
        entityId: `Post:${postId}`,
    },
    {
        path: `/task/${taskId}`,
        entityId: `Task:${taskId}`,
    },
    {
        path: `/task-collection/${taskCollectionId}`,
        entityId: `TaskCollection:${taskCollectionId}`,
    },
    {
        path: `/site/${siteId}`,
        entityId: `Site:${siteId}`,
    },
])("parses search entity URLs from $path", ({path, entityId}) => {
    expect(parseSearchEntityIdFromUrl(sameHostUrl(path))).toEqual(entityId);
});

test("parses search entity URLs with trailing slash", () => {
    expect(parseSearchEntityIdFromUrl(sameHostUrl(`/doc/${documentId}/`))).toEqual(
        `Document:${documentId}`,
    );
});

test("parses legacy space URLs", () => {
    expect(
        parseSearchEntityIdFromUrl(sameHostUrl(`/s/${spaceId}/documents/${documentId}`)),
    ).toEqual(`Document:${documentId}`);
});

test("returns null for URLs from other hosts", () => {
    expect(parseSearchEntityIdFromUrl(`https://example.com/doc/${documentId}`)).toEqual(null);
});

test("returns null for invalid IDs", () => {
    expect(parseSearchEntityIdFromUrl(sameHostUrl("/doc/not-a-valid-id"))).toEqual(null);
});

test("returns null for extra path segments", () => {
    expect(parseSearchEntityIdFromUrl(sameHostUrl(`/doc/${documentId}/duplicate`))).toEqual(null);
});

function sameHostUrl(pathname: string): string {
    return new URL(pathname, window.location.href).toString();
}
