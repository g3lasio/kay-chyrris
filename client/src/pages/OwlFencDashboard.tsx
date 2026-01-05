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
  ArrowLeft,
  ArrowRight
} from "lucide-react";

export default function OwlFencDashboard() {
  const [, setLocation] = useLocation();
  const { data: dashboardStats, isLoading } = trpc.owlfenc.getStats.useQuery();

  const stats = dashboardStats?.data || {
    totalUsers: 0,
    totalClients: 0,
    totalContracts: 0,
    totalInvoices: 0
  };

  const quickActions = [
    {
      title: "Users",
      icon: Users,
      route: "/owlfenc/users",
      color: "from-blue-500 to-cyan-600",
      value: stats.totalUsers
    },
    {
      title: "Payments",
      icon: DollarSign,
      route: "/owlfenc/payments",
      color: "from-green-500 to-emerald-600",
      value: "MRR"
    },
    {
      title: "Usage",
      icon: Activity,
      route: "/owlfenc/usage-system",
      color: "from-purple-500 to-pink-600",
      value: "Metrics"
    },
    {
      title: "Announce",
      icon: Megaphone,
      route: "/owlfenc/announcements",
      color: "from-orange-500 to-red-600",
      value: "Send"
    }
  ];

  // Calculate percentages for radial progress
  const maxValue = Math.max(stats.totalClients, stats.totalContracts, stats.totalInvoices, 1);
  const clientsPercent = (stats.totalClients / maxValue) * 100;
  const contractsPercent = (stats.totalContracts / maxValue) * 100;
  const invoicesPercent = (stats.totalInvoices / maxValue) * 100;

  return (
    <div className="container mx-auto py-6 px-4 max-w-7xl">
      {/* Compact Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLocation("/my-apps")}
            className="hover:bg-orange-500/10"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-amber-600 text-white">
              <FileText className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Owl Fenc</h1>
              <p className="text-xs text-muted-foreground">Construction Management</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid Layout - No Scrolling */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Column: Key Metrics with Radial Progress */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Radial Progress Cards */}
          <div className="grid grid-cols-3 gap-4">
            {/* Clients */}
            <Card className="p-4 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 to-blue-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <Users className="h-4 w-4 text-cyan-500" />
                  <span className="text-xs text-muted-foreground">Clients</span>
                </div>
                
                {/* Radial Progress Circle */}
                <div className="relative w-20 h-20 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="none"
                      className="text-secondary"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="url(#gradientCyan)"
                      strokeWidth="6"
                      fill="none"
                      strokeDasharray={`${(clientsPercent / 100) * 201} 201`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                    <defs>
                      <linearGradient id="gradientCyan" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#06b6d4" />
                        <stop offset="100%" stopColor="#3b82f6" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">
                      {isLoading ? "..." : stats.totalClients}
                    </span>
                  </div>
                </div>
                
                <p className="text-center text-xs text-muted-foreground">
                  {Math.round(clientsPercent)}% of max
                </p>
              </div>
            </Card>

            {/* Contracts */}
            <Card className="p-4 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-green-500/10 to-emerald-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <FileText className="h-4 w-4 text-green-500" />
                  <span className="text-xs text-muted-foreground">Contracts</span>
                </div>
                
                <div className="relative w-20 h-20 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="none"
                      className="text-secondary"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="url(#gradientGreen)"
                      strokeWidth="6"
                      fill="none"
                      strokeDasharray={`${(contractsPercent / 100) * 201} 201`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                    <defs>
                      <linearGradient id="gradientGreen" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#10b981" />
                        <stop offset="100%" stopColor="#059669" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">
                      {isLoading ? "..." : stats.totalContracts}
                    </span>
                  </div>
                </div>
                
                <p className="text-center text-xs text-muted-foreground">
                  {Math.round(contractsPercent)}% of max
                </p>
              </div>
            </Card>

            {/* Invoices */}
            <Card className="p-4 relative overflow-hidden group hover:shadow-lg transition-all">
              <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              <div className="relative">
                <div className="flex items-center justify-between mb-3">
                  <DollarSign className="h-4 w-4 text-purple-500" />
                  <span className="text-xs text-muted-foreground">Invoices</span>
                </div>
                
                <div className="relative w-20 h-20 mx-auto mb-3">
                  <svg className="w-full h-full transform -rotate-90">
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="currentColor"
                      strokeWidth="6"
                      fill="none"
                      className="text-secondary"
                    />
                    <circle
                      cx="40"
                      cy="40"
                      r="32"
                      stroke="url(#gradientPurple)"
                      strokeWidth="6"
                      fill="none"
                      strokeDasharray={`${(invoicesPercent / 100) * 201} 201`}
                      strokeLinecap="round"
                      className="transition-all duration-1000"
                    />
                    <defs>
                      <linearGradient id="gradientPurple" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#a855f7" />
                        <stop offset="100%" stopColor="#ec4899" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-2xl font-bold">
                      {isLoading ? "..." : stats.totalInvoices}
                    </span>
                  </div>
                </div>
                
                <p className="text-center text-xs text-muted-foreground">
                  {Math.round(invoicesPercent)}% of max
                </p>
              </div>
            </Card>
          </div>

          {/* Data Comparison Chart */}
          <Card className="p-6">
            <h3 className="font-bold mb-4 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Data Distribution
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Clients</span>
                  <span className="font-bold text-cyan-500">{stats.totalClients}</span>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-1000"
                    style={{ width: `${clientsPercent}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Contracts</span>
                  <span className="font-bold text-green-500">{stats.totalContracts}</span>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-1000"
                    style={{ width: `${contractsPercent}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Invoices</span>
                  <span className="font-bold text-purple-500">{stats.totalInvoices}</span>
                </div>
                <div className="h-3 bg-secondary rounded-full overflow-hidden">
                  <div 
                    className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-1000"
                    style={{ width: `${invoicesPercent}%` }}
                  />
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Right Column: Quick Actions */}
        <div className="space-y-4">
          <h3 className="font-bold text-sm text-muted-foreground uppercase tracking-wide">Quick Access</h3>
          
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Card
                key={action.route}
                className="group hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden relative"
                onClick={() => setLocation(action.route)}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${action.color} opacity-0 group-hover:opacity-10 transition-opacity`} />
                <div className="p-4 flex items-center justify-between relative">
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg bg-gradient-to-br ${action.color} text-white`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div>
                      <h4 className="font-bold text-sm group-hover:text-primary transition-colors">
                        {action.title}
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        {typeof action.value === 'number' ? `${action.value} total` : action.value}
                      </p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>
              </Card>
            );
          })}

          {/* Total Users Summary Card */}
          <Card className="p-6 bg-gradient-to-br from-orange-500/10 to-amber-600/10 border-orange-500/20">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-muted-foreground">Total Users</span>
              <Users className="h-5 w-5 text-orange-500" />
            </div>
            <p className="text-4xl font-bold mb-1">
              {isLoading ? "..." : stats.totalUsers}
            </p>
            <p className="text-xs text-muted-foreground">
              Registered users in system
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
