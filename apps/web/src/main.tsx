import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { router } from "./router.js";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A 401 or a 403 is an answer, not a transient fault. Retrying either
      // wastes a round trip and delays the message the person needs.
      retry: (failureCount, error) => {
        const status = (error as { status?: number }).status;
        return status === 401 || status === 403 ? false : failureCount < 2;
      },
    },
  },
});

const container = document.getElementById("root");

if (!container) {
  throw new Error("No #root element in index.html");
}

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
