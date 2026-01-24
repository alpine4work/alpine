import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.js";
import {EmailAddressSchema} from "~/shared/schema/helpers/email_address_schema.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * A maintenance job description is similar to `JobDescription` but not scoped
 * to a particular space. Generally prefer `JobDescription`s since permissions
 * are locked down to one space.
 *
 * You use a maintenance job to perform work like database cleanup.
 */
export type MaintenanceJobDescription = SchemaType<typeof MaintenanceJobDescriptionSchema>;

export const MaintenanceJobDescriptionSchema = Schema.union({
    /**
     * Attempts to start our deployment GitHub action. Only starts the deploy if
     * the right conditions are met. Namely it's during business hours and there's
     * not currently an active deploy.
     *
     * Idempotent. This job may be run many times and we'll only end up running one
     * deploy.
     *
     * If `commitSha` is null then if there's a deploy that's already been
     * scheduled we'll start it. But we won't schedule a new deploy. This message
     * must be sent to our job queue with `commitSha: null` if there's a previously
     * scheduled deploy we couldn't run for some reason (maybe there was an ongoing
     * deploy or we tried to deploy out of business hours) to run the scheduled
     * deploy. There's no other mechanism to run previously scheduled deploys.
     */
    ScheduleDeploy: Schema.object({
        type: Schema.value("ScheduleDeploy"),
        commitSha: Schema.string.nullable(),
    }),

    /**
     * This job is queued every few minutes so if we failed to process a
     * task action transaction it can be processed by the job.
     *
     * It's imperative that all task action transactions are processed in a timely
     * manner. Inconsistent data between our task DynamoDB table and OpenSearch
     * index leads to bugs, there's even a risk of security bugs! If an action that
     * updates an access policy is not processed.
     */
    RetryUnprocessedTaskActionTransactions: Schema.object({
        type: Schema.value("RetryUnprocessedTaskActionTransactions"),
    }),

    /**
     * Sends a pre-rendered email as a job using the email context module.
     */
    SendEmail: Schema.object({
        type: Schema.value("SendEmail"),
        fromEmailAddress: Schema.string,
        toEmailAddress: EmailAddressSchema,
        renderedEmail: Schema.object({
            templateName: Schema.string,
            html: Schema.string,
            title: Schema.string,
            plainText: Schema.string,
        }),
    }),

    EnqueueScheduledNotificationDigests: Schema.object({
        type: Schema.value("EnqueueScheduledNotificationDigests"),
    }),

    UpdateBotAccounts: Schema.object({
        type: Schema.value("UpdateBotAccounts"),
        botId: Schema.id<BotId>(),
        update: Schema.union({
            Name: Schema.object({
                type: Schema.value("Name"),
            }),
            Avatar: Schema.object({
                type: Schema.value("Avatar"),
            }),
        }),
    }),

    SendTryOnDesktopEmail: Schema.object({
        type: Schema.value("SendTryOnDesktopEmail"),
        accountId: Schema.id<AccountId>(),
        emailAddress: EmailAddressSchema,
        openSpaceId: Schema.id<SpaceId>().nullable(),
    }),

    SendAllPendingSubtleNotifications: Schema.object({
        type: Schema.value("SendAllPendingSubtleNotifications"),
    }),
});
