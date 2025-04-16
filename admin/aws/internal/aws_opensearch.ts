/* eslint-disable no-commit-blockers */
// NOCOMMIT: Delete the above comment ^

import {CustomResource, Duration} from "aws-cdk-lib";
import {IConnectable, Port, SecurityGroup, SubnetType} from "aws-cdk-lib/aws-ec2";
import {Effect, IGrantable, IRole, PolicyStatement} from "aws-cdk-lib/aws-iam";
import {Code, Function as LambdaFunction, Runtime} from "aws-cdk-lib/aws-lambda";
import {RetentionDays} from "aws-cdk-lib/aws-logs";
import * as opensearchserverless from "aws-cdk-lib/aws-opensearchserverless";
import {Domain, EngineVersion} from "aws-cdk-lib/aws-opensearchservice";
import {Provider} from "aws-cdk-lib/custom-resources";
import {Construct} from "constructs";
import crypto from "crypto";
import {join as joinPath} from "path";
import {AwsVpc} from "~/admin/aws/internal/aws_vpc.js";
import {crawlOpensearchIndexes} from "~/admin/crawl/crawl.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {OpensearchServerlessCollectionType} from "~/server/opensearch/opensearch_index.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {convertKebabCaseToPascalCase} from "~/shared/helpers/string/convert_kebab_case_to_pascal_case.js";
import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.js";
import {quote} from "~/shared/helpers/string/quote.js";

const opensearchDeployScriptLambdaRelativePath =
    process.env.CDK_LITE === "true"
        ? "cyberworlds/admin/aws/empty_lambda"
        : "cyberworlds/admin/opensearch/deploy_script/deploy_script";

const opensearchDeployScriptLambdaPath = joinPath(
    runfilesPath,
    `${opensearchDeployScriptLambdaRelativePath}.zip`,
);

const opensearchDeployScriptLambdaHandler = `${opensearchDeployScriptLambdaRelativePath}.handler`;

function getSha256Hash(string: string): string {
    const hash = crypto.createHash("sha256");
    hash.update(string);
    return hash.digest("hex");
}

export class AwsOpensearch {
    private readonly _domain: Domain;

