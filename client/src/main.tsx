import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

/**
 * v261: 统一的fetch函数 — 确保所有trpc请求（包括batch和非batch）都携带Authorization头
 * 
 * 问题背景: httpBatchLink在某些情况下会发出非batch请求（如延迟加载的查询），
 * 这些请求虽然经过自定义fetch，但如果trpc内部在某些路径下绕过了batch机制，
 * 就可能导致认证失败（401）。通过在fetch层统一注入token，确保所有请求都能通过认证。
 */
const authenticatedFetch: typeof globalThis.fetch = (input, init) => {
  const token = localStorage.getItem('authToken');
  const headers = new Headers((init as any)?.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return globalThis.fetch(input, {
    ...(init ?? {}),
    credentials: "include",
    headers,
  });
};

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      fetch: authenticatedFetch,
      /**
       * v261: 增加maxURLLength限制
       * 当URL超过此长度时，httpBatchLink会将请求拆分为多个较小的batch
       * 这确保了即使拆分后的请求也会经过authenticatedFetch
       */
      maxURLLength: 2083,
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </trpc.Provider>
);
