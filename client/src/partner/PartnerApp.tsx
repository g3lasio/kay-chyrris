/**
 * Partner Portal — root app for partners.chyrris.com.
 * Fully separate visual identity (LeadPrime, light) from the Kai admin.
 */
import { Route, Switch, Redirect } from "wouter";
import { useEffect } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "@/components/ErrorBoundary";
import PartnerLogin from "./pages/PartnerLogin";
import PartnerDashboard from "./pages/PartnerDashboard";
import PartnerDocuments from "./pages/PartnerDocuments";
import PartnerInvitations from "./pages/PartnerInvitations";
import PartnerProtectedRoute from "./PartnerProtectedRoute";
import "./partner.css";

export default function PartnerApp() {
  useEffect(() => {
    // The admin theme may have left the dark class on <html>.
    document.documentElement.classList.remove("dark");
    document.title = "Portal de Socios · LeadPrime";
    let favicon = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!favicon) {
      favicon = document.createElement("link");
      favicon.rel = "icon";
      document.head.appendChild(favicon);
    }
    favicon.type = "image/png";
    favicon.href = "/brand/favicon.png";
  }, []);

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <div className="partner-portal">
          <Toaster position="top-center" richColors />
          <Switch>
            <Route path="/login">
              <PartnerLogin />
            </Route>
            <Route path="/">
              <PartnerProtectedRoute>
                <PartnerDashboard />
              </PartnerProtectedRoute>
            </Route>
            <Route path="/invitaciones">
              <PartnerProtectedRoute>
                <PartnerInvitations />
              </PartnerProtectedRoute>
            </Route>
            <Route path="/documentos">
              <PartnerProtectedRoute>
                <PartnerDocuments />
              </PartnerProtectedRoute>
            </Route>
            <Route>
              <Redirect to="/" />
            </Route>
          </Switch>
        </div>
      </TooltipProvider>
    </ErrorBoundary>
  );
}