    private constructor(domain: Domain) {
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

        const vpcEndpointSecurityGroup = new SecurityGroup(construct, "VpcEndpointSecurityGroup", {
            vpc,
        });

        new opensearchserverless.CfnVpcEndpoint(construct, "VpcEndpoint", {
            name: "vpc",
            vpcId: vpc.vpcId,
            subnetIds: vpc.selectSubnets().subnetIds,
            securityGroupIds: [vpcEndpointSecurityGroup.securityGroupId],
        });

        const indexes = await crawlOpensearchIndexes();
        const indexesHash = getSha256Hash(JSON.stringify(indexes.map(index => index.config)));

        // OpenSearch deploy script:
        //
        // NOTE(calebmer): We doesn't use the [CloudFormation
        // `AWS::OpenSearchServerless::Index` resource][1] because that resource
        // provides very little mappings/settings configuration options. Instead we
        // have a custom CloudFormation resource that runs an AWS lambda deploy script.
        //
        // [1]: https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-resource-opensearchserverless-index.html
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
                environment: {
                    OPENSEARCH_SEARCH_SERVERLESS_COLLECTION_TYPE_ENDPOINT:
                        collectionByServerlessCollectionType.Search.collectionEndpoint,
                    OPENSEARCH_VECTOR_SEARCH_SERVERLESS_COLLECTION_TYPE_ENDPOINT:
                        collectionByServerlessCollectionType.VectorSearch.collectionEndpoint,
                },
                // Don't retain deploy script logs forever.
                logRetention: RetentionDays.ONE_MONTH,
            });

            vpcEndpointSecurityGroup.connections.allowFrom(deployScript, Port.tcp(443));

            const deployScriptProvider = new Provider(construct, "DeployScriptProvider", {
                onEventHandler: deployScript,
            });

            const deployScriptResource = new CustomResource(construct, "DeployScriptResource", {
                serviceToken: deployScriptProvider.serviceToken,
                properties: {
                    // Re-run our deploy script whenever the config for an OpenSearch index changes.
                    // The script should be idempotent so will not change any previously deployed
                    // OpenSearch indexes.
                    indexesHash,
                },
            });

            for (const collection of Object.values(collectionByServerlessCollectionType)) {
                const accessPolicy = collection.addDeployScriptAccessPolicy(
                    `DeployScript${convertKebabCaseToPascalCase(
                        collection.collectionName,
                    )}AccessPolicy`,
                    assertExists(deployScript.role),
                );

                // `accessPolicy` (and transitively, the collection the access policy is for)
                // must be created before the resource runs.
                deployScriptResource.node.addDependency(accessPolicy);
            }
        }

        return new AwsOpensearch(domain);
    }

    public get opensearchHost() {
        return this._domain.domainEndpoint;
    }

    public allowConnectionsFrom(other: IConnectable) {
        this._domain.connections.allowFrom(other, Port.tcp(443));
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

        const networkSecurityPolicy = new opensearchserverless.CfnSecurityPolicy(
            this,
            "NetworkSecurityPolicy",
            {
                name: `${name}-network`,
                type: "network",
                policy: JSON.stringify([
                    {
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
                    },
                ]),
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
        assert(3 <= this._collection.name.length && this._collection.name.length <= 32);
    }

    public get collectionName() {
        return this._collection.name;
    }

    public get collectionEndpoint() {
        return this._collection.attrCollectionEndpoint;
    }

    public addDeployScriptAccessPolicy(id: string, role: IRole) {
        const accessPolicy = new opensearchserverless.CfnAccessPolicy(this, id, {
            name: convertPascalCaseToKebabCase(
                id.endsWith("AccessPolicy") ? id.slice(0, -"AccessPolicy".length) : id,
            ),
            type: "data",
            policy: JSON.stringify([
                {
                    Description: quote`Access for ${role.roleName}`,
                    Principal: [role.roleArn],
                    Rules: [
                        {
                            ResourceType: "collection",
                            Resource: [`collection/${this._collection.name}`],
                            Permission: [
                                "aoss:CreateCollectionItems",
                                "aoss:DeleteCollectionItems",
                                "aoss:UpdateCollectionItems",
                                "aoss:DescribeCollectionItems",
                            ],
                        },
                        {
                            ResourceType: "index",
                            Resource: [`index/${this._collection.name}/*`],
                            Permission: [
                                "aoss:CreateIndex",
                                "aoss:DeleteIndex",
                                "aoss:UpdateIndex",
                                "aoss:DescribeIndex",
                                "aoss:ReadDocument",
                                "aoss:WriteDocument",
                            ],
                        },
                    ],
                },
            ]),
        });

        accessPolicy.addDependency(this._collection);

        assert(3 <= accessPolicy.name.length && accessPolicy.name.length <= 32);

        // It's not enough to add data access policies. We must also grant API access
        // through IAM or else the user will get 403 forbidden errors.
        //
        // > Being granted permissions within a data access policy is not sufficient to
        // > access data in your OpenSearch Serverless collection. An associated
        // > principal must also be granted access to the IAM permissions
        // > `aoss:APIAccessAll` and `aoss:DashboardsAccessAll`. Both permissions grant
        // > full access to collection resources, while the Dashboards permission also
        // > provides access to OpenSearch Dashboards. If a principal doesn't have both
        // > of these IAM permissions, they will receive 403 errors when attempting to
        // > send requests to the collection.
        //
        // ([Source][1])
        //
        // [1]: https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-data-access.html
        role.addToPrincipalPolicy(
            new PolicyStatement({
                effect: Effect.ALLOW,
                resources: [this._collection.attrArn],
                actions: ["aoss:APIAccessAll", "aoss:DashboardsAccessAll"],
            }),
        );

        return accessPolicy;
    }
}
