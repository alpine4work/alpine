import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/closed_source/api_content_key_encoder.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {generateId} from "~/shared/id/id.js";
import type {DocumentId} from "~/shared/id/types/id_types.js";

const documentEntityId = "Document:2hxv0y1b6zye9q87w2bt7fks3g";

test.each([
    {
        version: 0,
        pos: 0,
        nodeSize: 1,
        inlineContent: true,
        key: "8uf_rEFd",
    },
    {
        version: 1,
        pos: 0,
        nodeSize: 1,
        inlineContent: true,
        key: "HKOo62np",
    },
    {
        version: 2,
        pos: 0,
        nodeSize: 1,
        inlineContent: true,
        key: "TWv8PGBY",
    },
    {
        version: 3,
        pos: 0,
        nodeSize: 1,
        inlineContent: true,
        key: "XO9CZMEA",
    },
    {
        version: 0,
        pos: 1,
        nodeSize: 1,
        inlineContent: false,
        key: "aTg91-8t",
    },
    {
        version: 0,
        pos: 2,
        nodeSize: 1,
        inlineContent: false,
        key: "PHvmQ0fr",
    },
    {
        version: 0,
        pos: 3,
        nodeSize: 1,
        inlineContent: false,
        key: "BErauysH",
    },
    {
        version: 1,
        pos: 1,
        nodeSize: 1,
        inlineContent: true,
        key: "Lac3_Q9w",
    },
    {
        version: 1,
        pos: 2,
        nodeSize: 1,
        inlineContent: false,
        key: "e_yUygj3",
    },
    {
        version: 1,
        pos: 3,
        nodeSize: 1,
        inlineContent: true,
        key: "l9Xd1iZa",
    },
    {
        version: 2,
        pos: 1,
        nodeSize: 1,
        inlineContent: false,
        key: "_4B6NiO8",
    },
    {
        version: 2,
        pos: 2,
        nodeSize: 1,
        inlineContent: true,
        key: "i7e2z-ZT",
    },
    {
        version: 2,
        pos: 3,
        nodeSize: 1,
        inlineContent: false,
        key: "X-dc6tWR",
    },
    {
        version: 0,
        pos: 14,
        nodeSize: 31,
        inlineContent: true,
        key: "6Opahuto",
    },
    {
        version: 2,
        pos: 148,
        nodeSize: 42,
        inlineContent: false,
        key: "YAzvYOj8Uw",
    },
    {
        version: 7,
        pos: 12_834,
        nodeSize: 1_209,
        inlineContent: true,
        key: "pi0mlaUgPzw",
    },
    {
        version: 13,
        pos: 1_030_441,
        nodeSize: 89_003,
        inlineContent: false,
        key: "fBRdXOTtuD8jfQ",
    },
    {
        version: 6_120,
        pos: 48_218_390,
        nodeSize: 2_048,
        inlineContent: true,
        key: "ToSIMNunyA66tJw",
    },
])("encodes and decodes `$key`", ({version, pos, nodeSize, inlineContent, key}) => {
    const encoder = new ApiContentKeyEncoder({entityId: documentEntityId, version});
    const decoder = new ApiContentKeyDecoder(documentEntityId);

    expect(encoder.encode({pos, nodeSize, inlineContent})).toEqual(key);
    expect(decoder.decode(key)).toEqual({version, pos, nodeSize, inlineContent});
});

test("decodes exact data encoded for random content keys", () => {
    const cases = createArrayWithLength(10_000, () => ({
        entityId: `Document:${generateId<DocumentId>()}`,
        version: randomSafeInteger(),
        pos: randomSafeInteger(),
        nodeSize: randomSafeInteger(),
        inlineContent: Math.random() < 0.5,
    }));

    for (const {entityId, version, pos, nodeSize, inlineContent} of cases) {
        const encoder = new ApiContentKeyEncoder({entityId, version});
        const decoder = new ApiContentKeyDecoder(entityId);

        const key = encoder.encode({pos, nodeSize, inlineContent});

        expect(decoder.decode(key)).toEqual({version, pos, nodeSize, inlineContent});
    }
});

test("throws when content key does not match entityId", () => {
    expect(() => new ApiContentKeyDecoder(documentEntityId).decode("6Z47u2ZI")).toThrow(
        "Content key doesn\u2019t match `entityId`",
    );
});

function randomSafeInteger(): number {
    return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
}
