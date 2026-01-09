import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {NonTransactionalEmailType} from "~/server/emails/email_type.js";
import {DataLossError} from "~/shared/error/error.js";
/* eslint-disable @typescript-eslint/no-unused-vars */
import {EmailAddress} from "~/shared/helpers/string/email_address.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * No-ops all email rendering and sending.
 * Only to be used outside of production when we don't actually care at all about emails.
 */
export class NoopEmailContextModule extends EmailContextModuleBase {
    public override async send(): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }

    public override async sendImmediately(): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }

    protected async _send(): Promise<void> {
        if (process.env.NODE_ENV === "production")
            throw new DataLossError("Can’t use `NoopEmailContextModule` in production");
    }

    public async getSignedUnsubscribeUrlForAppService({
        accountId,
        spaceId,
        emailType,
        baseUrl,
    }: {
        accountId: AccountId;
        spaceId: SpaceId;
        emailType: NonTransactionalEmailType;
        baseUrl: string;
    }): Promise<URL> {
        return this._serializeUnsubscribeUrl({accountId, spaceId, emailType, baseUrl});
    }

    protected async _verifySignedUnsubscribeUrl(_url: URL): Promise<void> {
        // No-op
    }

    public fork() {
        return new NoopEmailContextModule();
    }
}
