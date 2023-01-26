import {PaginatedPostList, PaginatedPostListItem} from "~/client/posts/paginated_post_list";
import {
    assertPostContent,
    PostContentProsemirrorSchema as schema,
} from "~/shared/content/post_content_schema";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length";
import {shuffleArray} from "~/shared/helpers/array/shuffle_array";
import {generateId} from "~/shared/id/id";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
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
function getItems(list: PaginatedPostList): Array<PaginatedPostListItem> {
    const indexOrder = shuffleArray(createArrayWithLength(list.getItemCount(), index => index));

    const items: Array<PaginatedPostListItem | null> = createArrayWithLength(
        list.getItemCount(),
        () => null,
    );

    for (const index of indexOrder) {
        items[index] = list.getItem(index);
    }

    return items as Array<PaginatedPostListItem>;
}

test("an empty list is empty", () => {
    expect(getItems(PaginatedPostList.empty)).toEqual([]);
});

test("can insert some posts into the end", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 20,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 1,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    list = list.insertAtEnd(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
    ]);

    list = list.insertAtEnd(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
    ]);

    list = list.insertAtEnd(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
    ]);

    list = list.insertAtEnd(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);
});

test("can insert some posts into the start", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 20,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 1,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    list = list.insertAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);
});

test("can insert some posts into the end and others at the start", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 20,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 1,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    list = list.insertAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
    ]);

    list = list.insertAtStart(post3);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
    ]);

    list = list.insertAtEnd(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
    ]);

    list = list.insertAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
    ]);
});

test("can toggle the comments for a post open", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account2,
        content: testContent2,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account3,
        content: testContent3,
        commentCount: 20,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account4,
        content: testContent4,
        commentCount: 1,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account5,
        content: testContent5,
        commentCount: 0,
    });

    list = list.insertAtEnd(post1);
    list = list.insertAtEnd(post2);
    list = list.insertAtEnd(post3);
    list = list.insertAtEnd(post4);
    list = list.insertAtEnd(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(6);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(0);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(7);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(9);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(7);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "UnloadedPostComment", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(0);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "UnloadedPostComment", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);

    list = list.togglePostComments(6);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);
});

test("can insert some posts into the end with already open comments", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 1,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 20,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    list = list.insertAtEnd(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtEnd(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
    ]);

    list = list.insertAtEnd(post3, {arePostCommentsOpen: true});

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
    ]);

    list = list.insertAtEnd(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
    ]);

    list = list.insertAtEnd(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
    ]);
});

test("can insert some posts into the start with already open comments", () => {
    let list = PaginatedPostList.empty;

    const post1 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 1,
    });

    const post2 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    const post3 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 5,
    });

    const post4 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 20,
    });

    const post5 = new PostModel({
        id: generateId(),
        spaceId,
        channelId,
        createdTime,
        author: account1,
        content: testContent1,
        commentCount: 0,
    });

    list = list.insertAtStart(post1);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post2);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post3, {arePostCommentsOpen: true});

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post4);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);

    list = list.insertAtStart(post5);

    expect(getItems(list)).toEqual([
        {type: "PostContent", post: post5},
        {type: "PostCommentInput", post: post5},
        {type: "PostContent", post: post4},
        {type: "PostCommentInput", post: post4},
        {type: "PostContent", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "UnloadedPostComment", post: post3},
        {type: "PostCommentInput", post: post3},
        {type: "PostContent", post: post2},
        {type: "PostCommentInput", post: post2},
        {type: "PostContent", post: post1},
        {type: "PostCommentInput", post: post1},
    ]);
});
