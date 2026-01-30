import {generateId} from "~/shared/id/id.js";
import {PostId} from "~/shared/id/types/id_types.js";
import {SearchEntityModel} from "~/shared/search/search_entity_model.js";

test("if title versions are equal than the second title\u2019s data wins", () => {
    const postId = generateId<PostId>();

    expect(
        SearchEntityModel.mergeData(
            {
                id: `Post:${postId}`,
                title: "a",
                titleVersion: {type: "Integers", versions: [4, 2]},
                media: null,
            },
            {
                id: `Post:${postId}`,
                title: "b",
                titleVersion: {type: "Integers", versions: [4, 2]},
                media: null,
            },
        ).title,
    ).toEqual("b");

    expect(
        SearchEntityModel.mergeData(
            {
                id: `Post:${postId}`,
                title: "b",
                titleVersion: {type: "Integers", versions: [4, 2]},
                media: null,
            },
            {
                id: `Post:${postId}`,
                title: "a",
                titleVersion: {type: "Integers", versions: [4, 2]},
                media: null,
            },
        ).title,
    ).toEqual("a");
});
