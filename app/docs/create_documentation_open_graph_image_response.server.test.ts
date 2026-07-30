import {jest} from "@jest/globals";

const loadGeneratedDocumentationOpenGraphImageMock = jest
    .fn<() => Promise<Buffer | null>>()
    .mockResolvedValue(Buffer.from([1]));

jest.unstable_mockModule("./load_generated_docs.server.js", () => ({
    loadGeneratedDocumentationOpenGraphImage: loadGeneratedDocumentationOpenGraphImageMock,
}));

// Must be dynamically imported after the generated image loader is mocked.
const {createDocumentationOpenGraphImageResponse} =
    await import("~/app/docs/create_documentation_open_graph_image_response.server.js");

Object.defineProperty(globalThis, "Response", {
    configurable: true,
    value: class {
        readonly headers: Headers;

        constructor(_body: BodyInit | null, init: ResponseInit) {
            this.headers = new Headers(init.headers);
        }
    },
});

test("caches generated Open Graph images like stable documentation media", async () => {
    const response = await createDocumentationOpenGraphImageResponse("/docs/overview");

    expect(Object.fromEntries(response.headers)).toMatchObject({
        "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
        "content-type": "image/png",
        "cyberworlds-documentation-cache-policy": "StableMedia",
    });
});
