declare module "@vapi/server-sdk" {
    export interface VapiClientOptions {
        token: string;
        baseUrl?: string;
    }

    export interface AssistantResponse {
        id?: string;
        _id?: string;
        name?: string;
        assistant?: AssistantResponse;
        data?: AssistantResponse;
        assistants?: AssistantResponse[];
        items?: AssistantResponse[];
    }

    export interface AssistantListParams {
        name?: string;
        [key: string]: unknown;
    }

    export interface AssistantCreatePayload {
        [key: string]: unknown;
    }

    export interface AssistantUpdatePayload {
        [key: string]: unknown;
    }

    export interface AssistantsApi {
        create(payload: AssistantCreatePayload): Promise<unknown>;
        update(id: string, payload: AssistantUpdatePayload): Promise<unknown>;
        list(params?: AssistantListParams): Promise<unknown>;
    }

    export class VapiClient {
        constructor(options: VapiClientOptions);
        assistants: AssistantsApi;
    }

    export const Vapi: {
        assistants: AssistantsApi;
    };
}
