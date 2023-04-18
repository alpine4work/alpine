import {DangerousSystemContextModule} from "~/server/dynamo/context/system_context_module";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {assert} from "~/shared/helpers/control/assert";

const context = createTestContext();
const space = createTestSpace(context);
const session1 = createTestSession(context, space);
const session2 = createTestSession(context, space);

test("can not escalate process context into system context", () => {
    expect(() => context.clone({system: new DangerousSystemContextModule()})).toThrow();
});

test("can not escalate request context into system context", () => {
    expect(() =>
        context.request(session1).clone({system: new DangerousSystemContextModule()}),
    ).toThrow();
});

test("can not impersonate account from process context", () => {
    expect(() =>
        (context.system as DangerousSystemContextModule).impersonateAccount(session2.accountId),
    ).toThrow();
});

test("can not impersonate account from request context", () => {
    expect(() =>
        (
            context.request(session1).system as any as DangerousSystemContextModule
        ).impersonateAccount(session2.accountId),
    ).toThrow();
});

test("can impersonate an account from system context", () => {
    context.systemContext.system.impersonateAccount(session2.accountId);
});

test("can not impersonate an account from an already impersonated context", () => {
    const requestContext = context.systemContext.system.impersonateAccount(session2.accountId);

    // @ts-expect-error: Even though `impersonateAccount` exists on the context
    // module, TypeScript should think it doesn't.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    requestContext.system.impersonateAccount;

    assert(requestContext.system instanceof DangerousSystemContextModule);
    const systemContextModule = requestContext.system;
    expect(() => systemContextModule.impersonateAccount(session2.accountId)).toThrow();
});
