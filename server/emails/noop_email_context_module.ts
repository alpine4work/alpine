import {EmailContextModuleBase} from "~/server/emails/email_context_module_base";
import {DataLossError} from "~/shared/error/error";

/**
 * Do nothing when sending an email. This is used in tests. Throws an error if
 * you try to use this context module in production to send an email.
 */
export class NoopEmailContextModule extends EmailContextModuleBase {
    protected async _send(): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError(
                "Can not use `NoopEmailContextModule` in production since user's won't get their emails",
            );
    }
}
