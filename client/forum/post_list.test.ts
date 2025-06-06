import {
    PostBasicList,
    PostListInterface,
    PostListItem,
    PostListWithHeader,
} from "~/client/forum/post_list.js";
import {MessageList} from "~/client/messaging/message_list.js";
import {emptyContentReferences} from "~/shared/content/content_references.js";
import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {ChannelModel, ChannelPreviewModel} from "~/shared/forum/channel_model.js";
import {createSimplePostContent} from "~/shared/forum/post_content_schema.js";
import {PostModel} from "~/shared/forum/post_model.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {asyncNoop} from "~/shared/helpers/control/async_noop.js";
import {noop} from "~/shared/helpers/control/noop.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {emptyMessageContent} from "~/shared/messaging/message_content_schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

const spaceId = generateId<SpaceId>();
const channelId = generateId<ChannelId>();
const createdTime = new Date();

const channel = new ChannelPreviewModel({
    id: channelId,
    spaceId,
    createdTime,
    name: "Test",
    accessPolicy: {
        accountGrantById: emptyMap,
        defaultGrant: {level: "Manage", generation: 0},
        urlGrant: null,
    },
});

const account1 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test 1",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});
const account2 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test 2",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});
const account3 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test 3",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});
const account4 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test 4",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});
const account5 = new AccountModel({
    id: generateId(),
    version: 0,
    name: "Test 5",
    nameVersion: 0,
    space: {
        version: 0,
        joinedTime: createdTime,
        wasRemoved: false,
    },
});

const testContent1 = createSimplePostContent("test1");
const testContent2 = createSimplePostContent("test2");
const testContent3 = createSimplePostContent("test3");
const testContent4 = createSimplePostContent("test4");
const testContent5 = createSimplePostContent("test5");

const testContent1WithReferences = {
    doc: testContent1,
    references: emptyContentReferences,
};
const testContent2WithReferences = {
    doc: testContent2,
    references: emptyContentReferences,
};
const testContent3WithReferences = {
    doc: testContent3,
    references: emptyContentReferences,
};
const testContent4WithReferences = {
    doc: testContent4,
    references: emptyContentReferences,
};
const testContent5WithReferences = {
    doc: testContent5,
    references: emptyContentReferences,
};

/**
 * Get all items in the list as an array. Accesses the items in random order to
 * exercise our caching logic.
 */
function getItems(list: PostListInterface) {
    const indexOrder = shuffleArray(createArrayWithLength(list.getItemCount(), index => index));

    const items: Array<PostListItem | null> = createArrayWithLength(
        list.getItemCount(),
        () => null,
    );

    for (const index of indexOrder) {
        items[index] = list.getItem(index);
    }

    return items.map((item: {[key: string]: unknown} | null, index) => {
        const {
            postOrderKey,
            postComments,
            postContentItemIndex,
            postCommentInputItemIndex,
            ...remainingItem
        } = assertExists(item);

        if (remainingItem.type === "PostContent") {
            expect(
                list.getPostByIdIfExists((remainingItem.post as any).id)?.postContentItemIndex,
            ).toEqual(index);
        }

        return remainingItem;
    });
}

test("an empty list is empty", () => {
    expect(getItems(PostBasicList.new({type: "Many", hasMorePosts: false, posts: []}))).toEqual([]);
});

test("can insert some posts into the end", () => {
    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 20,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can toggle the comments for a post open", () => {
    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account2,
        content: testContent2WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account3,
        content: testContent3WithReferences,
        contentUpdatedTime: null,
        commentCount: 20,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account4,
        content: testContent4WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account5,
        content: testContent5WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post4.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post3.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 5},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 6},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 7},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 8},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 9},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 10},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 11},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 12},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 13},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 14},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 15},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 16},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 17},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 18},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 19},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post1.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 4},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 5},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 6},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 7},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 8},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 9},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 10},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 11},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 12},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 13},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 14},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 15},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 16},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 17},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 18},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 19},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post2.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 4},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2, postCommentsState: "Open"},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 5},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 6},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 7},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 8},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 9},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 10},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 11},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 12},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 13},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 14},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 15},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 16},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 17},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 18},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 19},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post3.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 4},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2, postCommentsState: "Open"},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post2.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post1, postCommentIndex: 4},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post1.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(post4.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can insert some posts into the end with already open comments", () => {
    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 20,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list
        .loadMorePosts({
            hasMorePosts: false,
            posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
        })
        .togglePostComments(post3.id);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can update the post comments list", () => {
    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 20,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });
    list = list
        .loadMorePosts({
            hasMorePosts: false,
            posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
        })
        .togglePostComments(post3.id);
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.updatePostComments(post3.id, () =>
        MessageList.new({messageCount: 3, lastMessageChangeTime: null}),
    );

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.updatePostComments(post3.id, () =>
        MessageList.new({messageCount: 7, lastMessageChangeTime: null}),
    );

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 5},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 6},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can add a channel header at the beginning", () => {
    const channel = new ChannelModel({
        id: channelId,
        spaceId,
        createdTime,
        name: "Test",
        description: {
            doc: emptyMessageContent,
            references: emptyContentReferences,
        },
        accessPolicy: {
            accountGrantById: emptyMap,
            urlGrant: null,
            defaultGrant: null,
        },
    });

    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account2,
        content: testContent2WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account3,
        content: testContent3WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account4,
        content: testContent4WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account5,
        content: testContent5WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });
    list = list
        .loadMorePosts({
            hasMorePosts: false,
            posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
        })
        .togglePostComments(post3.id);
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    const listWithHeader = new PostListWithHeader(
        {
            type: "Channel",
            channel,
            channelAndMetadataQuery: null,
            initialIsSubscribed: false,
            isEditingDescription: false,
            onCancelDescriptionEditing: noop,
            onSaveDescription: asyncNoop,
            onAddAccountGrantsToAccessPolicy: asyncNoop,
        },
        list,
    );

    expect(getItems(listWithHeader)).toEqual([
        {
            type: "Header",
            header: {
                type: "Channel",
                channel,
                channelAndMetadataQuery: null,
                initialIsSubscribed: false,
                isEditingDescription: false,
                onCancelDescriptionEditing: noop,
                onSaveDescription: asyncNoop,
                onAddAccountGrantsToAccessPolicy: asyncNoop,
            },
        },
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can add an unloaded posts section at the end", () => {
    let list = PostBasicList.new({type: "Many", hasMorePosts: false, posts: []});

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account1,
        content: testContent1WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account2,
        content: testContent2WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account3,
        content: testContent3WithReferences,
        contentUpdatedTime: null,
        commentCount: 5,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account4,
        content: testContent4WithReferences,
        contentUpdatedTime: null,
        commentCount: 1,
        lastCommentChangeTime: null,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channel,
        createdTime,
        author: account5,
        content: testContent5WithReferences,
        contentUpdatedTime: null,
        commentCount: 0,
        lastCommentChangeTime: null,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post1.id as any as DynamoItemKey, version: 0, model: post1}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post2.id as any as DynamoItemKey, version: 0, model: post2}],
    });
    list = list
        .loadMorePosts({
            hasMorePosts: false,
            posts: [{key: post3.id as any as DynamoItemKey, version: 0, model: post3}],
        })
        .togglePostComments(post3.id);
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post4.id as any as DynamoItemKey, version: 0, model: post4}],
    });
    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [{key: post5.id as any as DynamoItemKey, version: 0, model: post5}],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: true,
        posts: [],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
        {type: "MoreUnloadedPosts"},
    ]);

    list = list.loadMorePosts({
        hasMorePosts: false,
        posts: [],
    });

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});
