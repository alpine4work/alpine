import {Stack} from "aws-cdk-lib";
import {
    InterfaceVpcEndpoint,
    InterfaceVpcEndpointAwsService,
    SubnetType,
    Vpc,
} from "aws-cdk-lib/aws-ec2";
import {AnyPrincipal, Effect, PolicyStatement} from "aws-cdk-lib/aws-iam";

// NOTE(calebmer): This doesn't extend from `Construct` for historical reasons.
// Before we adopted the `Construct` sub-class convention (which is common
// among CDK code) we created a VPC directly in the stack. So now we can't move
// the VPC or else it's logical ID will change which destroys it.
//
// Extending `Vpc` is also nice since it lets us pass this object in anywhere a
// `Vpc` is needed.
export class AwsVpc extends Vpc {
    constructor(parentConstruct: Stack) {
        super(parentConstruct, "Vpc", {
            // NAT gateways are expensive, don't run any. Right now our EC2 instances use
            // the public subnet. See why in comments on the VPC subnet selection.
            natGateways: 0,
        });

        const secretsManagerEndpoint = new InterfaceVpcEndpoint(this, "SecretsManagerEndpoint", {
            vpc: this,
            service: InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
            subnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
        });

        // Allow reading any secret value from this endpoint. Endpoint policies do not
        // override or replace identity-based policies or resource-base policies. They
        // are applied in addition to these policies.
        //
        // https://docs.aws.amazon.com/vpc/latest/privatelink/vpc-endpoints-access.html
        secretsManagerEndpoint.addToPolicy(
            new PolicyStatement({
                principals: [new AnyPrincipal()],
                effect: Effect.ALLOW,
                actions: ["secretsmanager:GetSecretValue"],
                resources: ["*"],
            }),
        );
    }
}
