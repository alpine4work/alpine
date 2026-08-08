import {jest} from "@jest/globals";
import {sendLanguageModelsBedrockConverseRequestWithBearerToken} from "~/server/language_models/internal/bedrock_converse_development.js";
import {SupportedBedrockModel} from "~/server/language_models/supported_bedrock_model.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.open_source.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.open_source.js";
import {TracerRoot} from "~/shared/tracer/tracer_root.open_source.js";

const testBedrockModel: SupportedBedrockModel = "google.gemma-3-12b-it";

const originalAwsRegion = process.env.AWS_REGION;
const originalNodeEnv = process.env.NODE_ENV;
const originalFetch = globalThis.fetch;

afterEach(() => {
    process.env.AWS_REGION = originalAwsRegion;
    process.env.NODE_ENV = originalNodeEnv;
    globalThis.fetch = originalFetch;
    jest.clearAllMocks();
});

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

describe("sendLanguageModelsBedrockConverseRequestWithBearerToken", () => {
    test("should use fetch and default to us-east-1 in development", async () => {
        delete process.env.AWS_REGION;
        process.env.NODE_ENV = "development";

        const {events, tracer} = createTracerForTest();
        const expectedResponse = {
            output: {message: {content: [{text: "hello"}]}},
            usage: {
                inputTokens: 80,
                outputTokens: 10,
                totalTokens: 90,
            },
        };
        const fetchMock: jest.MockedFunction<(request: Request) => Promise<Response>> = jest.fn(
            async request => {
                expect(request.url).toContain(
                    "https://bedrock-runtime.us-east-1.amazonaws.com/model/",
                );
                expect(request.headers.get("authorization")).toBe("Bearer test-token");
                return new Response(JSON.stringify(expectedResponse), {status: 200});
            },
        );
        globalThis.fetch = fetchMock as typeof fetch;

        const response = await tracer.withSpan("Test Bedrock dev request", async span => {
            return await sendLanguageModelsBedrockConverseRequestWithBearerToken({
                awsBedrockTokenForDevelopment: "test-token",
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: span,
            });
        });

        expect(response).toMatchObject({
            response: expectedResponse,
            usage: {
                inputTokens: 80,
                outputTokens: 10,
                totalTokens: 90,
            },
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const bedrockEvent = [...events]
            .reverse()
            .find(event => event.getFlatData()["name"] === "Amazon Bedrock converse");
        const bedrockFlatData = bedrockEvent?.getFlatData();
        expect(bedrockFlatData).toMatchObject({
            "bedrock.model": testBedrockModel,
            "bedrock.region": "us-east-1",
            "bedrock.usage.input_tokens": 80,
            "bedrock.usage.output_tokens": 10,
            "bedrock.usage.total_tokens": 90,
            "bedrock.usage.input_tokens_millicents": 0.009,
        });
        expect(bedrockFlatData?.["bedrock.usage.output_tokens_millicents"]).toBeCloseTo(0.029);
        expect(bedrockFlatData?.["bedrock.usage.estimated_cost_millicents"]).toBeCloseTo(1.01);
    });

    test("should base64 encode image bytes in the development HTTP payload", async () => {
        process.env.AWS_REGION = "us-east-1";
        process.env.NODE_ENV = "development";

        const expectedResponse = {output: {message: {content: [{text: "hello"}]}}};
        const fetchMock: jest.MockedFunction<(request: Request) => Promise<Response>> = jest.fn(
            async request => {
                const requestBody = JSON.parse(await request.text()) as {
                    messages: Array<{
                        content: Array<{
                            image?: {source?: {bytes?: string}};
                            text?: string;
                        }>;
                    }>;
                };

                expect(requestBody.messages[0]?.content[0]?.image?.source?.bytes).toBe("AQID");
                return new Response(JSON.stringify(expectedResponse), {status: 200});
            },
        );
        globalThis.fetch = fetchMock as typeof fetch;

        await sendLanguageModelsBedrockConverseRequestWithBearerToken({
            awsBedrockTokenForDevelopment: "test-token",
            messages: [
                {
                    content: [
                        {
                            image: {
                                format: "jpeg",
                                source: {bytes: Uint8Array.from([1, 2, 3])},
                            },
                        },
                        {text: "Describe this image."},
                    ],
                    role: "user",
                },
            ],
            model: testBedrockModel,
            tracer: createTracerForTest().tracer,
        });

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    test("should assert that bearer-token requests are development-only", async () => {
        delete process.env.AWS_REGION;
        process.env.NODE_ENV = "production";

        await expect(
            sendLanguageModelsBedrockConverseRequestWithBearerToken({
                awsBedrockTokenForDevelopment: "test-token",
                messages: [{content: [{text: "Say hello"}], role: "user"}],
                model: testBedrockModel,
                tracer: createTracerForTest().tracer,
            }),
        ).rejects.toThrow("Bedrock bearer-token calls are only supported in development");
    });
});
