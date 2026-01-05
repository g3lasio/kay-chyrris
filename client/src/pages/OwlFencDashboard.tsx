import { trpc } from '../lib/trpc';
import { Card } from '../components/ui/card';
import { DollarSign, TrendingUp, Users, UserPlus, Activity, CreditCard } from 'lucide-react';
import { Line, Area } from 'recharts';
import { LineChart, AreaChart, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export default function OwlFencDashboard() {
  // Fetch revenue metrics
  const { data: revenueData, isLoading: revenueLoading } = trpc.owlfenc.getRevenueMetrics.useQuery();
  const revenueMetrics = revenueData?.data;

  // Fetch user growth metrics
  const { data: userGrowthData, isLoading: userGrowthLoading } = trpc.owlfenc.getUserGrowthMetrics.useQuery();
  const userGrowthMetrics = userGrowthData?.data;

  // Fetch revenue history for charts
  const { data: revenueHistoryData } = trpc.owlfenc.getRevenueHistory.useQuery();
  const revenueHistory = revenueHistoryData?.data || [];

  // Fetch user growth history for charts
  const { data: userHistoryData } = trpc.owlfenc.getUserGrowthHistory.useQuery();
  const userHistory = userHistoryData?.data || [];

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const formatMonth = (monthStr: string) => {
    const [year, month] = monthStr.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  };

  if (revenueLoading || userGrowthLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold gradient-text">Dashboard Overview</h1>
        <p className="text-muted-foreground mt-1">Revenue and user growth metrics</p>
      </div>

      {/* Revenue Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* MRR Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Monthly Recurring Revenue</p>
              <p className="text-3xl font-bold text-neon-cyan">
                {formatCurrency(revenueMetrics?.mrr || 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <TrendingUp className="inline h-3 w-3 mr-1" />
                Active subscriptions
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-cyan-500/10 flex items-center justify-center">
              <CreditCard className="h-6 w-6 text-cyan-500" />
            </div>
          </div>
        </Card>

        {/* Yearly Revenue Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Revenue This Year</p>
              <p className="text-3xl font-bold text-neon-purple">
                {formatCurrency(revenueMetrics?.yearlyRevenue || 0)}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <Activity className="inline h-3 w-3 mr-1" />
                {new Date().getFullYear()} total
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
              <DollarSign className="h-6 w-6 text-purple-500" />
            </div>
          </div>
        </Card>

        {/* Revenue Growth Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Revenue Growth</p>
              <p className={`text-3xl font-bold ${
                (revenueMetrics?.revenueGrowth || 0) >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {(revenueMetrics?.revenueGrowth || 0) >= 0 ? '+' : ''}
                {revenueMetrics?.revenueGrowth?.toFixed(1) || '0'}%
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <TrendingUp className="inline h-3 w-3 mr-1" />
                Month-over-month
              </p>
            </div>
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
              (revenueMetrics?.revenueGrowth || 0) >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              <TrendingUp className={`h-6 w-6 ${
                (revenueMetrics?.revenueGrowth || 0) >= 0 ? 'text-green-500' : 'text-red-500'
              }`} />
            </div>
          </div>
        </Card>
      </div>

      {/* User Growth Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Total Users Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">Total Users</p>
              <p className="text-3xl font-bold text-blue-400">
                {userGrowthMetrics?.totalUsers || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <Activity className="inline h-3 w-3 mr-1" />
                {userGrowthMetrics?.activeUsers || 0} active subscriptions
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-blue-500/10 flex items-center justify-center">
              <Users className="h-6 w-6 text-blue-500" />
            </div>
          </div>
        </Card>

        {/* New Users This Month Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">New Users This Month</p>
              <p className="text-3xl font-bold text-green-400">
                +{userGrowthMetrics?.newUsersThisMonth || 0}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <UserPlus className="inline h-3 w-3 mr-1" />
                {new Date().toLocaleDateString('en-US', { month: 'long' })}
              </p>
            </div>
            <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
              <UserPlus className="h-6 w-6 text-green-500" />
            </div>
          </div>
        </Card>

        {/* User Growth Card */}
        <Card className="p-6 metric-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">User Growth</p>
              <p className={`text-3xl font-bold ${
                (userGrowthMetrics?.userGrowth || 0) >= 0 ? 'text-green-500' : 'text-red-500'
              }`}>
                {(userGrowthMetrics?.userGrowth || 0) >= 0 ? '+' : ''}
                {userGrowthMetrics?.userGrowth?.toFixed(1) || '0'}%
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                <TrendingUp className="inline h-3 w-3 mr-1" />
                Month-over-month
              </p>
            </div>
            <div className={`h-12 w-12 rounded-full flex items-center justify-center ${
              (userGrowthMetrics?.userGrowth || 0) >= 0 ? 'bg-green-500/10' : 'bg-red-500/10'
            }`}>
              <TrendingUp className={`h-6 w-6 ${
                (userGrowthMetrics?.userGrowth || 0) >= 0 ? 'text-green-500' : 'text-red-500'
              }`} />
            </div>
          </div>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      <Card className="p-6 glass-effect">
        <h3 className="text-xl font-semibold mb-4 gradient-text">Revenue Trend (Last 12 Months)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={revenueHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0.01 240)" />
            <XAxis 
              dataKey="month" 
              tickFormatter={formatMonth}
              stroke="oklch(0.65 0.02 240)"
            />
            <YAxis 
              tickFormatter={(value) => `$${value}`}
              stroke="oklch(0.65 0.02 240)"
            />
            <Tooltip 
              formatter={(value: any) => formatCurrency(value)}
              labelFormatter={formatMonth}
              contentStyle={{
                backgroundColor: 'oklch(0.12 0.01 240)',
                border: '1px solid oklch(0.2 0.01 240)',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="revenue" 
              stroke="oklch(0.7 0.2 195)" 
              strokeWidth={3}
              dot={{ fill: 'oklch(0.7 0.2 195)', r: 4 }}
              activeDot={{ r: 6 }}
              name="Revenue"
            />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      {/* User Growth Chart */}
      <Card className="p-6 glass-effect">
        <h3 className="text-xl font-semibold mb-4 gradient-text">User Growth (Last 12 Months)</h3>
        <ResponsiveContainer width="100%" height={300}>
          <AreaChart data={userHistory}>
            <defs>
              <linearGradient id="colorUsers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="oklch(0.65 0.25 270)" stopOpacity={0.8}/>
                <stop offset="95%" stopColor="oklch(0.65 0.25 270)" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.2 0.01 240)" />
            <XAxis 
              dataKey="month" 
              tickFormatter={formatMonth}
              stroke="oklch(0.65 0.02 240)"
            />
            <YAxis stroke="oklch(0.65 0.02 240)" />
            <Tooltip 
              labelFormatter={formatMonth}
              contentStyle={{
                backgroundColor: 'oklch(0.12 0.01 240)',
                border: '1px solid oklch(0.2 0.01 240)',
                borderRadius: '8px',
              }}
            />
            <Legend />
            <Area 
              type="monotone" 
              dataKey="totalUsers" 
              stroke="oklch(0.65 0.25 270)" 
              fillOpacity={1} 
              fill="url(#colorUsers)"
              strokeWidth={2}
              name="Total Users"
            />
            <Area 
              type="monotone" 
              dataKey="newUsers" 
              stroke="oklch(0.7 0.2 195)" 
              fill="oklch(0.7 0.2 195 / 0.2)"
              strokeWidth={2}
              name="New Users"
            />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
    </div>
  );
}
