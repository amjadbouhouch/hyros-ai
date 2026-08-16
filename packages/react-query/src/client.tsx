import type { ReactNode } from "react";
import {
    QueryClient,
    QueryClientProvider,
    useQueryClient,
    type QueryClientConfig,
} from "@tanstack/react-query";

import { HyrosQueryHttpError } from "./transport.js";

export function createHyrosQueryClient(config: QueryClientConfig = {}): QueryClient {
    return new QueryClient({
        ...config,
        defaultOptions: {
            ...config.defaultOptions,
            queries: {
                staleTime: 30_000,
                gcTime: 10 * 60_000,
                refetchOnWindowFocus: true,
                retry: (failureCount, error) => {
                    if (error instanceof HyrosQueryHttpError && error.status < 500) return false;
                    return failureCount < 2;
                },
                ...config.defaultOptions?.queries,
            },
            mutations: {
                retry: false,
                ...config.defaultOptions?.mutations,
            },
        },
    });
}

export function HyrosQueryClientProvider({
    client,
    children,
}: {
    client: QueryClient;
    children: ReactNode;
}) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function useHyrosQueryClient(): QueryClient {
    return useQueryClient();
}
