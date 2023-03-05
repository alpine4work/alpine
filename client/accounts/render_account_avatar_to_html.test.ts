import {renderAccountAvatarToHtml} from "~/client/accounts/render_account_avatar_to_html";
import {generateId} from "~/shared/id/id";
import {AccountModel} from "~/shared/models/account_model";

test("rendering an account avatar to HTML does not depend on any React context", () => {
    // Set global variables that we usually sniff to check whether we are in a test
    // environment to non-test values. So any context that doesn't require a
    // provider in tests but does in a real app will throw.
    const previousJest = globalThis.jest;
    const previousNodeEnv = process.env.NODE_ENV;
    (globalThis as any).jest = undefined;
    process.env.NODE_ENV = "production";
    try {
        renderAccountAvatarToHtml({
            account: new AccountModel({
                id: generateId(),
                name: "Test Account",
                createdTime: new Date(),
            }),
        });
    } finally {
        globalThis.jest = previousJest;
        process.env.NODE_ENV = previousNodeEnv;
    }
});
