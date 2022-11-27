import {
    ProcessContext,
    RequestContext,
    UnauthenticatedRequestContext,
} from "~/server/context/context";
import {createAwsClientFromEnv} from "~/server/context/helpers/create_aws_client_from_env";
import {InternalError, UnimplementedError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";

let jestAfterEachPromises: Array<Promise<void>> = [];

if (typeof jest !== "undefined") {
    afterEach(async () => {
        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    });
}

export class TestProcessContext implements ProcessContext {
    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `TestServerContext`s to resolve.
     */
    public static async waitForTasks() {
        assert(typeof jest !== "undefined");

        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    }

    constructor() {
        if (typeof jest === "undefined")
            throw new InternalError("May only construct a test server context in Jest tests");
    }

    public readonly awsClient = createAwsClientFromEnv({});

    public waitUntil(promise: Promise<void>): void {
        jestAfterEachPromises.push(promise);
    }

    public request() {
        return new TestUnauthenticatedRequestContext();
    }
}

export class TestUnauthenticatedRequestContext
    extends TestProcessContext
    implements UnauthenticatedRequestContext
{
    public getClientIpAddress() {
        return null;
    }

    public getClientUserAgent() {
        return null;
    }

    public isAuthenticated(): Promise<boolean> {
        throw new UnimplementedError("Unimplemented");
    }

    public authenticate(): Promise<RequestContext> {
        throw new UnimplementedError("Unimplemented");
    }
}
