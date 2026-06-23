import {
    ApiContentKeyDecoder,
    ApiContentKeyEncoder,
} from "~/shared/api/content/api_content_key_encoder.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {generateId} from "~/shared/id/id.js";
import type {DocumentId} from "~/shared/id/types/id_types.js";

const documentEntityId = "Document:2hxv0y1b6zye9q87w2bt7fks3g";

test.each([
    {
        version: 0,
        pos: 0,
        nodeSize: 1,
        key: "NaTPHJCG",
    },
    {
        version: 1,
        pos: 0,
        nodeSize: 1,
        key: "6GxnEP9Q",
    },
    {
        version: 2,
        pos: 0,
        nodeSize: 1,
        key: "9rrkjAoK",
    },
    {
        version: 3,
        pos: 0,
        nodeSize: 1,
        key: "PGzXTwPf",
    },
    {
        version: 0,
        pos: 1,
        nodeSize: 1,
        key: "aTg91-8t",
    },
    {
        version: 0,
        pos: 2,
        nodeSize: 1,
        key: "PHvmQ0fr",
    },
    {
        version: 0,
        pos: 3,
        nodeSize: 1,
        key: "BErauysH",
    },
    {
        version: 1,
        pos: 1,
        nodeSize: 1,
        key: "QRcT0ykx",
    },
    {
        version: 1,
        pos: 2,
        nodeSize: 1,
        key: "e_yUygj3",
    },
    {
        version: 1,
        pos: 3,
        nodeSize: 1,
        key: "5buv3gy4",
    },
    {
        version: 2,
        pos: 1,
        nodeSize: 1,
        key: "_4B6NiO8",
    },
    {
        version: 2,
        pos: 2,
        nodeSize: 1,
        key: "y-y-VxGw",
    },
    {
        version: 2,
        pos: 3,
        nodeSize: 1,
        key: "X-dc6tWR",
    },
    {
        version: 0,
        pos: 14,
        nodeSize: 31,
        key: "yMV5z1PG",
    },
    {
        version: 2,
        pos: 148,
        nodeSize: 42,
        key: "YAzvYOj8Uw",
    },
    {
        version: 7,
        pos: 12_834,
        nodeSize: 1_209,
        key: "O2-60-sO_OY",
    },
    {
        version: 13,
        pos: 1_030_441,
        nodeSize: 89_003,
        key: "fBRdXOTtuD8jfQ",
    },
    {
        version: 6_120,
        pos: 48_218_390,
        nodeSize: 2_048,
        key: "Jvt6JG8v925lV9w",
    },
])("encodes and decodes `$key`", ({version, pos, nodeSize, key}) => {
    const encoder = new ApiContentKeyEncoder({entityId: documentEntityId, version});
    const decoder = new ApiContentKeyDecoder(documentEntityId);

    expect(encoder.encode({pos, nodeSize})).toEqual(key);
    expect(decoder.decode(key)).toEqual({version, pos, nodeSize});
});

test("decodes exact data encoded for random content keys", () => {
    const cases = createArrayWithLength(10_000, () => ({
        entityId: `Document:${generateId<DocumentId>()}`,
        version: randomSafeInteger(),
        pos: randomSafeInteger(),
        nodeSize: randomSafeInteger(),
    }));

    for (const {entityId, version, pos, nodeSize} of cases) {
        const encoder = new ApiContentKeyEncoder({entityId, version});
        const decoder = new ApiContentKeyDecoder(entityId);

        const key = encoder.encode({pos, nodeSize});

        expect(decoder.decode(key)).toEqual({version, pos, nodeSize});
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
