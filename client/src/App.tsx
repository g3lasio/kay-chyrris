import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, Redirect } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import MyApps from "./pages/MyApps";
import OwlFencDashboard from "./pages/OwlFencDashboard";
import Users from "./pages/Users";
import Payments from "./pages/Payments";
import Announcements from "./pages/Announcements";
import UsageSystem from "./pages/UsageSystem";
import DashboardLayout from "./components/DashboardLayout";

function Router() {
  return (
    <Switch>
      {/* Redirect login to dashboard (auth disabled) */}
      <Route path="/login">
        <Redirect to="/" />
      </Route>
      
      {/* Main dashboard - redirect to My Apps */}
      <Route path="/">
        <Redirect to="/my-apps" />
      </Route>
      
      {/* My Apps - App selection page */}
      <Route path="/my-apps">
        <DashboardLayout>
          <MyApps />
        </DashboardLayout>
      </Route>
      
      {/* Owl Fenc App Routes */}
      <Route path="/apps/owlfenc">
        <DashboardLayout>
          <OwlFencDashboard />
        </DashboardLayout>
      </Route>
      
      <Route path="/users">
        <DashboardLayout>
          <Users />
        </DashboardLayout>
      </Route>
      
      <Route path="/payments">
        <DashboardLayout>
          <Payments />
        </DashboardLayout>
      </Route>
      
      <Route path="/announcements">
        <DashboardLayout>
          <Announcements />
        </DashboardLayout>
      </Route>
      
      <Route path="/usage-system">
        <DashboardLayout>
          <UsageSystem />
        </DashboardLayout>
      </Route>
      
      {/* LeadPrime App Routes - Coming soon */}
      <Route path="/apps/leadprime">
        <DashboardLayout>
          <div className="container mx-auto py-8 px-4">
            <h1 className="text-4xl font-bold mb-4">LeadPrime</h1>
            <p className="text-muted-foreground">Coming soon...</p>
          </div>
        </DashboardLayout>
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
