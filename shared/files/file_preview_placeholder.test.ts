import {FilePreviewPlaceholder} from "~/shared/files/file_preview_placeholder.js";

test("can serialize/deserialize a file preview placeholder", () => {
    const serializedPlaceholder = [
        false,
        8,
        "xNDUx9HWyNTYytXZy9bay9bYy9bXytTXz9fa0tnc1dze1t3f2N7g2N7g1tze1Nrd4OPi4uPj5ebp6Orr6err6erq6err5+npsq+no56Yraehvbu5zczK0c/KtrKspqKbvr++qq2qtLayxsfGzc7LysnFu7izqqmim62wm62xnLG1n7S3o7S5p7a6rbu+sr3A",
    ];

    const placeholder = FilePreviewPlaceholder.schema.deserialize(serializedPlaceholder);

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
        JSON.parse(JSON.stringify(new FilePreviewPlaceholder(deserializedPlaceholder).serialize())),
    ).toEqual(serializedPlaceholder);
});
