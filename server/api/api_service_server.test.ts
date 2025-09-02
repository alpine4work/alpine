import {IncomingMessage, ServerResponse} from "http";
import request from "supertest";
import {createApiServiceRequestListener} from "~/server/api/api_service_server.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";

const context = createTestContext();

let server: (req: IncomingMessage, res: ServerResponse<IncomingMessage>) => void;

beforeAll(async () => {
    server = await createApiServiceRequestListener(context, {
        edgeServiceUrl: "https://test.alpine.inc",
    });
});

test("not found route", async () => {
    const response = await request(server)
        .get("/asdf")
        .expect("content-type", "application/json")
        .expect(404);

    expect(response.body).toEqual({error: {message: "Path not found."}});
});

test("redirects favicon request", async () => {
    {
        await request(server)
            .get("/favicon.ico")
            .expect("location", "https://test.alpine.inc/favicon.ico")
            .expect(301);
    }

    {
        await request(server)
            .get("/favicon.svg")
            .expect("location", "https://test.alpine.inc/favicon.svg")
            .expect(301);
    }
});

test("ping works", async () => {
    const response = await request(server)
        .get("/ping")
        .expect("content-type", "application/json")
        .expect(200);

    expect(response.body).toEqual({pong: true});
});

test("can’t use unsupported method", async () => {
    {
        const response = await request(server)
            .post("/ping")
            .expect("content-type", "application/json")
            .expect(405);

        expect(response.body).toEqual({
            error: {message: "`POST` method isn’t supported, try `GET`."},
        });
    }

    {
        const response = await request(server)
            .put("/ping")
            .expect("content-type", "application/json")
            .expect(405);

        expect(response.body).toEqual({
            error: {message: "`PUT` method isn’t supported, try `GET`."},
        });
    }

    {
        const response = await request(server)
            .patch("/ping")
            .expect("content-type", "application/json")
            .expect(405);

        expect(response.body).toEqual({
            error: {message: "`PATCH` method isn’t supported, try `GET`."},
        });
    }
});

test("hello works", async () => {
    {
        const response = await request(server)
            .get("/hello/world")
            .expect("content-type", "application/json")
            .expect(200);

        expect(response.body).toEqual({message: "Hello, world!"});
    }

    {
        const response = await request(server)
            .get("/hello/Caleb")
            .expect("content-type", "application/json")
            .expect(200);

        expect(response.body).toEqual({message: "Hello, Caleb!"});
    }

    {
        const response = await request(server)
            .get("/hello/")
            .expect("content-type", "application/json")
            .expect(200);

        expect(response.body).toEqual({message: "Hello, !"});
    }
});

test("validates response with schema in tests", async () => {
    const response = await request(server)
        .get("/hello/test-additional-property")
        .expect("content-type", "application/json")
        .expect(500);

    expect(response.body).toEqual({
        error: {
            message:
                "An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc",
            stack: expect.stringMatching(
                /^InternalError: Response schema validation failed: must NOT have additional properties\n/,
            ),
        },
    });
});

test("path param that doesn’t match pattern", async () => {
    const response = await request(server)
        .get("/documents/abc")
        .expect("content-type", "application/json")
        .expect(400);

    expect(response.body).toEqual({error: {message: "Invalid `id` path parameter."}});
});

test("responds with pretty HTML if asked", async () => {
    const response = await request(server)
        .get("/ping")
        .set("accept", "text/html")
        .expect("content-type", "text/html")
        .expect(200);

    /* eslint-disable string-quotes */

    expect(response.text).toContain(`\
<span class="tok-punctuation">{</span>
  <span class="tok-propertyName">&quot;pong&quot;</span>: <span class="tok-bool">true</span>
<span class="tok-punctuation">}</span>`);

    /* eslint-enable string-quotes */
});
