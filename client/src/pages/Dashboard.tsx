import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, UserCheck, UserPlus, TrendingUp, Zap, Users as UsersIcon, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function Dashboard() {
  const [, setLocation] = useLocation();
  
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
      title: 'Active Subscriptions',
      value: stats?.activeSubscriptions || 0,
      icon: UserCheck,
      description: 'Active paid subscriptions',
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
      {/* Simplified Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Owl Fenc Dashboard</h1>
          <p className="text-muted-foreground mt-1">Construction Management Platform</p>
        </div>
        <Button 
          onClick={() => setLocation('/users')}
          className="gap-2"
        >
          <UsersIcon className="w-4 h-4" />
          View All Users
          <ArrowRight className="w-4 h-4" />
        </Button>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title} className="hover:shadow-lg transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <div className={`p-2 rounded-lg bg-gradient-to-br ${metric.gradient}`}>
                <metric.icon className="h-4 w-4 text-white" />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold">
                    {metric.value}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {metric.description}
                  </p>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Users by Plan */}
      <Card>
        <CardHeader>
          <CardTitle>Users by Subscription Plan</CardTitle>
          <CardDescription>
            Distribution of users across different subscription tiers
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {planData.map((plan) => (
                <div key={plan.name} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{plan.name}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-xl font-bold">
                        {plan.count}
                      </span>
                      <span className="text-sm text-muted-foreground min-w-[3rem] text-right">
                        {plan.percentage}%
                      </span>
                    </div>
                  </div>
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={`h-full bg-gradient-to-r ${plan.gradient} transition-all duration-500`}
                      style={{ width: `${plan.percentage}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation('/users')}>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-cyan-500/10">
                <Users className="w-6 h-6 text-cyan-500" />
              </div>
              <div>
                <h3 className="font-semibold">Manage Users</h3>
                <p className="text-sm text-muted-foreground">View and manage all users</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation('/payments')}>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-green-500/10">
                <TrendingUp className="w-6 h-6 text-green-500" />
              </div>
              <div>
                <h3 className="font-semibold">Payments</h3>
                <p className="text-sm text-muted-foreground">Track subscriptions & revenue</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="cursor-pointer hover:shadow-lg transition-shadow" onClick={() => setLocation('/announcements')}>
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-purple-500/10">
                <Zap className="w-6 h-6 text-purple-500" />
              </div>
              <div>
                <h3 className="font-semibold">Announcements</h3>
                <p className="text-sm text-muted-foreground">Send notifications to users</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
