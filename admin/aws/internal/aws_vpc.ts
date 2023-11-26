import {Stack} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";

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

        // NOTE(calebmer, 2023-11-26): Used to have a secrets manager
        // `InterfaceVpcEndpoint` and a DynamoDB `GatewayVpcEndpoint` in here. But
        // turns out, they cost money. Let's only add endpoints if we need them.
    }
}
