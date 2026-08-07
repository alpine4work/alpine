import {
    DataBuilderView,
    type DataViewInterface,
} from "~/shared/helpers/binary/data_builder_view.js";
import {captureResult} from "~/shared/helpers/control/capture_result.open_source.js";

type DataBuilderViewTestInterface = DataViewInterface & {
    pushUint8(value: number): void;
    pushBigUint64(value: bigint, littleEndian?: boolean): void;
};

type DataBuilderViewTestCase = {
    readonly name: string;
    readonly initialBytes: ReadonlyArray<number>;
    readonly byteLength?: number;
    readonly run: (view: DataBuilderViewTestInterface) => unknown;
};

const uint8CoercionValues: ReadonlyArray<number> = [
    -1,
    256,
    257,
    1.9,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
];

const bigUint64CoercionValues: ReadonlyArray<bigint> = [-1n, 2n ** 64n, 2n ** 64n + 1n];

const eightZeroBytes = [0, 0, 0, 0, 0, 0, 0, 0];

const dataBuilderViewTestCases: ReadonlyArray<DataBuilderViewTestCase> = [
    {
        name: "matches getUint8()",
        initialBytes: [0x00, 0x7f, 0xff],
        run: view => view.getUint8(2),
    },
    {
        name: "matches getUint8() offset coercion",
        initialBytes: [0x10, 0x20, 0x30],
        run: view => [
            view.getUint8(0.9),
            view.getUint8(1.9),
            view.getUint8(Number.NaN),
            view.getUint8(-0.9),
        ],
    },
    {
        name: "matches setUint8()",
        initialBytes: [0x00, 0x00, 0x00],
        run: view => {
            view.setUint8(0, 0x12);
            view.setUint8(1, 0xab);
            view.setUint8(2, 0xff);
        },
    },
    {
        name: "matches setUint8() offset coercion",
        initialBytes: [0x00, 0x00, 0x00],
        run: view => {
            view.setUint8(0.9, 0x10);
            view.setUint8(1.9, 0x20);
            view.setUint8(Number.NaN, 0x30);
            view.setUint8(-0.9, 0x40);
        },
    },
    {
        name: "matches setUint8() out-of-range value coercion",
        initialBytes: [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
        run: view => {
            for (const [byteOffset, value] of uint8CoercionValues.entries()) {
                view.setUint8(byteOffset, value);
            }
        },
    },
    {
        name: "matches mixed getUint8() and setUint8()",
        initialBytes: [0x10, 0x20, 0x30],
        run: view => {
            const value = view.getUint8(1);
            view.setUint8(1, value + 1);
            return view.getUint8(1);
        },
    },
    {
        name: "matches getBigUint64()",
        initialBytes: [
            0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03,
            0x02, 0x01,
        ],
        run: view => [view.getBigUint64(0), view.getBigUint64(8, true)],
    },
    {
        name: "matches getBigUint64() offset coercion",
        initialBytes: [0x00, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef],
        run: view => [view.getBigUint64(0.9), view.getBigUint64(Number.NaN)],
    },
    {
        name: "matches setBigUint64()",
        initialBytes: eightZeroBytes,
        run: view => {
            view.setBigUint64(0, 0x0123456789abcdefn);
        },
    },
    {
        name: "matches setBigUint64() littleEndian",
        initialBytes: eightZeroBytes,
        run: view => {
            view.setBigUint64(0, 0x0123456789abcdefn, true);
        },
    },
    {
        name: "matches setBigUint64() out-of-range value coercion",
        initialBytes: [...eightZeroBytes, ...eightZeroBytes, ...eightZeroBytes],
        run: view => {
            for (const [valueIndex, value] of bigUint64CoercionValues.entries()) {
                view.setBigUint64(valueIndex * 8, value);
            }
        },
    },
    {
        name: "matches mixed getBigUint64() and setBigUint64()",
        initialBytes: [...eightZeroBytes, ...eightZeroBytes],
        run: view => {
            view.setBigUint64(0, 0x0123456789abcdefn);
            view.setBigUint64(8, view.getBigUint64(0) + 1n, true);
            return view.getBigUint64(8, true);
        },
    },
    {
        name: "matches pushUint8() with incrementing setUint8() offsets",
        initialBytes: [],
        byteLength: 4,
        run: view => {
            view.pushUint8(0x00);
            view.pushUint8(0x7f);
            view.pushUint8(0x80);
            view.pushUint8(0xff);
        },
    },
    {
        name: "matches pushUint8() out-of-range value coercion",
        initialBytes: [],
        byteLength: uint8CoercionValues.length,
        run: view => {
            for (const value of uint8CoercionValues) {
                view.pushUint8(value);
            }
        },
    },
    {
        name: "matches pushUint8() after existing bytes",
        initialBytes: [0x10, 0x20],
        byteLength: 5,
        run: view => {
            view.pushUint8(0x30);
            view.pushUint8(0x40);
            view.pushUint8(0x50);
        },
    },
    {
        name: "matches pushBigUint64() with incrementing setBigUint64() offsets",
        initialBytes: [],
        byteLength: 16,
        run: view => {
            view.pushBigUint64(0x0123456789abcdefn);
            view.pushBigUint64(0x1020304050607080n, true);
        },
    },
    {
        name: "matches pushBigUint64() out-of-range value coercion",
        initialBytes: [],
        byteLength: bigUint64CoercionValues.length * 8,
        run: view => {
            for (const value of bigUint64CoercionValues) {
                view.pushBigUint64(value);
            }
        },
    },
    {
        name: "matches pushBigUint64() after existing bytes",
        initialBytes: [0xff],
        byteLength: 17,
        run: view => {
            view.pushBigUint64(0x0123456789abcdefn);
            view.pushBigUint64(0x1020304050607080n, true);
        },
    },
];

const dataBuilderViewErrorTestCases: ReadonlyArray<DataBuilderViewTestCase> = [
    {
        name: "matches getUint8() negative byteOffset error",
        initialBytes: [0x00],
        run: view => view.getUint8(-1),
    },
    {
        name: "matches getUint8() byteOffset bounds error",
        initialBytes: [0x00],
        run: view => view.getUint8(1),
    },
    {
        name: "matches setUint8() negative byteOffset error",
        initialBytes: [0x00],
        run: view => view.setUint8(-1, 0x00),
    },
    {
        name: "matches setUint8() byteOffset bounds error",
        initialBytes: [0x00],
        run: view => view.setUint8(1, 0x00),
    },
    {
        name: "matches setUint8() invalid value error",
        initialBytes: [0x00],
        run: view => view.setUint8(0, Symbol("value") as unknown as number),
    },
    {
        name: "matches pushUint8() invalid value error",
        initialBytes: [],
        byteLength: 1,
        run: view => view.pushUint8(Symbol("value") as unknown as number),
    },
    {
        name: "matches getBigUint64() negative byteOffset error",
        initialBytes: eightZeroBytes,
        run: view => view.getBigUint64(-1),
    },
    {
        name: "matches getBigUint64() byteOffset bounds error",
        initialBytes: eightZeroBytes,
        run: view => view.getBigUint64(1),
    },
    {
        name: "matches setBigUint64() negative byteOffset error",
        initialBytes: eightZeroBytes,
        run: view => view.setBigUint64(-1, 0n),
    },
    {
        name: "matches setBigUint64() byteOffset bounds error",
        initialBytes: eightZeroBytes,
        run: view => view.setBigUint64(1, 0n),
    },
    {
        name: "matches setBigUint64() invalid value error",
        initialBytes: eightZeroBytes,
        run: view => view.setBigUint64(0, 1 as unknown as bigint),
    },
    {
        name: "matches pushBigUint64() invalid value error",
        initialBytes: [],
        byteLength: 8,
        run: view => view.pushBigUint64(1 as unknown as bigint),
    },
];

test.each(dataBuilderViewTestCases)("$name", testCase => {
    const {dataBuilderView, dataViewBytes, dataViewTestInterface} = createTestViews(testCase);

    const dataBuilderViewResult = testCase.run(dataBuilderView);
    const dataViewResult = testCase.run(dataViewTestInterface);

    expect({
        bytes: dataBuilderView.build(),
        byteLength: dataBuilderView.byteLength,
        byteOffset: dataBuilderView.byteOffset,
        result: dataBuilderViewResult,
    }).toEqual({
        bytes: dataViewBytes,
        byteLength: dataViewTestInterface.byteLength,
        byteOffset: dataViewTestInterface.byteOffset,
        result: dataViewResult,
    });
});

test.each(dataBuilderViewErrorTestCases)("$name", testCase => {
    const {dataBuilderView, dataViewTestInterface} = createTestViews(testCase);
    const dataBuilderViewResult = captureResult(() => testCase.run(dataBuilderView));
    const dataViewResult = captureResult(() => testCase.run(dataViewTestInterface));

    expect(dataBuilderViewResult.ok).toEqual(false);
    expect(dataViewResult.ok).toEqual(false);

    if (!dataBuilderViewResult.ok && !dataViewResult.ok) {
        const dataBuilderViewError = dataBuilderViewResult.error;
        const dataViewError = dataViewResult.error;

        expect(dataBuilderViewError instanceof Error).toEqual(dataViewError instanceof Error);

        if (dataBuilderViewError instanceof Error && dataViewError instanceof Error) {
            expect({
                name: dataBuilderViewError.name,
                message: dataBuilderViewError.message,
            }).toEqual({
                name: dataViewError.name,
                message: dataViewError.message,
            });
        } else {
            expect(dataBuilderViewError).toEqual(dataViewError);
        }
    }
});

function createTestViews(testCase: DataBuilderViewTestCase): {
    readonly dataBuilderView: DataBuilderView;
    readonly dataViewBytes: Uint8Array;
    readonly dataViewTestInterface: DataBuilderViewTestInterface;
} {
    const dataBuilderView = new DataBuilderView();
    for (const byte of testCase.initialBytes) {
        dataBuilderView.pushUint8(byte);
    }

    const dataViewBytes = new Uint8Array(testCase.byteLength ?? testCase.initialBytes.length);
    for (const [byteOffset, byte] of testCase.initialBytes.entries()) {
        dataViewBytes[byteOffset] = byte;
    }
    const dataView = new DataView(dataViewBytes.buffer);
    let pushByteOffset = testCase.initialBytes.length;

    const dataViewTestInterface: DataBuilderViewTestInterface = {
        get byteOffset() {
            return dataView.byteOffset;
        },
        get byteLength() {
            return dataView.byteLength;
        },
        getUint8(byteOffset) {
            return dataView.getUint8(byteOffset);
        },
        setUint8(byteOffset, value) {
            dataView.setUint8(byteOffset, value);
        },
        getBigUint64(byteOffset, littleEndian) {
            return dataView.getBigUint64(byteOffset, littleEndian);
        },
        setBigUint64(byteOffset, value, littleEndian) {
            dataView.setBigUint64(byteOffset, value, littleEndian);
        },
        pushUint8(value) {
            dataView.setUint8(pushByteOffset, value);
            pushByteOffset += 1;
        },
        pushBigUint64(value, littleEndian) {
            dataView.setBigUint64(pushByteOffset, value, littleEndian);
            pushByteOffset += 8;
        },
    };

    return {dataBuilderView, dataViewBytes, dataViewTestInterface};
}
