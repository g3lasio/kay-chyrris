import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import { 
  Users, 
  FileText, 
  DollarSign, 
  Activity, 
  Megaphone,
  TrendingUp,
  ArrowLeft
} from "lucide-react";

export default function OwlFencDashboard() {
  const [, setLocation] = useLocation();
  const { data: dashboardStats, isLoading } = trpc.owlfenc.getDashboardStats.useQuery();

  const quickActions = [
    {
      title: "Manage Users",
      description: "View and manage all users",
      icon: Users,
      route: "/users",
      color: "from-blue-500 to-cyan-600"
    },
    {
      title: "Payments",
      description: "Track subscriptions & revenue",
      icon: DollarSign,
      route: "/payments",
      color: "from-green-500 to-emerald-600"
    },
    {
      title: "Usage System",
      description: "Monitor system usage metrics",
      icon: Activity,
      route: "/usage-system",
      color: "from-purple-500 to-pink-600"
    },
    {
      title: "Announcements",
      description: "Send notifications to users",
      icon: Megaphone,
      route: "/announcements",
      color: "from-orange-500 to-red-600"
    }
  ];

  return (
    <div className="container mx-auto py-8 px-4">
      {/* Header with back button */}
      <div className="mb-8">
        <Button
          variant="ghost"
          className="mb-4"
          onClick={() => setLocation("/my-apps")}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to My Apps
        </Button>
        <div className="flex items-center gap-4 mb-2">
          <div className="p-3 rounded-xl bg-gradient-to-br from-orange-500 to-amber-600 text-white">
            <FileText className="h-8 w-8" />
          </div>
          <div>
            <h1 className="text-4xl font-bold">Owl Fenc Dashboard</h1>
            <p className="text-muted-foreground">Construction Management Platform</p>
          </div>
        </div>
      </div>

      {/* Stats Overview */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">Total Users</p>
            <Users className="h-5 w-5 text-blue-500" />
          </div>
          <p className="text-3xl font-bold">
            {isLoading ? "..." : dashboardStats?.totalUsers || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">All registered users</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">Total Clients</p>
            <Users className="h-5 w-5 text-green-500" />
          </div>
          <p className="text-3xl font-bold">
            {isLoading ? "..." : dashboardStats?.totalClients || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Clients in database</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">Contracts</p>
            <FileText className="h-5 w-5 text-purple-500" />
          </div>
          <p className="text-3xl font-bold">
            {isLoading ? "..." : dashboardStats?.totalContracts || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Completed contracts</p>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-muted-foreground">Invoices</p>
            <DollarSign className="h-5 w-5 text-orange-500" />
          </div>
          <p className="text-3xl font-bold">
            {isLoading ? "..." : dashboardStats?.totalInvoices || 0}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Total invoices</p>
        </Card>
      </div>

      {/* Data Overview Chart */}
      <Card className="p-6 mb-8">
        <h2 className="text-xl font-bold mb-4">Data Overview</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Distribution of clients, contracts, and invoices in Owl Fenc
        </p>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Total Clients</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {dashboardStats?.totalClients || 0}
                </span>
                <span className="text-xs text-muted-foreground">100%</span>
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 w-full" />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Contracts</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {dashboardStats?.totalContracts || 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dashboardStats?.totalClients
                    ? Math.round(((dashboardStats?.totalContracts || 0) / dashboardStats.totalClients) * 100)
                    : 0}%
                </span>
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-emerald-500"
                style={{
                  width: dashboardStats?.totalClients
                    ? `${Math.min(((dashboardStats?.totalContracts || 0) / dashboardStats.totalClients) * 100, 100)}%`
                    : "0%"
                }}
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Invoices</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold">
                  {dashboardStats?.totalInvoices || 0}
                </span>
                <span className="text-xs text-muted-foreground">
                  {dashboardStats?.totalClients
                    ? Math.round(((dashboardStats?.totalInvoices || 0) / dashboardStats.totalClients) * 100)
                    : 0}%
                </span>
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-pink-500"
                style={{
                  width: dashboardStats?.totalClients
                    ? `${Math.min(((dashboardStats?.totalInvoices || 0) / dashboardStats.totalClients) * 100, 100)}%`
                    : "0%"
                }}
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Quick Actions */}
      <div>
        <h2 className="text-2xl font-bold mb-6">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Card
                key={action.route}
                className="group hover:shadow-lg transition-all duration-300 cursor-pointer overflow-hidden"
                onClick={() => setLocation(action.route)}
              >
                <div className={`h-1 bg-gradient-to-r ${action.color}`} />
                <div className="p-6">
                  <div className={`inline-flex p-3 rounded-lg bg-gradient-to-br ${action.color} text-white mb-4`}>
                    <Icon className="h-6 w-6" />
                  </div>
                  <h3 className="font-bold text-lg mb-2 group-hover:text-primary transition-colors">
                    {action.title}
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    {action.description}
                  </p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full group-hover:bg-primary/10"
                    onClick={(e) => {
                      e.stopPropagation();
                      setLocation(action.route);
                    }}
                  >
                    Open
                    <TrendingUp className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
