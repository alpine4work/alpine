import {Stack} from "aws-cdk-lib";
import {IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {
    ConfigurationSet,
    DkimIdentity,
    EmailIdentity,
    IConfigurationSet,
    IEmailIdentity,
    Identity,
} from "aws-cdk-lib/aws-ses";
import {Construct} from "constructs";

export class AwsSes extends Construct {
    private readonly _alpineIdentity: IEmailIdentity;
    private readonly _configurationSet: IConfigurationSet;

    constructor(parentConstruct: Construct) {
        super(parentConstruct, "Ses");

        this._configurationSet = new ConfigurationSet(this, "ConfigurationSet", {
            configurationSetName: "ProductionAlpine",
            reputationMetrics: true,
            sendingEnabled: true,
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
