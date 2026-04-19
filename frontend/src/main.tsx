import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { GoogleOAuthProvider } from "@react-oauth/google";
import { router } from "./router";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

if (import.meta.env.DEV) {
  (globalThis as unknown as { __qc?: QueryClient }).__qc = queryClient;
}

const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "";
if (!googleClientId && import.meta.env.DEV) {
  console.warn(
    "[prodscope] VITE_GOOGLE_CLIENT_ID is not set. Google sign-in will be disabled. " +
      "See docs/SETUP_GOOGLE_OAUTH.md."
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <GoogleOAuthProvider clientId={googleClientId}>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </GoogleOAuthProvider>
  </StrictMode>
);
