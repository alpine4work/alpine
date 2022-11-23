import {DynamoConditionExpression} from "~/server/dynamo/internal/dynamo_condition";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/internal/dynamo_key_attribute_schema";
import {DynamoTableSchema} from "~/server/dynamo/internal/dynamo_table_schema";
import {isDynamoConditionCheckError} from "~/server/dynamo/internal/is_dynamo_condition_check_error";
import {FailedPreconditionError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {LabelStringSchema} from "~/shared/schema/label_string_schema";
import {Schema} from "~/shared/schema/schema";

const AlphaAccessTable = DynamoTableSchema.new({
    name: "AlphaAccess",
    partitions: {
        AlphaAccessRequest: {
            partitionKeyAttributes: {
                /**
                 * Can only have one access request per email address.
                 */
                emailAddress: DynamoKeyAttributeSchema.labelString,
            },
            sortRanges: {
                Attributes: {
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        name: LabelStringSchema,
                        message: Schema.string,

                        /**
                         * The decision made by an admin account on whether to accept or reject the
                         * access request.
                         */
                        decision: Schema.union({
                            Approved: Schema.object({
                                type: Schema.value("Approved"),
                            }),
                            Denied: Schema.object({
                                type: Schema.value("Denied"),
                            }),
                        }).nullable(),
                    }),
                },
            },
        },
    },
});

/**
 * Sends a request for alpha access to the admin accounts managing alpha
 * access requests.
 *
 * Can not request alpha access twice for the same email address.
 */
export async function requestAlphaAccess({
    name,
    emailAddress,
    message,
}: {
    name: string;
    emailAddress: string;
    message: string;
}) {
    // Email address is case insensitive.
    emailAddress = emailAddress.toLowerCase();

    try {
        await AlphaAccessTable.putItem(
            {
                partitionType: "AlphaAccessRequest",
                sortRangeType: "Attributes",
                name,
                emailAddress,
                message,
                decision: null,
            },
            {
                condition: {name: DynamoConditionExpression.exists().not()},
            },
        );
    } catch (error) {
        if (!isDynamoConditionCheckError(error)) throw error;

        const existingRequest = await AlphaAccessTable.getItem({
            partitionType: "AlphaAccessRequest",
            sortRangeType: "Attributes",
            emailAddress,
        });
        const decision = existingRequest?.decision ?? null;

        let displayMessage;
        if (!decision) {
            displayMessage = errorDisplayMessage`Already requested access for the email address ${emailAddress}. You\u2019ll get an email to this address if your request is approved. Reach out to someone on our team if you\u2019d like to know the status of your request.`;
        } else {
            switch (decision.type) {
                case "Approved": {
                    displayMessage = errorDisplayMessage`You\u2019re already approved! Try ${errorDisplayMessage.link(
                        "signing in",
                        "/sign-in",
                    )} with the email address ${emailAddress}.`;
                    break;
                }
                case "Denied": {
                    displayMessage = errorDisplayMessage`Your access request for email address ${emailAddress} was denied by a member of our team. You may not submit another access request for this email address.`;
                    break;
                }
                default:
                    throw exhaustive(decision);
            }
        }

        throw new FailedPreconditionError("Already requested alpha access for this email address", {
            cause: error,
            displayMessage,
        });
    }
}
