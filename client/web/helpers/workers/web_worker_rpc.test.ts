import {WebWorkerRpc} from "~/client/web/helpers/workers/web_worker_rpc.js";
import {defineWebWorkerRpcMethods} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {UnknownError} from "~/shared/error/error.js";
import {Schema} from "~/shared/schema/schema.js";

const testMethods = defineWebWorkerRpcMethods({
    add: {
        input: {a: Schema.integer, b: Schema.integer},
        output: {sum: Schema.integer},
    },
    greet: {
        input: {name: Schema.string},
        output: {message: Schema.string},
    },
});

function createTestRpc(config?: {
    handlers?: Partial<{
        add: (input: {a: number; b: number}) => Promise<{sum: number}>;
        greet: (input: {name: string}) => Promise<{message: string}>;
    }>;
}) {
    const sent: Array<unknown> = [];
    const rpc = new WebWorkerRpc({
        callMethods: testMethods,
        handleMethods: testMethods,
        handlers: {
            add: config?.handlers?.add ?? (async ({a, b}) => ({sum: a + b})),
            greet: config?.handlers?.greet ?? (async ({name}) => ({message: `Hello, ${name}!`})),
        },
        send: message => sent.push(message),
    });
    return {rpc, sent};
}

describe("WebWorkerRpc", () => {
    describe("call", () => {
        test("sends a serialized request message", () => {
            const {rpc, sent} = createTestRpc();

            rpc.call("add", {a: 1, b: 2});

            expect(sent).toMatchObject([
                {type: "request", callId: 0, method: "add", input: {a: 1, b: 2}},
            ]);
        });

        test("increments callId for each call", () => {
            const {rpc, sent} = createTestRpc();

            rpc.call("add", {a: 1, b: 2});
            rpc.call("greet", {name: "Alice"});

            expect(sent[0]).toMatchObject({callId: 0});
            expect(sent[1]).toMatchObject({callId: 1});
        });

        test("resolves when a response is fed back", async () => {
            const {rpc} = createTestRpc();

            const promise = rpc.call("add", {a: 3, b: 4});

            // Feed the raw serialized response back into handleMessage.
            rpc.handleMessage({type: "response", callId: 0, output: {sum: 7}});

            expect(await promise).toEqual({sum: 7});
        });

        test("rejects when an error is fed back", async () => {
            const {rpc} = createTestRpc();

            const promise = rpc.call("add", {a: 1, b: 2});

            rpc.handleMessage({type: "error", callId: 0, message: "Something went wrong"});

            await expect(promise).rejects.toThrow("Something went wrong");
        });
    });

    describe("handleMessage (request)", () => {
        test("dispatches to the correct handler and sends response", async () => {
            const {rpc, sent} = createTestRpc();

            rpc.handleMessage({type: "request", callId: 42, method: "add", input: {a: 10, b: 20}});

            // Wait for the async handler to complete.
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(sent).toMatchObject([{type: "response", callId: 42, output: {sum: 30}}]);
        });

        test("sends error when handler throws", async () => {
            const {rpc, sent} = createTestRpc({
                handlers: {
                    add: async () => {
                        throw new UnknownError("Division by zero");
                    },
                },
            });

            rpc.handleMessage({type: "request", callId: 99, method: "add", input: {a: 1, b: 2}});

            await new Promise(resolve => setTimeout(resolve, 0));

            expect(sent).toMatchObject([{type: "error", callId: 99, message: "Division by zero"}]);
        });

        test("sends error for unknown method", () => {
            const {rpc, sent} = createTestRpc();

            rpc.handleMessage({type: "request", callId: 5, method: "unknown", input: {}});

            expect(sent).toMatchObject([
                {type: "error", callId: 5, message: "Unknown method: unknown"},
            ]);
        });
    });

    describe("round-trip", () => {
        test("two instances wired together", async () => {
            // Create two RPC instances that forward messages to each
            // other, simulating a main-thread <-> worker connection.
            const channel: {
                a?: WebWorkerRpc<typeof testMethods>;
                b?: WebWorkerRpc<typeof testMethods>;
            } = {};

            channel.a = new WebWorkerRpc({
                callMethods: testMethods,
                handleMethods: testMethods,
                handlers: {
                    add: async ({a, b}) => ({sum: a + b}),
                    greet: async ({name}) => ({message: `Hi, ${name}!`}),
                },
                send: msg => channel.b!.handleMessage(msg),
            });

            channel.b = new WebWorkerRpc({
                callMethods: testMethods,
                handleMethods: testMethods,
                handlers: {
                    add: async ({a, b}) => ({sum: a + b}),
                    greet: async ({name}) => ({message: `Hello, ${name}!`}),
                },
                send: msg => channel.a!.handleMessage(msg),
            });

            const result = await channel.a.call("add", {a: 5, b: 7});

            expect(result).toEqual({sum: 12});
        });

        test("asymmetric methods — each side calls different methods", async () => {
            const sideAMethods = defineWebWorkerRpcMethods({
                add: {
                    input: {a: Schema.integer, b: Schema.integer},
                    output: {sum: Schema.integer},
                },
            });

            const sideBMethods = defineWebWorkerRpcMethods({
                greet: {
                    input: {name: Schema.string},
                    output: {message: Schema.string},
                },
            });

            const channel: {
                a?: WebWorkerRpc<typeof sideAMethods, typeof sideBMethods>;
                b?: WebWorkerRpc<typeof sideBMethods, typeof sideAMethods>;
            } = {};

            channel.a = new WebWorkerRpc({
                callMethods: sideAMethods,
                handleMethods: sideBMethods,
                handlers: {
                    greet: async ({name}) => ({message: `Hi, ${name}!`}),
                },
                send: msg => channel.b!.handleMessage(msg),
            });

            channel.b = new WebWorkerRpc({
                callMethods: sideBMethods,
                handleMethods: sideAMethods,
                handlers: {
                    add: async ({a, b}) => ({sum: a + b}),
                },
                send: msg => channel.a!.handleMessage(msg),
            });

            // A calls B's "add" method
            const addResult = await channel.a.call("add", {a: 3, b: 4});
            expect(addResult).toEqual({sum: 7});

            // B calls A's "greet" method
            const greetResult = await channel.b.call("greet", {name: "Alice"});
            expect(greetResult).toEqual({message: "Hi, Alice!"});
        });
    });
});
