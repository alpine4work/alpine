import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {
    ConfigurationSet,
    DkimIdentity,
    EmailIdentity,
    IEmailIdentity,
    Identity,
} from "aws-cdk-lib/aws-ses";
import {Construct} from "constructs";

export class AwsSes extends Construct {
    private readonly _alpineIdentity: IEmailIdentity;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "Ses");

        const configurationSet = new ConfigurationSet(this, "ConfigurationSet", {
            configurationSetName: "ProductionAlpine",
            reputationMetrics: true,
            sendingEnabled: true,
        });

        this._alpineIdentity = new EmailIdentity(this, "EmailIdentity", {
            identity: Identity.domain("alpine.inc"),
            mailFromDomain: "mail.alpine.inc",
            // We disable feedback emails since we have our reputation metrics sent to CloudWatch
            feedbackForwarding: false,
            configurationSet: configurationSet,
            dkimSigning: true,
            dkimIdentity: DkimIdentity.easyDkim(),
        });
    }

    public grantSendEmailFromAlpineIdentity(grantee: IGrantable) {
        grantee.grantPrincipal.addToPrincipalPolicy(
            new PolicyStatement({
                actions: ["ses:SendEmail"],
                resources: [this._alpineIdentity.emailIdentityArn],
            }),
        );
    }
}
