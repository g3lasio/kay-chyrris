import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Users, UserCheck, UserPlus, TrendingUp } from 'lucide-react';

export default function Dashboard() {
  const { data: statsData, isLoading } = trpc.owlfenc.getStats.useQuery();

  const stats = statsData?.success ? statsData.data : null;

  const metrics = [
    {
      title: 'Total Users',
      value: stats?.totalUsers || 0,
      icon: Users,
      description: 'All registered users',
      color: 'text-blue-600 dark:text-blue-400',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
    },
    {
      title: 'Active Users',
      value: stats?.activeUsers || 0,
      icon: UserCheck,
      description: 'Active in last 30 days',
      color: 'text-green-600 dark:text-green-400',
      bgColor: 'bg-green-50 dark:bg-green-950',
    },
    {
      title: 'New This Month',
      value: stats?.newUsersThisMonth || 0,
      icon: UserPlus,
      description: 'New signups this month',
      color: 'text-purple-600 dark:text-purple-400',
      bgColor: 'bg-purple-50 dark:bg-purple-950',
    },
    {
      title: 'Growth Rate',
      value: stats?.totalUsers 
        ? `${((stats.newUsersThisMonth / stats.totalUsers) * 100).toFixed(1)}%`
        : '0%',
      icon: TrendingUp,
      description: 'Monthly growth',
      color: 'text-orange-600 dark:text-orange-400',
      bgColor: 'bg-orange-50 dark:bg-orange-950',
    },
  ];

  const planStats = stats?.usersByPlan || {};
  const planData = [
    { name: 'Free (Primo Chambeador)', count: planStats['free'] || 0, color: 'bg-slate-500' },
    { name: 'Mero Patrón', count: planStats['patron'] || 0, color: 'bg-indigo-500' },
    { name: 'Master Contractor', count: planStats['master'] || 0, color: 'bg-purple-500' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Owl Fenc Dashboard</h1>
        <p className="text-muted-foreground mt-2">
          Monitor and manage your Owl Fenc application users and metrics
        </p>
      </div>

      {/* Metrics Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {metric.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${metric.bgColor}`}>
                <metric.icon className={`h-4 w-4 ${metric.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <Skeleton className="h-8 w-20" />
              ) : (
                <>
                  <div className="text-2xl font-bold">{metric.value}</div>
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
        <CardContent>
          {isLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              {planData.map((plan) => (
                <div key={plan.name} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{plan.name}</span>
                    <span className="text-muted-foreground">
                      {plan.count} users
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${plan.color} transition-all duration-500`}
                      style={{
                        width: stats?.totalUsers
                          ? `${(plan.count / stats.totalUsers) * 100}%`
                          : '0%',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
          <CardDescription>
            Common administrative tasks
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <button className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors">
              <Users className="h-8 w-8 mb-2 text-muted-foreground" />
              <span className="text-sm font-medium">View All Users</span>
            </button>
            <button className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors">
              <TrendingUp className="h-8 w-8 mb-2 text-muted-foreground" />
              <span className="text-sm font-medium">View Analytics</span>
            </button>
            <button className="flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-lg hover:border-primary hover:bg-accent transition-colors">
              <UserPlus className="h-8 w-8 mb-2 text-muted-foreground" />
              <span className="text-sm font-medium">Send Notification</span>
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
