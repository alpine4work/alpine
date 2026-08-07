import {FileImagePreviewPlaceholder} from "~/shared/files/file_image_preview_placeholder.js";
import {JsonStringifiableUint8Array} from "~/shared/schema/schema.open_source.js";

test("can serialize/deserialize a file preview placeholder", () => {
    const serializedPlaceholder = [
        false,
        8,
        "xNDUx9HWyNTYytXZy9bay9bYy9bXytTXz9fa0tnc1dze1t3f2N7g2N7g1tze1Nrd4OPi4uPj5ebp6Orr6err6erq6err5+npsq+no56Yraehvbu5zczK0c/KtrKspqKbvr++qq2qtLayxsfGzc7LysnFu7izqqmim62wm62xnLG1n7S3o7S5p7a6rbu+sr3A",
    ];

    const placeholder = FileImagePreviewPlaceholder.schema.deserialize(serializedPlaceholder);

    const deserializedPlaceholder = placeholder.get();

    const expectedDeserializedPlaceholder = [
        [
            {r: 196, g: 208, b: 212},
            {r: 199, g: 209, b: 214},
            {r: 200, g: 212, b: 216},
            {r: 202, g: 213, b: 217},
            {r: 203, g: 214, b: 218},
            {r: 203, g: 214, b: 216},
            {r: 203, g: 214, b: 215},
            {r: 202, g: 212, b: 215},
        ],
        [
            {r: 207, g: 215, b: 218},
            {r: 210, g: 217, b: 220},
            {r: 213, g: 220, b: 222},
            {r: 214, g: 221, b: 223},
            {r: 216, g: 222, b: 224},
            {r: 216, g: 222, b: 224},
            {r: 214, g: 220, b: 222},
            {r: 212, g: 218, b: 221},
        ],
        [
            {r: 224, g: 227, b: 226},
            {r: 226, g: 227, b: 227},
            {r: 229, g: 230, b: 233},
            {r: 232, g: 234, b: 235},
            {r: 233, g: 234, b: 235},
            {r: 233, g: 234, b: 234},
            {r: 233, g: 234, b: 235},
            {r: 231, g: 233, b: 233},
        ],
        [
            {r: 178, g: 175, b: 167},
            {r: 163, g: 158, b: 152},
            {r: 173, g: 167, b: 161},
            {r: 189, g: 187, b: 185},
            {r: 205, g: 204, b: 202},
            {r: 209, g: 207, b: 202},
            {r: 182, g: 178, b: 172},
            {r: 166, g: 162, b: 155},
        ],
        [
            {r: 190, g: 191, b: 190},
            {r: 170, g: 173, b: 170},
            {r: 180, g: 182, b: 178},
            {r: 198, g: 199, b: 198},
            {r: 205, g: 206, b: 203},
            {r: 202, g: 201, b: 197},
            {r: 187, g: 184, b: 179},
            {r: 170, g: 169, b: 162},
        ],
        [
            {r: 155, g: 173, b: 176},
            {r: 155, g: 173, b: 177},
            {r: 156, g: 177, b: 181},
            {r: 159, g: 180, b: 183},
            {r: 163, g: 180, b: 185},
            {r: 167, g: 182, b: 186},
            {r: 173, g: 187, b: 190},
            {r: 178, g: 189, b: 192},
        ],
    ];

    expect(deserializedPlaceholder).toEqual(expectedDeserializedPlaceholder);

    expect(
        JSON.parse(
            JSON.stringify(
                FileImagePreviewPlaceholder.schema.serialize(
                    new FileImagePreviewPlaceholder(deserializedPlaceholder),
                ),
            ),
        ),
    ).toEqual(serializedPlaceholder);
});

test("can go through a serialize, JSON, deserialize, serialize loop", () => {
    const placeholder1 = FileImagePreviewPlaceholder.fromSerialized([
        false,
        5,
        new Uint8Array([
            200, 212, 216, 205, 215, 219, 206, 216, 220, 206, 215, 219, 205, 214, 218, 214, 217,
            217, 218, 220, 220, 223, 227, 227, 226, 228, 229, 221, 222, 224, 184, 180, 174, 182,
            178, 172, 208, 206, 203, 208, 205, 200, 176, 173, 164, 149, 167, 171, 150, 170, 173,
            159, 178, 180, 163, 178, 181, 167, 178, 180,
        ]),
    ]);

    const placeholder2 = FileImagePreviewPlaceholder.schema.serialize(placeholder1);

    expect(placeholder2).toEqual([
        false,
        5,
        new JsonStringifiableUint8Array([
            200, 212, 216, 205, 215, 219, 206, 216, 220, 206, 215, 219, 205, 214, 218, 214, 217,
            217, 218, 220, 220, 223, 227, 227, 226, 228, 229, 221, 222, 224, 184, 180, 174, 182,
            178, 172, 208, 206, 203, 208, 205, 200, 176, 173, 164, 149, 167, 171, 150, 170, 173,
            159, 178, 180, 163, 178, 181, 167, 178, 180,
        ]),
    ]);

    const placeholder3 = JSON.stringify(placeholder2);

    expect(placeholder3).toEqual(
        // eslint-disable-next-line cyberworlds/string-quotes
        '[false,5,"yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0"]',
    );

    const placeholder4 = JSON.parse(placeholder3);

    expect(placeholder4).toEqual([
        false,
        5,
        "yNTYzdfbztjcztfbzdba1tnZ2tzc3+Pj4uTl3d7guLSutrKs0M7L0M3IsK2klaerlqqtn7K0o7K1p7K0",
    ]);

    const placeholder5 = FileImagePreviewPlaceholder.schema.deserialize(placeholder4);

    expect(placeholder5).toEqual(
        FileImagePreviewPlaceholder.fromSerialized([
            false,
            5,
            new Uint8Array([
                200, 212, 216, 205, 215, 219, 206, 216, 220, 206, 215, 219, 205, 214, 218, 214, 217,
                217, 218, 220, 220, 223, 227, 227, 226, 228, 229, 221, 222, 224, 184, 180, 174, 182,
                178, 172, 208, 206, 203, 208, 205, 200, 176, 173, 164, 149, 167, 171, 150, 170, 173,
                159, 178, 180, 163, 178, 181, 167, 178, 180,
            ]),
        ]),
    );

    const placeholder6 = FileImagePreviewPlaceholder.schema.serialize(placeholder5);

    expect(placeholder6).toEqual([
        false,
        5,
        new JsonStringifiableUint8Array([
            200, 212, 216, 205, 215, 219, 206, 216, 220, 206, 215, 219, 205, 214, 218, 214, 217,
            217, 218, 220, 220, 223, 227, 227, 226, 228, 229, 221, 222, 224, 184, 180, 174, 182,
            178, 172, 208, 206, 203, 208, 205, 200, 176, 173, 164, 149, 167, 171, 150, 170, 173,
            159, 178, 180, 163, 178, 181, 167, 178, 180,
        ]),
    ]);
});
