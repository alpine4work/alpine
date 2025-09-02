import {ApiSpecification} from "~/server/api/specification/types/api_specification_types.js";

export type ApiBotWebhookRequestBody =
    ApiSpecification.webhooks["bot"]["post"]["requestBody"]["content"]["application/json"];

export type ApiBotWebhookEvent = ApiBotWebhookRequestBody["event"];
