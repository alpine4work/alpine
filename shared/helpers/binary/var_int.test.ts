import {DataBuilderView} from "~/shared/helpers/binary/data_builder_view.js";
import {getVarInt, pushVarInt} from "~/shared/helpers/binary/var_int.js";

const varIntCases: ReadonlyArray<{
    readonly value: number;
    readonly bytes: ReadonlyArray<number>;
}> = [
    {value: 0, bytes: [0x00]},
    {value: 1, bytes: [0x01]},
    {value: 127, bytes: [0x7f]},
    {value: 128, bytes: [0x80, 0x01]},
    {value: 129, bytes: [0x81, 0x01]},
    {value: 300, bytes: [0xac, 0x02]},
    {value: 16_384, bytes: [0x80, 0x80, 0x01]},
    {value: 2 ** 32 - 1, bytes: [0xff, 0xff, 0xff, 0xff, 0x0f]},
    {
        value: Number.MAX_SAFE_INTEGER,
        bytes: [0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x0f],
    },
];

test.each(varIntCases)("pushes $value as protobuf varint bytes", ({value, bytes}) => {
    const view = new DataBuilderView();

    pushVarInt(view, value);

    expect([...view.build()]).toEqual(bytes);
});

test.each(varIntCases)("gets $value from protobuf varint bytes", ({value, bytes}) => {
    const data = new Uint8Array([0xaa, ...bytes, 0xbb]);
    const view = new DataView(data.buffer);

    expect(getVarInt(view, 1)).toEqual({value, byteOffset: 1 + bytes.length});
});

test("gets protobuf varint bytes after coercing byteOffset", () => {
    const view = new DataView(new Uint8Array([0xac, 0x02]).buffer);

    expect(getVarInt(view, 0.9)).toEqual({value: 300, byteOffset: 2});
});

test("pushes and gets consecutive protobuf varints", () => {
    const values = [0, 1, 127, 128, 300, Number.MAX_SAFE_INTEGER];
    const builderView = new DataBuilderView();
    for (const value of values) {
        pushVarInt(builderView, value);
    }

    const bytes = builderView.build();
    const view = new DataView(bytes.buffer);
    const decodedValues: Array<number> = [];
    let byteOffset = 0;
    while (byteOffset < bytes.length) {
        const result = getVarInt(view, byteOffset);
        decodedValues.push(result.value);
        byteOffset = result.byteOffset;
    }

    expect({decodedValues, byteOffset}).toEqual({decodedValues: values, byteOffset: bytes.length});
});

test("gets non-canonical protobuf varint bytes", () => {
    const view = new DataView(new Uint8Array([0x80, 0x00]).buffer);

    expect(getVarInt(view, 0)).toEqual({value: 0, byteOffset: 2});
});

test.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN, Number.POSITIVE_INFINITY])(
    "throws for invalid varint value $value",
    value => {
        const view = new DataBuilderView();

        expect(() => pushVarInt(view, value)).toThrow(
            "Varint value must be a non-negative safe integer",
        );
    },
);

test.each([
    {name: "missing terminal byte", bytes: [0x80]},
    {name: "overflow", bytes: [0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x10]},
])("throws for invalid protobuf varint bytes: $name", ({bytes}) => {
    const view = new DataView(new Uint8Array(bytes).buffer);

    expect(() => getVarInt(view, 0)).toThrow("Invalid varint encoding");
});
