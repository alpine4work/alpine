import {jest} from "@jest/globals";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.js";

const testBedrockModel: SupportedBedrockModel = "google.gemma-3-12b-it";

const bedrockRuntimeClientSendMock = jest.fn<(command: unknown) => Promise<unknown>>();
const bedrockRuntimeClientConstructorMock = jest
    .fn()
    .mockImplementation((): {send: typeof bedrockRuntimeClientSendMock} => ({
        send: bedrockRuntimeClientSendMock,
    }));
const converseCommandConstructorMock = jest
    .fn()
    .mockImplementation((input: unknown): {input: unknown} => ({input}));
jest.unstable_mockModule("@aws-sdk/client-bedrock-runtime", () => ({
    BedrockRuntimeClient: bedrockRuntimeClientConstructorMock,
    ConverseCommand: converseCommandConstructorMock,
}));

const originalAwsRegion = process.env.AWS_REGION;
const originalNodeEnv = process.env.NODE_ENV;
afterEach(() => {
    process.env.AWS_REGION = originalAwsRegion;
    process.env.NODE_ENV = originalNodeEnv;
    jest.clearAllMocks();
    jest.resetModules();
});

// async import for mocking client-bedrock-runtime
async function importBedrockConverseModule() {
    return await import("./bedrock_converse.js");
}

function createTracerForTest() {
    const events: Array<TracerEvent> = [];
    const tracer = TracerRoot.new({
        clock: unsynchronizedSystemClock,
        jsHost: "Node",
        sendEvent: event => {
            events.push(event);
        },
        serviceName: "Test",
        untrusted: false,
    });

    return {events, tracer};
}

describe("languageModelsBedrockConverse", () => {
    test("should construct the Bedrock client", async () => {
        process.env.AWS_REGION = "eu-west-1";
        process.env.NODE_ENV = "production";

        const {events, tracer} = createTracerForTest();
        const expectedResponse = {
            output: {message: {content: [{text: "hello"}]}},
            usage: {
                inputTokens: 100,
                outputTokens: 20,
                totalTokens: 120,
            },
        };
        bedrockRuntimeClientSendMock.mockResolvedValue(expectedResponse);

        const {languageModelsBedrockConverse} = await importBedrockConverseModule();
        const response = await tracer.withSpan("Test Bedrock request", async span => {
            return await languageModelsBedrockConverse({
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: span,
            });
        });

        expect(response).toMatchObject({
            response: expectedResponse,
            usage: {
                inputTokens: 100,
                outputTokens: 20,
                totalTokens: 120,
            },
        });
        expect(bedrockRuntimeClientConstructorMock).toHaveBeenCalledWith();
        expect(converseCommandConstructorMock).toHaveBeenCalledWith(
            expect.objectContaining({
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                modelId: testBedrockModel,
            }),
        );
        expect(bedrockRuntimeClientSendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                input: expect.objectContaining({
                    modelId: testBedrockModel,
                }),
            }),
            expect.objectContaining({
                abortSignal: undefined,
            }),
        );
        const bedrockEvent = [...events]
            .reverse()
            .find(event => event.getFlatData()["name"] === "Amazon Bedrock converse");
        const bedrockFlatData = bedrockEvent?.getFlatData();
        expect(bedrockFlatData).toMatchObject({
            "bedrock.model": testBedrockModel,
            "bedrock.region": "eu-west-1",
            "bedrock.usage.input_tokens": 100,
            "bedrock.usage.input_tokens_millicents": 0.011,
            "bedrock.usage.output_tokens": 20,
            "bedrock.usage.output_tokens_millicents": 0.034,
            "bedrock.usage.total_tokens": 120,
        });
        expect(bedrockFlatData?.["bedrock.usage.estimated_cost_millicents"]).toBeCloseTo(1.78);
    });

    test("should not hardcode a fallback region in pricing metadata", async () => {
        delete process.env.AWS_REGION;
        process.env.NODE_ENV = "production";

        const {events, tracer} = createTracerForTest();
        bedrockRuntimeClientSendMock.mockResolvedValue({
            output: {message: {content: [{text: "hello"}]}},
            usage: {inputTokens: 1, outputTokens: 1, totalTokens: 2},
        });

        const {languageModelsBedrockConverse} = await importBedrockConverseModule();
        await tracer.withSpan("Test Bedrock request", async span => {
            await languageModelsBedrockConverse({
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: span,
            });
        });

        const bedrockEvent = [...events]
            .reverse()
            .find(event => event.getFlatData()["name"] === "Amazon Bedrock converse");
        expect(bedrockEvent?.getFlatData()).toMatchObject({
            "bedrock.model": testBedrockModel,
            "bedrock.usage.input_tokens": 1,
            "bedrock.usage.output_tokens": 1,
            "bedrock.usage.total_tokens": 2,
        });
    });
});
