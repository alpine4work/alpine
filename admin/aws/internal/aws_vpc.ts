import {CfnOutput, Fn, Stack} from "aws-cdk-lib";
import {Vpc} from "aws-cdk-lib/aws-ec2";
import {Construct} from "constructs";
import {AwsBastionHost} from "~/admin/aws/internal/aws_bastion_host.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";

// NOTE(calebmer): This doesn't extend from `Construct` for historical reasons.
// Before we adopted the `Construct` sub-class convention (which is common among
// CDK code) we created a VPC directly in the stack. So now we can't move the VPC
// or else it's logical ID will change which destroys it.
//
// Extending `Vpc` is also nice since it lets us pass this object in anywhere a
// `Vpc` is needed.
export class AwsVpc extends Vpc {
    private readonly _bastionHost: AwsBastionHost;

    // NOTE(calebmer, 2023-11-26): Used to have a secrets manager
    // `InterfaceVpcEndpoint` and a DynamoDB `GatewayVpcEndpoint` in here. But turns
    // out, they cost money. Let's only add endpoints if we need them.
    constructor(parentConstruct: Construct) {
        super(parentConstruct, "Vpc", {
            // NAT gateways are expensive, don't run any. Right now our EC2 instances use the
            // public subnet. See why in comments on the VPC subnet selection.
            natGateways: 0,
        });

        this._bastionHost = new AwsBastionHost(parentConstruct, this);
    }

    public get bastionHost(): AwsBastionHost {
        return this._bastionHost;
    }

    public export() {
        assert(isIdentifier(this.stack.stackName));

        new CfnOutput(this, "IdExport", {
            value: this.vpcId,
            exportName: `${this.stack.stackName}:VpcId`,
        });

        this.publicSubnets.forEach((subnet, index) => {
            new CfnOutput(this, `PublicSubnet${index + 1}IdExport`, {
                value: subnet.subnetId,
                exportName: `${this.stack.stackName}:VpcPublicSubnet${index + 1}Id`,
            });

            new CfnOutput(this, `PublicSubnet${index + 1}RouteTableIdExport`, {
                value: subnet.routeTable.routeTableId,
                exportName: `${this.stack.stackName}:VpcPublicSubnet${index + 1}RouteTableId`,
            });
        });

        this.privateSubnets.forEach((subnet, index) => {
            new CfnOutput(this, `PrivateSubnet${index + 1}IdExport`, {
                value: subnet.subnetId,
                exportName: `${this.stack.stackName}:VpcPrivateSubnet${index + 1}Id`,
            });

            new CfnOutput(this, `PrivateSubnet${index + 1}RouteTableIdExport`, {
                value: subnet.routeTable.routeTableId,
                exportName: `${this.stack.stackName}:VpcPrivateSubnet${index + 1}RouteTableId`,
            });
        });

        this.isolatedSubnets.forEach((subnet, index) => {
            new CfnOutput(this, `IsolatedSubnet${index + 1}IdExport`, {
                value: subnet.subnetId,
                exportName: `${this.stack.stackName}:VpcIsolatedSubnet${index + 1}Id`,
            });

            new CfnOutput(this, `IsolatedSubnet${index + 1}RouteTableIdExport`, {
                value: subnet.routeTable.routeTableId,
                exportName: `${this.stack.stackName}:VpcIsolatedSubnet${index + 1}RouteTableId`,
            });
        });

        return (importStack: Stack): AwsVpc => {
            const vpcIdImport = Fn.importValue(`${this.stack.stackName}:VpcId`);

            const publicSubnetIdImports = createArrayWithLength(this.publicSubnets.length, index =>
                Fn.importValue(`${this.stack.stackName}:VpcPublicSubnet${index + 1}Id`),
            );

            const publicSubnetRouteTableIdImports = createArrayWithLength(
                this.publicSubnets.length,
                index =>
                    Fn.importValue(
                        `${this.stack.stackName}:VpcPublicSubnet${index + 1}RouteTableId`,
                    ),
            );

            const privateSubnetIdImports = createArrayWithLength(
                this.privateSubnets.length,
                index => Fn.importValue(`${this.stack.stackName}:VpcPrivateSubnet${index + 1}Id`),
            );

            const privateSubnetRouteTableIdImports = createArrayWithLength(
                this.privateSubnets.length,
                index =>
                    Fn.importValue(
                        `${this.stack.stackName}:VpcPrivateSubnet${index + 1}RouteTableId`,
                    ),
            );

            const isolatedSubnetIdImports = createArrayWithLength(
                this.isolatedSubnets.length,
                index => Fn.importValue(`${this.stack.stackName}:VpcIsolatedSubnet${index + 1}Id`),
            );

            const isolatedSubnetRouteTableIdImports = createArrayWithLength(
                this.isolatedSubnets.length,
                index =>
                    Fn.importValue(
                        `${this.stack.stackName}:VpcIsolatedSubnet${index + 1}RouteTableId`,
                    ),
            );

            const vpc = Vpc.fromVpcAttributes(importStack, "VpcImport", {
                vpcId: vpcIdImport,
                availabilityZones: this.availabilityZones,
                publicSubnetIds: publicSubnetIdImports,
                publicSubnetRouteTableIds: publicSubnetRouteTableIdImports,
                privateSubnetIds: privateSubnetIdImports,
                privateSubnetRouteTableIds: privateSubnetRouteTableIdImports,
                isolatedSubnetIds: isolatedSubnetIdImports,
                isolatedSubnetRouteTableIds: isolatedSubnetRouteTableIdImports,
            });

            assert(Object.getPrototypeOf(vpc) === Vpc.prototype);
            Object.setPrototypeOf(vpc, AwsVpc.prototype);
            return vpc as AwsVpc;
        };
    }
}
