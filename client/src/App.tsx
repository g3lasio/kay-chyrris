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
import LeadPrimeCreditsAdmin from "./pages/LeadPrimeCreditsAdmin";
import LeadPrimeUsersIntelligence from "./pages/LeadPrimeUsersIntelligence";
import SystemIssues from "./pages/SystemIssues";
import LeadPrimeSystemHealth from "./pages/LeadPrimeSystemHealth";

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

      <Route path="/leadprime/credits">
        <ProtectedRoute>
          <LeadPrimeLayout>
            <LeadPrimeCreditsAdmin />
          </LeadPrimeLayout>
        </ProtectedRoute>
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

      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
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
