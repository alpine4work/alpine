import {RemovalPolicy, Size} from "aws-cdk-lib";
import {
    CfnEIP,
    CfnEIPAssociation,
    CfnVolumeAttachment,
    EbsDeviceVolumeType,
    Instance,
    InstanceClass,
    InstanceSize,
    InstanceType,
    MachineImage,
    SecurityGroup,
    SubnetType,
    Volume,
} from "aws-cdk-lib/aws-ec2";
import {ManagedPolicy, Role, ServicePrincipal} from "aws-cdk-lib/aws-iam";
import {Construct} from "constructs";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";

/**
 * Single EC2 bastion in a **public** subnet for private access to VPC resources. A
 * **VPC Elastic IP** is associated with the instance so its public address stays
 * stable across stop/start. No inbound direct access allowed; use SSM Session
 * Manager to connect to the instance.
 *
 * A 20 GiB gp3 EBS volume is attached at `/dev/sdf` for extra local storage. The
 * volume is persistent across stop/start of the instance.
 *
 * !!! IMPORTANT:Be very careful with the permissions granted to the bastion host.
 * It lives in a public subnet and has outbound internet access. !!!
 */
export class AwsBastionHost extends Construct {
    private readonly _instance: Instance;
    private readonly _securityGroup: SecurityGroup;

    constructor(parentConstruct: Construct, vpc: AwsVpc) {
        super(parentConstruct, "BastionHost");

        const bastionHostSecurityGroup = new SecurityGroup(this, "InstanceSecurityGroup", {
            vpc,
            description:
                "CyberworldsStack/BastionHost, no inbound rules. Access via SSM Session Manager.",
            allowAllOutbound: true,
        });

        const bastionHostRole = new Role(this, "InstanceRole", {
            assumedBy: new ServicePrincipal("ec2.amazonaws.com"),
            description: "CyberworldsStack/BastionHost, SSM managed instance role.",
            managedPolicies: [
                ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"),
            ],
        });

        const instance = new Instance(this, "Instance", {
            vpc,
            vpcSubnets: {subnetType: SubnetType.PUBLIC},
            instanceType: InstanceType.of(InstanceClass.T3, InstanceSize.MICRO),
            machineImage: MachineImage.latestAmazonLinux2023(),
            securityGroup: bastionHostSecurityGroup,
            role: bastionHostRole,
            instanceName: "cyberworlds-bastion-host",
        });

        const elasticIp = new CfnEIP(this, "ElasticIp", {
            domain: "vpc",
            tags: [{key: "Name", value: "cyberworlds-bastion-host-elastic-ip"}],
        });

        new CfnEIPAssociation(this, "ElasticIpAssociation", {
            allocationId: elasticIp.attrAllocationId,
            instanceId: instance.instanceId,
        });

        const dataVolume = new Volume(this, "DataVolume", {
            availabilityZone: instance.instanceAvailabilityZone,
            size: Size.gibibytes(20),
            volumeType: EbsDeviceVolumeType.GP3,
            removalPolicy: RemovalPolicy.DESTROY,
        });

        new CfnVolumeAttachment(this, "DataVolumeAttachment", {
            instanceId: instance.instanceId,
            volumeId: dataVolume.volumeId,
            device: "/dev/sdf",
        });

        this._instance = instance;
        this._securityGroup = bastionHostSecurityGroup;
    }

    public get instance(): Instance {
        return this._instance;
    }

    public get securityGroup(): SecurityGroup {
        return this._securityGroup;
    }
}
