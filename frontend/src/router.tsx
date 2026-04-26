import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, useParams } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { AuthGuard } from "./features/auth/AuthGuard";

const LiveCrawlPage = lazy(() =>
  import("./features/crawl/LiveCrawlPage").then((m) => ({ default: m.LiveCrawlPage }))
);

function LazyLiveCrawl() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0A0A14]" />}>
      <LiveCrawlPage />
    </Suspense>
  );
}

function LegacyCrawlRedirect() {
  const { jobId } = useParams<{ jobId: string }>();
  return <Navigate to={`/run/${jobId ?? ""}`} replace />;
}

export const router = createBrowserRouter([
  {
    path: "/",
    lazy: () =>
      import("./features/marketing/HomePage").then((m) => ({
        Component: m.HomePage,
      })),
  },
  {
    path: "/login",
    lazy: () =>
      import("./features/auth/LoginPage").then((m) => ({
        Component: m.LoginPage,
      })),
  },
  {
    path: "/mockup",
    lazy: () =>
      import("./features/mockup/ThemePreview").then((m) => ({
        Component: m.ThemePreview,
      })),
  },
  {
    path: "/run/:jobId",
    element: (
      <AuthGuard>
        <LazyLiveCrawl />
      </AuthGuard>
    ),
  },
  {
    path: "/crawl/:jobId",
    element: <LegacyCrawlRedirect />,
  },
  {
    path: "/r/:jobId",
    lazy: () =>
      import("./features/report/PublicReportPage").then((m) => ({
        Component: m.PublicReportPage,
      })),
  },
  {
    path: "/apply",
    lazy: () =>
      import("./features/apply/ApplyPage").then((m) => ({
        Component: m.ApplyPage,
      })),
  },
  {
    path: "/pricing",
    lazy: () =>
      import("./features/pricing/PricingPage").then((m) => ({
        Component: m.PricingPage,
      })),
  },
  {
    // Phase D2: trust pages — methodology + FAQ. Public, unauthenticated.
    path: "/methodology",
    lazy: () =>
      import("./features/marketing/MethodologyPage").then((m) => ({
        Component: m.MethodologyPage,
      })),
  },
  {
    path: "/faq",
    lazy: () =>
      import("./features/marketing/FaqPage").then((m) => ({
        Component: m.FaqPage,
      })),
  },
  {
    // Phase D2: /sample is a stable marketing-friendly URL that resolves
    // to the existing public sample-report fixture (`/r/sample`). Lets us
    // share `prodscope.app/sample` in outreach without exposing the
    // share-link URL pattern.
    path: "/sample",
    element: <Navigate to="/r/sample" replace />,
  },
  {
    path: "/privacy",
    lazy: () =>
      import("./features/legal/PrivacyPage").then((m) => ({
        Component: m.PrivacyPage,
      })),
  },
  {
    path: "/terms",
    lazy: () =>
      import("./features/legal/TermsPage").then((m) => ({
        Component: m.TermsPage,
      })),
  },
  {
    path: "/admin/partners",
    lazy: () =>
      Promise.all([
        import("./features/admin/AdminGuard"),
        import("./features/admin/AdminPartnersPage"),
      ]).then(([guard, page]) => ({
        Component: () => (
          <guard.AdminGuard>
            <page.AdminPartnersPage />
          </guard.AdminGuard>
        ),
      })),
  },
  {
    element: (
      <AuthGuard>
        <AppShell />
      </AuthGuard>
    ),
    children: [
      {
        path: "dashboard",
        lazy: () =>
          import("./features/dashboard/DashboardPage").then((m) => ({
            Component: m.DashboardPage,
          })),
      },
      {
        path: "upload",
        lazy: () =>
          import("./features/upload/UploadPage").then((m) => ({
            Component: m.UploadPage,
          })),
      },
      {
        path: "report/:jobId",
        lazy: () =>
          import("./features/report/ReportPage").then((m) => ({
            Component: m.ReportPage,
          })),
      },
      {
        path: "app-map/:jobId",
        lazy: () =>
          import("./features/appmap/AppMapPage").then((m) => ({
            Component: m.AppMapPage,
          })),
      },
      {
        path: "history",
        lazy: () =>
          import("./features/history/HistoryPage").then((m) => ({
            Component: m.HistoryPage,
          })),
      },
      {
        path: "settings",
        lazy: () =>
          import("./features/settings/SettingsPage").then((m) => ({
            Component: m.SettingsPage,
          })),
      },
    ],
  },
]);
