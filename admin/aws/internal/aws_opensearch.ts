import {CfnOutput, CustomResource, Duration, Fn, Stack} from "aws-cdk-lib";
import {IConnectable, Port, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Effect, IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import {Domain, EngineVersion, IDomain} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";

const opensearchDeployScriptLambdaDirectoryPath = joinPath(
    runfilesPath,
    process.env.CDK_LITE === "true"
        ? "cyberworlds/admin/aws/empty_lambda"
        : "cyberworlds/admin/opensearch/deploy/deploy",
);

const opensearchDeployScriptLambdaIndexPath = joinPath(
    opensearchDeployScriptLambdaDirectoryPath,
    "index.cjs",
);

const opensearchDeployScriptLambdaIndexContents = await fs.readFile(
    opensearchDeployScriptLambdaIndexPath,
    "utf-8",
);

const opensearchDeployScriptLambdaIndexHash = crypto
    .createHash("sha256")
    .update(opensearchDeployScriptLambdaIndexContents)
    .digest("hex");

export class AwsOpensearch {
    protected readonly _domain: IDomain;

    protected constructor(domain: IDomain) {
        this._domain = domain;
    }

    public static new(parentConstruct: Construct, vpc: AwsVpc) {
        const construct = new Construct(parentConstruct, "Opensearch");

        const domain = new Domain(construct, "Domain", {
            vpc,
            // Only allow traffic to/from OpenSearch within our subnet.
            vpcSubnets: [{subnetType: SubnetType.PRIVATE_ISOLATED}],

            version: EngineVersion.OPENSEARCH_2_13,

            // Free tier OpenSearch instances. Should upgrade as we get real traffic.
            //
            // TODO(calebmer): Should also maybe add `masterNodes` when we upgrade
            // these nodes.
            capacity: {
                dataNodes: 2,
                dataNodeInstanceType: "t3.small.search",
            },
            zoneAwareness: {
                enabled: true,
                availabilityZoneCount: 2,
            },

            logging: {
                appLogEnabled: true,
                slowSearchLogEnabled: true,
                slowIndexLogEnabled: true,
            },
        });

        // NOTE(calebmer): We instantiate a `LambdaFunction` directly instead of using
        // `NodejsLambda` since we bundle the code ourselves.
        const deployScript = new LambdaFunction(construct, "DeployScript", {
            code: Code.fromAsset(opensearchDeployScriptLambdaDirectoryPath),
            handler: "index.handler",
            vpc,
            vpcSubnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
            timeout: Duration.seconds(60),
            // TODO(calebmer): Node.js v20 is not currently supported as an AWS lambda
            // runtime.
            // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
            runtime: Runtime.NODEJS_18_X,
            environment: {
                OPENSEARCH_HOST: domain.domainEndpoint,
            },
            // Don't retain deploy script logs forever.
            logRetention: RetentionDays.ONE_MONTH,
        });

        domain.connections.allowFrom(deployScript, Port.tcp(443));

        deployScript.addToRolePolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                actions: ["es:*"],
                resources: [`${domain.domainArn}/*`],
            }),
        );

        const deployScriptProvider = new Provider(construct, "DeployScriptProvider", {
            onEventHandler: deployScript,
        });

        const deployScriptResource = new CustomResource(construct, "DeployScriptResource", {
            serviceToken: deployScriptProvider.serviceToken,
            properties: {
                // Re-run our deploy script whenever the script file itself changes. This means
                // the script will run more often than it needs to, but that's fine the script
                // should be idempotent.
                //
                // We could instead build some other hash of index settings and mappings and
                // only re-run when that changes as an optimization.
                deployScriptLambdaIndexHash: opensearchDeployScriptLambdaIndexHash,
            },
        });

        // Run our deploy script whenever the OpenSearch domain is created/updated.
        deployScriptResource.node.addDependency(domain);

        return AwsOpensearchWithConnections._new(domain);
    }

    public get opensearchHost() {
        return this._domain.domainEndpoint;
    }

    public grantReadWriteData(grantee: IGrantable) {
        this._domain.grantIndexReadWrite("tasks", grantee);
        this._domain.grantIndexReadWrite("task_collections", grantee);
        this._domain.grantIndexReadWrite("search_entity_keywords", grantee);
        this._domain.grantIndexReadWrite("search_entity_semantics", grantee);

        // Allow bulk writing documents or bulk reading documents. This could allow you
        // to bulk read/write documents outside of the indexes specified above! Be
        // careful when adding indexes to this domain.
        this._domain.grantPathReadWrite("_bulk", grantee);
        this._domain.grantPathReadWrite("_mget", grantee);
    }

    public export() {
        new CfnOutput(this._domain.stack, "OpensearchArnExport", {
            value: this._domain.domainArn,
            exportName: `${this._domain.stack.stackName}:OpensearchArn`,
        });

        new CfnOutput(this._domain.stack, "OpensearchHostExport", {
            value: this._domain.domainEndpoint,
            exportName: `${this._domain.stack.stackName}:OpensearchHost`,
        });

        return (importStack: Stack) =>
            new AwsOpensearch(
                Domain.fromDomainAttributes(importStack, "OpensearchImport", {
                    domainArn: Fn.importValue(`${this._domain.stack.stackName}:OpensearchArn`),
                    domainEndpoint: Fn.importValue(
                        `${this._domain.stack.stackName}:OpensearchHost`,
                    ),
                }),
            );
    }
}

export class AwsOpensearchWithConnections extends AwsOpensearch {
    protected override readonly _domain: Domain;

    private constructor(domain: Domain) {
        super(domain);
        this._domain = domain;
    }

    public static _new(domain: Domain) {
        return new AwsOpensearchWithConnections(domain);
    }

    public allowConnectionsFrom(other: IConnectable) {
        this._domain.connections.allowFrom(other, Port.tcp(443));
    }
}
