import {Command, MetadataBearer} from "@aws-sdk/types";
import {DynamoClient} from "~/server/dynamo/internal/dynamo-client";
import {createArrayWithLength} from "~/shared/helpers/array/create-array-with-length";
import {waitMicrotask} from "~/shared/helpers/async/wait-microtask";

function createSendJestFn(): {
    <InputType extends object, OutputType extends MetadataBearer>(
        command: Command<object, InputType, MetadataBearer, OutputType, object>,
    ): Promise<OutputType>;
} & jest.Mock<
    Promise<never>,
    [command: Command<object, object, MetadataBearer, MetadataBearer, object>]
> {
    return jest.fn(() => new Promise<never>(() => {})) as any;
}

test("batches get item calls together after two microtasks", async () => {
    const send = createSendJestFn();
    const client = new DynamoClient({send});

    void client.getItem({
        tableName: "T1",
        key: {pk: "a", sk: 1},
    });
    void client.getItem({
        tableName: "T1",
        key: {pk: "a", sk: 2},
    });
    void client.getItem({
        tableName: "T1",
        key: {pk: "a", sk: 1},
    });
    void client.getItem({
        tableName: "T2",
        key: {pk: "b", sk: 1},
    });

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(1);
    expect(send.mock.lastCall[0].input).toEqual({
        RequestItems: {
            T1: {
                ConsistentRead: false,
                Keys: [
                    {pk: {S: "a"}, sk: {N: "1"}},
                    {pk: {S: "a"}, sk: {N: "2"}},
                ],
            },
            T2: {
                ConsistentRead: false,
                Keys: [{pk: {S: "b"}, sk: {N: "1"}}],
            },
        },
    });
});

test("batches get item calls together after more than two microtasks if items keep getting requested", async () => {
    const send = createSendJestFn();
    const client = new DynamoClient({send});

    void client.getItem({
        tableName: "T",
        key: {pk: "a", sk: 1},
    });
    void client.getItem({
        tableName: "T",
        key: {pk: "b", sk: 1},
    });

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(0);

    void client.getItem({
        tableName: "T",
        key: {pk: "c", sk: 1},
    });

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(0);

    void client.getItem({
        tableName: "T",
        key: {pk: "d", sk: 1},
    });

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();

    expect(send).toBeCalledTimes(1);
    expect(send.mock.lastCall[0].input).toEqual({
        RequestItems: {
            T: {
                ConsistentRead: false,
                Keys: [
                    {pk: {S: "a"}, sk: {N: "1"}},
                    {pk: {S: "b"}, sk: {N: "1"}},
                    {pk: {S: "c"}, sk: {N: "1"}},
                    {pk: {S: "d"}, sk: {N: "1"}},
                ],
            },
        },
    });
});

test("splits batches into a maximum of 100 items at a time", async () => {
    const send = createSendJestFn();
    const client = new DynamoClient({send});

    for (let i = 0; i < 50; i++) {
        void client.getItem({
            tableName: "T1",
            key: {pk: i, sk: ""},
        });
    }

    for (let i = 0; i < 100; i++) {
        void client.getItem({
            tableName: "T2",
            key: {pk: i, sk: ""},
        });
    }

    for (let i = 0; i < 50; i++) {
        void client.getItem({
            tableName: "T3",
            key: {pk: i, sk: ""},
        });
    }

    for (let i = 0; i < 70; i++) {
        void client.getItem({
            tableName: "T4",
            key: {pk: i, sk: ""},
        });
    }

    for (let i = 0; i < 50; i++) {
        void client.getItem({
            tableName: "T5",
            key: {pk: i, sk: ""},
        });
    }

    expect(send).toBeCalledTimes(0);
    await waitMicrotask();
    await waitMicrotask();
    expect(send).toBeCalledTimes(4);

    expect(send.mock.calls[0]![0].input).toEqual({
        RequestItems: {
            T1: {
                ConsistentRead: false,
                Keys: createArrayWithLength(50, i => ({pk: {N: String(i)}, sk: {S: ""}})),
            },
            T2: {
                ConsistentRead: false,
                Keys: createArrayWithLength(50, i => ({pk: {N: String(i)}, sk: {S: ""}})),
            },
        },
    });

    expect(send.mock.calls[1]![0].input).toEqual({
        RequestItems: {
            T2: {
                ConsistentRead: false,
                Keys: createArrayWithLength(50, i => ({pk: {N: String(50 + i)}, sk: {S: ""}})),
            },
            T3: {
                ConsistentRead: false,
                Keys: createArrayWithLength(50, i => ({pk: {N: String(i)}, sk: {S: ""}})),
            },
        },
    });

    expect(send.mock.calls[2]![0].input).toEqual({
        RequestItems: {
            T4: {
                ConsistentRead: false,
                Keys: createArrayWithLength(70, i => ({pk: {N: String(i)}, sk: {S: ""}})),
            },
            T5: {
                ConsistentRead: false,
                Keys: createArrayWithLength(30, i => ({pk: {N: String(i)}, sk: {S: ""}})),
            },
        },
    });

    expect(send.mock.calls[3]![0].input).toEqual({
        RequestItems: {
            T5: {
                ConsistentRead: false,
                Keys: createArrayWithLength(20, i => ({pk: {N: String(30 + i)}, sk: {S: ""}})),
            },
        },
    });
});

test("different read consistencies are in different batches", async () => {
    const send = createSendJestFn();
    const client = new DynamoClient({send});

    void client.getItem({
        tableName: "T1",
        key: {pk: "a", sk: 1},
        consistency: "Eventual",
    });
    void client.getItem({
        tableName: "T2",
        key: {pk: "b", sk: 1},
        consistency: "Strong",
    });

    expect(send).toBeCalledTimes(0);

    await waitMicrotask();
    await waitMicrotask();

    expect(send).toBeCalledTimes(2);

    expect(send.mock.calls[0]![0].input).toEqual({
        RequestItems: {
            T1: {
                ConsistentRead: false,
                Keys: [{pk: {S: "a"}, sk: {N: "1"}}],
            },
        },
    });

    expect(send.mock.calls[1]![0].input).toEqual({
        RequestItems: {
            T2: {
                ConsistentRead: true,
                Keys: [{pk: {S: "b"}, sk: {N: "1"}}],
            },
        },
    });
});
