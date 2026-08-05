import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import MyApps from "./pages/MyApps";
import OwlFencDashboard from "./pages/OwlFencDashboard";
import Users from "./pages/Users";
import Payments from "./pages/Payments";
import Announcements from "./pages/Announcements";
import UsageSystem from "./pages/UsageSystem";
import AICreditsAdmin from './pages/AICreditsAdmin';
import PartnerCoupons from './pages/PartnerCoupons';
import DashboardLayout from "./components/DashboardLayout";
import OwlFencLayout from "./components/OwlFencLayout";
import LeadPrimeLayout from "./components/LeadPrimeLayout";
import LeadPrimeDashboard from "./pages/LeadPrimeDashboard";
import LeadPrimeUsersIntelligence from "./pages/LeadPrimeUsersIntelligence";
import SystemIssues from "./pages/SystemIssues";
import LeadPrimeSystemHealth from "./pages/LeadPrimeSystemHealth";
import LeadPrimeFinance from "./pages/LeadPrimeFinance";
import LeadPrimePendingSubscriptions from "./pages/LeadPrimePendingSubscriptions";
import LeadPrimePartners from "./pages/LeadPrimePartners";
import LeadPrimeApprovedClients from "./pages/LeadPrimeApprovedClients";
import PartnerApp from "./partner/PartnerApp";
import { isPartnerPortalHost } from "./partner/host";

function Router() {
  return (
    <Switch>
      {/* Login page */}
      <Route path="/login">
        <Login />
      </Route>
      
      {/* Main dashboard - redirect to My Apps */}
      <Route path="/">
        <Redirect to="/my-apps" />
      </Route>
      
      {/* My Apps - App selection page */}
      <Route path="/my-apps">
        <ProtectedRoute>
          <DashboardLayout>
            <MyApps />
          </DashboardLayout>
        </ProtectedRoute>
      </Route>
      
      {/* Owl Fenc App Routes */}
      <Route path="/owlfenc">
        <ProtectedRoute>
          <OwlFencLayout>
            <OwlFencDashboard />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/users">
        <ProtectedRoute>
          <OwlFencLayout>
            <Users />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/payments">
        <ProtectedRoute>
          <OwlFencLayout>
            <Payments />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/announcements">
        <ProtectedRoute>
          <OwlFencLayout>
            <Announcements />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/usage-system">
        <ProtectedRoute>
          <OwlFencLayout>
            <UsageSystem />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/ai-credits">
        <ProtectedRoute>
          <OwlFencLayout>
            <AICreditsAdmin />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      <Route path="/owlfenc/coupons">
        <ProtectedRoute>
          <OwlFencLayout>
            <PartnerCoupons />
          </OwlFencLayout>
        </ProtectedRoute>
      </Route>
      
      {/* LeadPrime App Routes */}
      <Route path="/apps/leadprime">
        <Redirect to="/leadprime" />
      </Route>

      <Route path="/leadprime">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeDashboard />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      {/* La página de Créditos se fusionó en Usuarios (pestañas Transacciones
          e Historial de créditos) — se mantiene la ruta como redirect. */}
      <Route path="/leadprime/credits">
        <Redirect to="/leadprime/users" />
      </Route>

      <Route path="/leadprime/users">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeUsersIntelligence />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/system-issues">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <SystemIssues />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/health">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeSystemHealth />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/billing-health">
        <Redirect to="/leadprime/health" />
      </Route>

      <Route path="/leadprime/finance">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeFinance />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/pending-subs">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimePendingSubscriptions />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/partners">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimePartners />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/leadprime/approved-clients">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeApprovedClients />
          </LeadPrimeLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // partners.chyrris.com → Partner Portal (LeadPrime branding, own auth).
  // Any other host → Kai admin, untouched. The server enforces the same
  // separation independently at the session/procedure level.
  if (isPartnerPortalHost()) {
    return <PartnerApp />;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
