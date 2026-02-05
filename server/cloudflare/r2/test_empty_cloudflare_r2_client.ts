import {CloudflareR2ClientBase} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {InternalError, NotFoundError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";

export class TestEmptyCloudflareR2Client implements CloudflareR2ClientBase {
    constructor() {
        // Only allowed to construct this in tests.
        assert(isTestNodeEnvOrAdminScenariosScript);
    }

    public isMiniflare(): boolean {
        return false;
    }

    public isEmptyForTest() {
        return true;
    }

    public GetObject(): Promise<never> {
        throw new NotFoundError("R2 object not found", {
            // Make sure `isCloudflareR2NoSuchKeyError()` returns true for this error.
            cause: {Code: "NoSuchKey"},
        });
    }

    public HeadObject(): Promise<never> {
        throw new NotFoundError("R2 object not found", {
            // Make sure `isCloudflareR2NoSuchKeyError()` returns true for this error.
            cause: {Code: "NoSuchKey"},
        });
    }

    public PutObject(): Promise<never> {
        throw new InternalError("Can\u2019t update R2 with empty test client");
    }

    public DeleteObject(): Promise<never> {
        throw new InternalError("Can\u2019t update R2 with empty test client");
    }

    public getGetObjectSignedUrl(): Promise<never> {
        throw new InternalError("Can\u2019t sign R2 URL with empty test client");
    }
}
