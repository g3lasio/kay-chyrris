import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ProtectedRoute } from "./components/ProtectedRoute";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MyApps from "./pages/MyApps";
import OwlFencDashboard from "./pages/OwlFencDashboard";
import Users from "./pages/Users";
import Payments from "./pages/Payments";
import Announcements from "./pages/Announcements";
import UsageSystem from "./pages/UsageSystem";
import DashboardLayout from "./components/DashboardLayout";
import OwlFencLayout from "./components/OwlFencLayout";

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
      
      {/* LeadPrime App Routes - Coming soon */}
      <Route path="/apps/leadprime">
        <ProtectedRoute>
          <DashboardLayout>
            <div className="container mx-auto py-8 px-4">
              <h1 className="text-4xl font-bold mb-4">LeadPrime</h1>
              <p className="text-muted-foreground">Coming soon...</p>
            </div>
          </DashboardLayout>
        </ProtectedRoute>
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
