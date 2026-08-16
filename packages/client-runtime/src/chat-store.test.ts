import { describe, expect, test } from "bun:test";

import { createChatStore, type ChatTraceEvent, type EventSourceLike } from "./chat-store.js";

class FakeEventSource implements EventSourceLike {
    onmessage: EventSourceLike["onmessage"] = null;
    onopen: EventSourceLike["onopen"] = null;
    onerror: EventSourceLike["onerror"] = null;
    readyState = 2;
    closed = false;

    close() {
        this.closed = true;
    }
}

describe("chat transport tracing", () => {
    test("correlates SSE, history, and a 200-empty POST without reading its body", async () => {
        const agentId = "11111111-2222-4333-8444-555555555555";
        const traceId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
        const traces: ChatTraceEvent[] = [];
        const requests: { url: string; init?: RequestInit }[] = [];
        let source: FakeEventSource | undefined;

        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createTraceId: () => traceId,
            onTrace: (event) => traces.push(event),
            createEventSource: (url) => {
                expect(url).toContain(`traceId=${traceId}`);
                source = new FakeEventSource();
                return source;
            },
            fetchFn: (async (input, init) => {
                const url = String(input);
                requests.push({ url, init });
                if (url.endsWith("/messages")) {
                    return Response.json([]);
                }
                return new Response(null, { status: 200 });
            }) as typeof fetch,
        });

        chat.attach(agentId);
        await new Promise((resolve) => setTimeout(resolve, 0));
        source?.onopen?.();
        source?.onmessage?.({
            data: JSON.stringify({ type: "session", agentId, threadId: agentId }),
        });
        await chat.send(agentId, "Hi");

        const post = requests.find((request) => request.init?.method === "POST");
        const history = requests.find((request) => request.url.endsWith("/messages"));
        expect(new Headers(post?.init?.headers).get("x-hyros-trace-id")).toBe(traceId);
        expect(new Headers(history?.init?.headers).get("x-hyros-trace-id")).toBe(traceId);
        expect(traces.map((event) => event.event)).toEqual([
            "sse.connect",
            "history.start",
            "history.response",
            "sse.open",
            "sse.event",
            "post.start",
            "post.response",
        ]);
        expect(traces.at(-1)).toMatchObject({ status: 200, ok: true });
        expect(traces.at(-1)?.detail).toContain("bodyUsed=false");
    });

    test("creates a new agent before opening its SSE and history transports", async () => {
        const operations: string[] = [];

        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createTraceId: () => "create-order-trace",
            createEventSource: () => {
                operations.push("sse");
                return new FakeEventSource();
            },
            fetchFn: (async (input, init) => {
                const url = String(input);
                if (init?.method === "POST") {
                    operations.push("post");
                    return new Response(null, { status: 200 });
                }
                if (url.endsWith("/messages")) {
                    operations.push("history");
                    return Response.json([]);
                }
                throw new Error(`unexpected request: ${url}`);
            }) as typeof fetch,
        });

        await chat.createAgent();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(operations).toEqual(["post", "sse", "history"]);
    });

    test("evicts a terminally failed SSE connection so attach can retry", () => {
        const agentId = "11111111-2222-4333-8444-666666666666";
        const sources: FakeEventSource[] = [];
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                const source = new FakeEventSource();
                sources.push(source);
                return source;
            },
            fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
        });

        chat.attach(agentId);
        sources[0]?.onerror?.(new Event("error"));
        chat.attach(agentId);

        expect(sources).toHaveLength(2);
        expect(sources[0]?.closed).toBe(true);
    });

    test("keeps canonical AI SDK message parts when loading history", async () => {
        const agentId = "11111111-2222-4333-8444-777777777777";
        const toolPart = {
            type: "tool-ask_user",
            toolCallId: "tool-1",
            state: "output-available",
            input: { question: "What tone?", options: [{ label: "Formal" }] },
            output: { content: "User answered: Formal", isError: false },
        };
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => new FakeEventSource(),
            fetchFn: (async () =>
                Response.json([
                    {
                        id: "message-1",
                        role: "assistant",
                        metadata: { createdAt: "2026-08-16T00:00:00.000Z" },
                        parts: [toolPart],
                    },
                ])) as unknown as typeof fetch,
        });

        chat.attach(agentId);
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(chat.store.getState().agents[agentId]?.messages[0]?.parts).toEqual([toolPart]);
    });

    test("preserves ask_user suggestions from SSE", () => {
        const agentId = "11111111-2222-4333-8444-888888888888";
        let source: FakeEventSource | undefined;
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                source = new FakeEventSource();
                return source;
            },
            fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
        });

        chat.attach(agentId);
        source?.onmessage?.({
            data: JSON.stringify({
                type: "ask_user",
                toolCallId: "tool-2",
                question: "Choose a tone",
                options: [
                    { label: "Formal", description: "Polished and strategic" },
                    { label: "Friendly" },
                ],
                selectionMode: "single_select",
            }),
        });

        expect(chat.store.getState().agents[agentId]?.pendingQuestion).toEqual({
            toolCallId: "tool-2",
            question: "Choose a tone",
            options: [
                { label: "Formal", description: "Polished and strategic" },
                { label: "Friendly" },
            ],
            selectionMode: "single_select",
        });
    });

    test("defers an optimistic selection attach until creation finishes", async () => {
        const agentId = "11111111-2222-4333-8444-999999999999";
        const operations: string[] = [];
        let finishPost: (() => void) | undefined;
        const postFinished = new Promise<void>((resolve) => {
            finishPost = resolve;
        });
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                operations.push("sse");
                return new FakeEventSource();
            },
            fetchFn: (async (input, init) => {
                if (init?.method === "POST") {
                    operations.push("post");
                    await postFinished;
                    return new Response(null, { status: 200 });
                }
                if (String(input).endsWith("/messages")) {
                    operations.push("history");
                    return Response.json([]);
                }
                throw new Error(`unexpected request: ${input}`);
            }) as typeof fetch,
        });

        const creating = chat.createAgent(undefined, agentId);
        chat.attach(agentId);
        expect(operations).toEqual(["post"]);

        finishPost?.();
        await creating;
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(operations).toEqual(["post", "sse", "history"]);
    });

    test("restores the pending question and running state when sending fails", async () => {
        const agentId = "11111111-2222-4333-8444-aaaaaaaaaaaa";
        let source: FakeEventSource | undefined;
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                source = new FakeEventSource();
                return source;
            },
            fetchFn: (async (input, init) => {
                if (init?.method === "POST") {
                    return Response.json({ error: "unauthorized" }, { status: 401 });
                }
                if (String(input).endsWith("/messages")) return Response.json([]);
                throw new Error(`unexpected request: ${input}`);
            }) as typeof fetch,
        });

        chat.attach(agentId);
        source?.onmessage?.({
            data: JSON.stringify({
                type: "ask_user",
                toolCallId: "tool-retry",
                question: "Choose a tone",
                options: [{ label: "Friendly" }],
                selectionMode: "single_select",
            }),
        });

        await expect(chat.send(agentId, "Friendly")).rejects.toThrow("POST /chat failed: 401");
        expect(chat.store.getState().agents[agentId]).toMatchObject({
            messages: [],
            pendingQuestion: {
                toolCallId: "tool-retry",
                question: "Choose a tone",
            },
            running: false,
        });
    });

    test("closes every authenticated stream and clears chat state", () => {
        const sources: FakeEventSource[] = [];
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                const source = new FakeEventSource();
                sources.push(source);
                return source;
            },
            fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
        });

        chat.attach("11111111-2222-4333-8444-bbbbbbbbbbbb");
        chat.attach("11111111-2222-4333-8444-cccccccccccc");
        chat.reset();

        expect(sources.every((source) => source.closed)).toBe(true);
        expect(chat.store.getState()).toEqual({ agents: {} });
    });

    test("does not reopen a stream when creation finishes after reset", async () => {
        const agentId = "11111111-2222-4333-8444-eeeeeeeeeeee";
        let finishPost: (() => void) | undefined;
        const postFinished = new Promise<void>((resolve) => {
            finishPost = resolve;
        });
        const sources: FakeEventSource[] = [];
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                const source = new FakeEventSource();
                sources.push(source);
                return source;
            },
            fetchFn: (async (_input, init) => {
                if (init?.method === "POST") {
                    await postFinished;
                    return new Response(null, { status: 200 });
                }
                return Response.json([]);
            }) as typeof fetch,
        });

        const creating = chat.createAgent(undefined, agentId);
        chat.reset();
        finishPost?.();
        await creating;

        expect(sources).toHaveLength(0);
        expect(chat.store.getState()).toEqual({ agents: {} });
    });

    test("ignores malformed SSE events instead of corrupting state", () => {
        const agentId = "11111111-2222-4333-8444-dddddddddddd";
        let source: FakeEventSource | undefined;
        const chat = createChatStore({
            baseUrl: "http://gateway.test",
            createEventSource: () => {
                source = new FakeEventSource();
                return source;
            },
            fetchFn: (async () => Response.json([])) as unknown as typeof fetch,
        });

        chat.attach(agentId);
        source?.onmessage?.({
            data: JSON.stringify({ type: "ask_user", toolCallId: 42, question: null }),
        });

        expect(chat.store.getState().agents[agentId]?.pendingQuestion).toBeNull();
    });
});
