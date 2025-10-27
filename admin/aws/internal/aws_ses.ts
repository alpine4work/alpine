import {Stack} from "aws-cdk-lib";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {DeliveryStream, S3Bucket, StreamEncryption} from "aws-cdk-lib/aws-kinesisfirehose";
import {Bucket} from "aws-cdk-lib/aws-s3";
import {
    ConfigurationSet,
    DkimIdentity,
    EmailIdentity,
    EmailSendingEvent,
    EventDestination,
    IEmailIdentity,
    Identity,
} from "aws-cdk-lib/aws-ses";
import {Construct} from "constructs";

export class AwsSes extends Construct {
    private readonly _alpineIdentity: IEmailIdentity;
    private readonly _configurationSet: ConfigurationSet;

    constructor(parentConstruct: Construct, loggingBucket: Bucket) {
        super(parentConstruct, "Ses");

        this._configurationSet = new ConfigurationSet(this, "ConfigurationSet", {
            configurationSetName: "ProductionAlpine",
            reputationMetrics: true,
            sendingEnabled: true,
        });

        const kinesisFirehoseStream = new DeliveryStream(this, "KinesisFirehoseStream", {
            destination: new S3Bucket(loggingBucket, {
                dataOutputPrefix: "ses/email-events/",
            }),
            deliveryStreamName: "EmailEventsStream",
            encryption: StreamEncryption.awsOwnedKey(),
        });

        this._configurationSet.addEventDestination("ConfigurationSetEventDestination", {
            destination: EventDestination.firehoseDeliveryStream({
                deliveryStream: kinesisFirehoseStream,
            }),
            enabled: true,
            events: [
                EmailSendingEvent.SEND,
                EmailSendingEvent.BOUNCE,
                EmailSendingEvent.COMPLAINT,
                EmailSendingEvent.DELIVERY,
                EmailSendingEvent.REJECT,
                EmailSendingEvent.DELIVERY_DELAY,
                EmailSendingEvent.SUBSCRIPTION,
                EmailSendingEvent.RENDERING_FAILURE,
            ],
        });

        this._alpineIdentity = new EmailIdentity(this, "EmailIdentity", {
            identity: Identity.domain("alpine.inc"),
            mailFromDomain: "mail.alpine.inc",
            // We disable feedback emails since we have our reputation metrics sent to CloudWatch
            feedbackForwarding: false,
            configurationSet: this._configurationSet,
            dkimSigning: true,
            dkimIdentity: DkimIdentity.easyDkim(),
        });
    }

    public grantSendEmailFromAlpineIdentity(grantee: IGrantable) {
        const stack = Stack.of(this);
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: [
                    stack.formatArn({
                        service: "ses",
                        resource: "configuration-set",
                        resourceName: this._configurationSet.configurationSetName,
                    }),
                    this._alpineIdentity.emailIdentityArn,
                ],
            }),
        );
    }
}
