import "~/server/helpers/server-only.server";

import {assert} from "~/shared/helpers/control/assert";

type EnvVariables = {
    cookieSessionSecret: string;
    awsRegion: string;
    awsAccessKeyId: string;
    awsSecretAccessKey: string;
    ablyApiKey: string;
};

const getVariablesByEnvironment: {[key: string]: () => EnvVariables} = {
    development: () => ({
        cookieSessionSecret: "secret",
        awsRegion: "us-east-1",
        awsAccessKeyId: "localstack",
        awsSecretAccessKey: "localstack",
        ablyApiKey: "E-HfbA._EdWfA:EToxgwW3QaV0Qeh1ud0WcI_zvAdo-jdntc8bKFyI1fk",
    }),
    test: () => ({
        cookieSessionSecret: "secret",
        awsRegion: "us-east-1",
        awsAccessKeyId: "localstack",
        awsSecretAccessKey: "localstack",
        ablyApiKey: "ofAB3A.C-xo9A:CIlSda_FQtqwObYs4BxIM3Kqquy---PbhL9M9INP40I",
    }),
};

assert(process.env.NODE_ENV, "Expected `NODE_ENV` to be set");
const getVariables = getVariablesByEnvironment[process.env.NODE_ENV];
assert(getVariables, "Expected `NODE_ENV` to be set to a valid environment");

const variables = getVariables();

export const {cookieSessionSecret, awsRegion, awsAccessKeyId, awsSecretAccessKey, ablyApiKey} =
    variables;
