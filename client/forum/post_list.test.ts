import {PostList, PostListItem} from "~/client/forum/post_list";
import {MessageList} from "~/client/messaging/message_list";
import {emptyMessageContent} from "~/shared/content/message_content_schema";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/content/post_content_schema";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {generateId} from "~/shared/id/id";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {ChannelModel} from "~/shared/models/channel_model";
import {PostModel} from "~/shared/models/post_model";

const spaceId = generateId<SpaceId>();
const channelId = generateId<ChannelId>();
const createdTime = new Date();

const account1 = new AccountModel({id: generateId(), name: "Test 1", createdTime});
const account2 = new AccountModel({id: generateId(), name: "Test 2", createdTime});
const account3 = new AccountModel({id: generateId(), name: "Test 3", createdTime});
const account4 = new AccountModel({id: generateId(), name: "Test 4", createdTime});
const account5 = new AccountModel({id: generateId(), name: "Test 5", createdTime});

const testContent1 = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test1")])]),
);
const testContent2 = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test2")])]),
);
const testContent3 = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test3")])]),
);
const testContent4 = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test4")])]),
);
const testContent5 = assertPostContent(
    schema.node("doc", {}, [schema.node("paragraph", {}, [schema.text("test5")])]),
);

/**
 * Get all items in the list as an array. Accesses the items in random order to
 * exercise our caching logic.
 */
function getItems(list: PostList) {
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
            expect(list.getItemCountBeforePostId((remainingItem.post as any).id)).toEqual(index);
        }

        return remainingItem;
    });
}

test("an empty list is empty", () => {
    expect(getItems(PostList.empty)).toEqual([]);
});

test("can insert some posts into the end", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can insert some posts into the start", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);
});

test("can insert some posts into the end and others at the start", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
    ]);
});

test("can toggle the comments for a post open", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account2,
        content: testContent2,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account3,
        content: testContent3,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account4,
        content: testContent4,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account5,
        content: testContent5,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);
    list = list.insertPostAtEnd(post2);
    list = list.insertPostAtEnd(post3);
    list = list.insertPostAtEnd(post4);
    list = list.insertPostAtEnd(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(2);

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

    list = list.togglePostComments(0);

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

    list = list.togglePostComments(7);

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

    list = list.togglePostComments(9);

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

    list = list.togglePostComments(7);

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

    list = list.togglePostComments(0);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post4, postCommentIndex: 0},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);

    list = list.togglePostComments(3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
    ]);
});

test("can insert some posts into the end with already open comments", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtEnd(post3, {postCommentsState: "Open"});

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

    list = list.insertPostAtEnd(post4);

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

    list = list.insertPostAtEnd(post5);

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

test("can insert some posts into the start with already open comments", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post3, {postCommentsState: "Open"});

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);

    list = list.insertPostAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5, postCommentsState: "Closed"},
        {type: "PostContent", post: post4, postCommentsState: "Closed"},
        {type: "PostContent", post: post3, postCommentsState: "Open"},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 0},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 1},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 2},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 3},
        {type: "UnloadedPostComment", post: post3, postCommentIndex: 4},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2, postCommentsState: "Closed"},
        {type: "PostContent", post: post1, postCommentsState: "Closed"},
    ]);
});

test("can update the post comments list", () => {
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 20,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);
    list = list.insertPostAtEnd(post2);
    list = list.insertPostAtEnd(post3, {postCommentsState: "Open"});
    list = list.insertPostAtEnd(post4);
    list = list.insertPostAtEnd(post5);

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

    list = list.updatePostComments(post3.id, () => MessageList.new(3));

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

    list = list.updatePostComments(post3.id, () => MessageList.new(7));

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
        description: emptyMessageContent,
    });

    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account2,
        content: testContent2,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account3,
        content: testContent3,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account4,
        content: testContent4,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account5,
        content: testContent5,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);
    list = list.insertPostAtEnd(post2);
    list = list.insertPostAtEnd(post3, {postCommentsState: "Open"});
    list = list.insertPostAtEnd(post4);
    list = list.insertPostAtEnd(post5);

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

    list = list.setChannelHeader({channel});

    expect(getItems(list)).toEqual([
        {type: "ChannelHeader", channelHeader: {channel}},
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

    list = list.setChannelHeader(null);

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
    let list = PostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account2,
        content: testContent2,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account3,
        content: testContent3,
        contentUpdatedTime: null,
        commentCount: 5,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account4,
        content: testContent4,
        contentUpdatedTime: null,
        commentCount: 1,
        commentAuthorCount: 1,
        previewCommentAuthors: [account1],
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account5,
        content: testContent5,
        contentUpdatedTime: null,
        commentCount: 0,
        commentAuthorCount: 0,
        previewCommentAuthors: [],
    });

    list = list.insertPostAtEnd(post1);
    list = list.insertPostAtEnd(post2);
    list = list.insertPostAtEnd(post3, {postCommentsState: "Open"});
    list = list.insertPostAtEnd(post4);
    list = list.insertPostAtEnd(post5);

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

    list = list.setHasMorePosts(true);

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

    list = list.setHasMorePosts(false);

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
