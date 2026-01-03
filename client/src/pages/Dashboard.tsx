import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, UserCheck, UserPlus, TrendingUp, Zap, Activity } from 'lucide-react';

export default function Dashboard() {
  const { data: statsData, isLoading } = trpc.owlfenc.getStats.useQuery();

  const stats = statsData?.success ? statsData.data : null;

  const metrics = [
    {
      title: 'Total Users',
      value: stats?.totalUsers || 0,
      icon: Users,
      description: 'All registered users',
      gradient: 'from-cyan-500 to-blue-500',
    },
    {
      title: 'Active Users',
      value: stats?.activeUsers || 0,
      icon: UserCheck,
      description: 'Active in last 30 days',
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      title: 'New This Month',
      value: stats?.newUsersThisMonth || 0,
      icon: UserPlus,
      description: 'New signups this month',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      title: 'Growth Rate',
      value: stats?.totalUsers 
        ? `${((stats.newUsersThisMonth / stats.totalUsers) * 100).toFixed(1)}%`
        : '0%',
      icon: TrendingUp,
      description: 'Monthly growth',
      gradient: 'from-orange-500 to-red-500',
    },
  ];

  const planStats = stats?.usersByPlan || {};
  const planData = [
    { 
      name: 'Free (Primo Chambeador)', 
      count: planStats['free'] || 0, 
      gradient: 'from-slate-500 to-slate-600',
      percentage: stats?.totalUsers ? ((planStats['free'] || 0) / stats.totalUsers * 100).toFixed(0) : 0
    },
    { 
      name: 'Mero Patrón', 
      count: planStats['patron'] || 0, 
      gradient: 'from-indigo-500 to-purple-500',
      percentage: stats?.totalUsers ? ((planStats['patron'] || 0) / stats.totalUsers * 100).toFixed(0) : 0
    },
    { 
      name: 'Master Contractor', 
      count: planStats['master'] || 0, 
      gradient: 'from-purple-500 to-pink-500',
      percentage: stats?.totalUsers ? ((planStats['master'] || 0) / stats.totalUsers * 100).toFixed(0) : 0
    },
  ];

  return (
    <div className="space-y-8 p-6">
      {/* Header with futuristic styling */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-primary to-secondary">
            <Zap className="w-6 h-6 text-primary-foreground" />
          </div>
          <h1 className="text-4xl font-bold gradient-text">
            Owl Fenc Dashboard
          </h1>
        </div>
        <p className="text-muted-foreground text-lg flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary animate-pulse" />
          Real-time monitoring and management system
        </p>
      </div>

      {/* Metrics Grid with futuristic cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title} className="metric-card group">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-foreground/80">
                {metric.title}
              </CardTitle>
              <div className={`p-3 rounded-xl bg-gradient-to-br ${metric.gradient} shadow-lg group-hover:scale-110 transition-transform`}>
                <metric.icon className="h-5 w-5 text-white" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-10 w-24 bg-muted/50" />
              ) : (
                <>
                  <div className="text-3xl font-bold text-neon-cyan">
                    {metric.value}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    {metric.description}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users by Plan - Futuristic visualization */}
      <Card className="card-glow border-primary/20">
        <CardHeader>
          <CardTitle className="text-2xl gradient-text">
            Users by Subscription Plan
          </CardTitle>
          <CardDescription className="text-base">
            Distribution of users across different subscription tiers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full bg-muted/50" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {planData.map((plan) => (
                <div key={plan.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={`w-3 h-3 rounded-full bg-gradient-to-r ${plan.gradient} animate-pulse`} />
                      <span className="font-medium text-foreground">{plan.name}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      <span className="text-2xl font-bold text-neon-cyan">
                        {plan.count}
                      </span>
                      <span className="text-sm text-muted-foreground min-w-[3rem] text-right">
                        {plan.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="h-3 bg-muted/30 rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-gradient-to-r ${plan.gradient} transition-all duration-1000 ease-out`}
                      style={{ width: `${plan.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions - Coming soon */}
      <Card className="glass-effect border-secondary/20">
        <CardHeader>
          <CardTitle className="text-xl text-neon-purple">Quick Actions</CardTitle>
          <CardDescription>
            Frequently used management tools
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'Send Announcement', icon: '📢' },
              { label: 'View Payments', icon: '💳' },
              { label: 'System Health', icon: '🏥' },
              { label: 'Analytics', icon: '📊' },
            ].map((action) => (
              <button
                key={action.label}
                className="p-4 rounded-xl bg-card/50 border border-border hover:border-primary/50 transition-all hover:scale-105 group"
              >
                <div className="text-3xl mb-2 group-hover:scale-110 transition-transform">
                  {action.icon}
                </div>
                <div className="text-sm font-medium text-foreground/80">
                  {action.label}
                </div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
