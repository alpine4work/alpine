import {SystemActorContextModule} from "~/server/dynamo/context/actor_context_module";
import {createTestContext} from "~/server/dynamo/test_helpers/shared/create_test_context";
import {createTestSession} from "~/server/dynamo/test_helpers/shared/create_test_session";
import {createTestSpace} from "~/server/dynamo/test_helpers/shared/create_test_space";
import {generateId} from "~/shared/id/id";

const context = createTestContext();
const space = createTestSpace(context);
const session = createTestSession(context, space);

test("can not escalate process context into system context", () => {
    expect(() => context.clone({actor: new SystemActorContextModule(generateId())})).toThrow();
});

test("can not escalate request context into system context", () => {
    expect(() =>
        context.action(session).clone({actor: new SystemActorContextModule(generateId())}),
    ).toThrow();
});
