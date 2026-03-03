import {IVpc, Peer, Port, SecurityGroup} from "aws-cdk-lib/aws-ec2";
import {
    ApplicationLoadBalancer,
    ApplicationLoadBalancerProps,
} from "aws-cdk-lib/aws-elasticloadbalancingv2";
import {Construct} from "constructs";
import {cloudflareIpV4s, cloudflareIpV6s} from "~/server/helpers/node/cloudflare_ips.js";

export interface AwsApplicationLoadBalancerFromCloudflareOptions extends ApplicationLoadBalancerProps {
    readonly vpc: IVpc;

    readonly loadBalancerName: string;

    readonly internetFacing: boolean;
}

/**
 * Application Load Balancer with a default security group that allows ingress from
 * Cloudflare over HTTPS.
 */
export class AwsApplicationLoadBalancerFromCloudflare extends Construct {
    private readonly _applicationLoadBalancer: ApplicationLoadBalancer;

    constructor(
        parentConstruct: Construct,
        id: string,
        options: AwsApplicationLoadBalancerFromCloudflareOptions,
    ) {
        super(parentConstruct, id);

        const securityGroup = new SecurityGroup(this, "SecurityGroup", {
            vpc: options.vpc,
            description: "Only allow from Cloudflare IPs",
            allowAllOutbound: true,
        });

        for (const cidr of cloudflareIpV4s) {
            securityGroup.addIngressRule(Peer.ipv4(cidr), Port.tcp(443), "HTTPS allowlist");
        }

        for (const cidr of cloudflareIpV6s) {
            securityGroup.addIngressRule(Peer.ipv6(cidr), Port.tcp(443), "HTTPS allowlist");
        }

        this._applicationLoadBalancer = new ApplicationLoadBalancer(this, "Alb", {
            ...options,
            securityGroup,
        });
    }

    public get applicationLoadBalancer(): ApplicationLoadBalancer {
        return this._applicationLoadBalancer;
    }
}
