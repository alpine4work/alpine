/* eslint-disable no-commit-blockers */
// NOCOMMIT: Delete the above comment ^

import {CfnOutput, CustomResource, Duration, Fn, Stack} from "aws-cdk-lib";
import {IConnectable, Port, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Effect, IGrantable, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import {Domain, EngineVersion, IDomain} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {crawlOpensearchIndexes} from "~/admin/crawl/crawl.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {
    OpensearchIndex,
    OpensearchServerlessCollectionType,
} from "~/server/opensearch/opensearch_index.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {convertSnakeCaseToPascalCase} from "~/shared/helpers/string/convert_snake_case_to_pascal_case.js";

const opensearchDeployScriptLambdaRelativePath =
    process.env.CDK_LITE === "true"
        ? "cyberworlds/admin/aws/empty_lambda"
        : "cyberworlds/admin/opensearch/deploy_script/deploy_script";

const opensearchDeployScriptLambdaPath = joinPath(
    runfilesPath,
    `${opensearchDeployScriptLambdaRelativePath}.zip`,
);

const opensearchDeployScriptLambdaHandler = `${opensearchDeployScriptLambdaRelativePath}.handler`;

const opensearchDeployScriptLambdaHash = await getFileSha256Hash(opensearchDeployScriptLambdaPath);

async function getFileSha256Hash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("sha256");
        const stream = fs.createReadStream(path);
        stream.on("error", reject);
        stream.on("data", chunk => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("hex")));
    });
}

export class AwsOpensearch {
    protected readonly _domain: IDomain;

    protected constructor(domain: IDomain) {
        this._domain = domain;
    }

    public static async new(parentConstruct: Construct, vpc: AwsVpc) {
        const construct = new Construct(parentConstruct, "Opensearch");

        // NOCOMMIT: Delete this???
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

        const collectionByServerlessCollectionType: Record<
            OpensearchServerlessCollectionType,
            AwsOpensearchServerlessCollection
        > = {
            Search: new AwsOpensearchServerlessCollection(construct, "SearchCollection", {
                name: "search",
                type: "SEARCH",
            }),
            VectorSearch: new AwsOpensearchServerlessCollection(
                construct,
                "VectorSearchCollection",
                {
                    name: "vector-search",
                    type: "VECTORSEARCH",
                },
            ),
        };

        for (const index of await crawlOpensearchIndexes()) {
            const collection = collectionByServerlessCollectionType[index.serverlessCollectionType];
            collection.addIndex(`${convertSnakeCaseToPascalCase(index.name)}Index`, index);
        }

        // OpenSearch deploy script:
        //
        // NOCOMMIT: Delete this
        {
            // NOTE(calebmer): We instantiate a `LambdaFunction` directly instead of using
            // `NodejsLambda` since we bundle the code ourselves.
            const deployScript = new LambdaFunction(construct, "DeployScript", {
                code: Code.fromAsset(opensearchDeployScriptLambdaPath),
                handler: opensearchDeployScriptLambdaHandler,
                vpc,
                vpcSubnets: {subnetType: SubnetType.PRIVATE_ISOLATED},
                timeout: Duration.seconds(60),
                // TODO(calebmer): Node.js v20 is not currently supported as an AWS lambda
                // runtime.
                // https://docs.aws.amazon.com/lambda/latest/dg/lambda-runtimes.html
                runtime: Runtime.NODEJS_18_X,
                environment: {OPENSEARCH_HOST: domain.domainEndpoint},
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
                    deployScriptLambdaIndexHash: opensearchDeployScriptLambdaHash,
                },
            });

            // Run our deploy script whenever the OpenSearch domain is created/updated.
            deployScriptResource.node.addDependency(domain);
        }

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

/**
 * There are [no official OpenSearch serverless L2 constructs][1]. This class
 * is our own L2 construct using the low-level L1 OpenSearch serverless
 * constructs. See the [AWS CloudFormation documentation for these
 * constructs][2].
 *
 * This class is based on examples in the GitHub repo
 * [`aws-samples/opensearch-serverless-common-usage-patterns`][3].
 *
 * [1]: https://docs.aws.amazon.com/cdk/api/v2/docs/aws-cdk-lib.aws_opensearchserverless-readme.html
 * [2]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-opensearchserverless-collection.html
 * [3]: https://github.com/aws-samples/opensearch-serverless-common-usage-patterns
 */
class AwsOpensearchServerlessCollection extends Construct {
    private readonly _collection: opensearchserverless.CfnCollection;

    constructor(
        parentConstruct: Construct,
        id: string,
        {name, type = "SEARCH"}: {name: string; type?: "SEARCH" | "VECTORSEARCH"},
    ) {
        super(parentConstruct, id);

        // NOCOMMIT: Make sure administrator group gets dashboard access. Do we need a
        // data access policy for this?
        const networkSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(
            this,
            "NetworkSecurityPolicy",
            {
                name: `${name}-network`,
                type: "network",
                policy: JSON.stringify({
                    // We allow collections to be accessed from the public internet (similar to how
                    // DynamoDB is accessible from the public internet). However, you still need
                    // appropriate IAM roles to access data within OpenSearch.
                    //
                    // Public internet access is convenient for OpenSearch dashboard access by
                    // system administrators when investigating a bug.
                    //
                    // https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-network.html
                    AllowFromPublic: true,
                    Rules: [
                        {ResourceType: "dashboard", Resource: [`collection/${name}`]},
                        {ResourceType: "collection", Resource: [`collection/${name}`]},
                    ],
                }),
            },
        );

        const encryptionSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(
            this,
            "EncryptionSecurityPolicy",
            {
                name: `${name}-encryption`,
                type: "encryption",
                policy: JSON.stringify({
                    AWSOwnedKey: true,
                    Rules: [
                        {
                            ResourceType: "collection",
                            Resource: [`collection/${name}`],
                        },
                    ],
                }),
            },
        );

        this._collection = new opensearchserverless.CfnCollection(this, "Collection", {
            name,
            type,
            standbyReplicas: "ENABLED",
        });

        this._collection.addDependency(networkSecurityPolicy);
        this._collection.addDependency(encryptionSecurityPolicy);

        // Make sure our names don't exceed the maximum length.
        assert(networkSecurityPolicy.name.length <= 32);
        assert(encryptionSecurityPolicy.name.length <= 32);
        assert(this._collection.name.length <= 32);
    }

    /**
     * Add an index to the OpenSearch collection.
     */
    public addIndex(id: string, index: OpensearchIndex<any, any, any, any, any>) {
        const actualIndex = new opensearchserverless.CfnIndex(this, id, {
            collectionEndpoint: this._collection.attrCollectionEndpoint,
            indexName: index.name,
            settings: index.config.settings,
            mappings: index.config.mappings,
        });

        actualIndex.addDependency(this._collection);
    }
}
