import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { DollarSign, TrendingUp, CreditCard, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';

export default function Payments() {
  const { data: mrrData, isLoading: mrrLoading } = trpc.stripe.getMRR.useQuery();
  const { data: subscriptionsData, isLoading: subsLoading } = trpc.stripe.getSubscriptions.useQuery();
  const { data: paymentsData, isLoading: paymentsLoading } = trpc.stripe.getPayments.useQuery();
  const { data: failedPaymentsData, isLoading: failedLoading } = trpc.stripe.getFailedPayments.useQuery();

  const mrr = mrrData?.data;
  const subscriptions = subscriptionsData?.data || [];
  const payments = paymentsData?.data || [];
  const failedPayments = failedPaymentsData?.data || [];

  const metrics = [
    {
      title: 'Monthly Recurring Revenue',
      value: mrr ? `$${mrr.currentMRR.toLocaleString()}` : '$0',
      icon: DollarSign,
      description: `${mrr?.activeSubscriptions || 0} active subscriptions`,
      gradient: 'from-green-500 to-emerald-500',
    },
    {
      title: 'MRR Growth',
      value: mrr ? `${mrr.growth.toFixed(1)}%` : '0%',
      icon: TrendingUp,
      description: 'vs. previous period',
      gradient: 'from-blue-500 to-cyan-500',
    },
    {
      title: 'Total Payments',
      value: payments.length,
      icon: CreditCard,
      description: 'All time transactions',
      gradient: 'from-purple-500 to-pink-500',
    },
    {
      title: 'Failed Payments',
      value: failedPayments.length,
      icon: AlertTriangle,
      description: 'Requires attention',
      gradient: 'from-red-500 to-orange-500',
    },
  ];

  const getStatusBadge = (status: string) => {
    const statusConfig: Record<string, { variant: 'default' | 'secondary' | 'destructive' | 'outline', icon: any }> = {
      active: { variant: 'default', icon: CheckCircle2 },
      succeeded: { variant: 'default', icon: CheckCircle2 },
      failed: { variant: 'destructive', icon: XCircle },
      canceled: { variant: 'secondary', icon: XCircle },
      incomplete: { variant: 'outline', icon: AlertTriangle },
    };

    const config = statusConfig[status] || { variant: 'outline' as const, icon: AlertTriangle };
    const Icon = config.icon;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <Icon className="w-3 h-3" />
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-gradient-to-br from-green-500 to-emerald-500">
            <DollarSign className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-4xl font-bold gradient-text">
            Payments & Subscriptions
          </h1>
        </div>
        <p className="text-muted-foreground text-lg">
          Stripe integration for financial monitoring and management
        </p>
      </div>

      {/* Metrics Grid */}
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
              {mrrLoading ? (
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

      {/* Failed Payments Alert */}
      {failedPayments.length > 0 && (
        <Card className="border-red-500/50 bg-red-950/20">
          <CardHeader>
            <CardTitle className="text-red-400 flex items-center gap-2">
              <AlertTriangle className="w-5 h-5" />
              Failed Payments Requiring Attention
            </CardTitle>
            <CardDescription>
              {failedPayments.length} payment{failedPayments.length > 1 ? 's' : ''} failed and require follow-up
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {failedPayments.slice(0, 5).map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg bg-card/50 border border-red-500/30">
                  <div className="space-y-1">
                    <p className="font-medium text-foreground">
                      ${(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Customer: {payment.customer}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    {getStatusBadge(payment.status)}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(payment.created, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Subscriptions */}
      <Card className="card-glow border-primary/20">
        <CardHeader>
          <CardTitle className="text-2xl gradient-text">Active Subscriptions</CardTitle>
          <CardDescription className="text-base">
            Current active recurring subscriptions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {subsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-20 w-full bg-muted/50" />
              ))}
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No active subscriptions found
            </div>
          ) : (
            <div className="space-y-3">
              {subscriptions.slice(0, 10).map((sub) => (
                <div key={sub.id} className="flex items-center justify-between p-4 rounded-lg bg-card/50 border border-border hover:border-primary/30 transition-all">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <p className="font-medium text-foreground">
                        ${(sub.plan.amount / 100).toFixed(2)} / {sub.plan.interval}
                      </p>
                      {getStatusBadge(sub.status)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Customer: {sub.customer}
                    </p>
                  </div>
                  <div className="text-right space-y-1">
                    <p className="text-sm font-medium text-foreground">
                      Renews {formatDistanceToNow(sub.currentPeriodEnd, { addSuffix: true })}
                    </p>
                    {sub.cancelAtPeriodEnd && (
                      <Badge variant="outline" className="text-yellow-500 border-yellow-500/50">
                        Canceling
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Payments */}
      <Card className="glass-effect border-secondary/20">
        <CardHeader>
          <CardTitle className="text-2xl text-neon-purple">Recent Payments</CardTitle>
          <CardDescription className="text-base">
            Latest payment transactions
          </CardDescription>
        </CardHeader>
        <CardContent>
          {paymentsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-16 w-full bg-muted/50" />
              ))}
            </div>
          ) : payments.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              No payments found
            </div>
          ) : (
            <div className="space-y-2">
              {payments.slice(0, 15).map((payment) => (
                <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg bg-card/30 border border-border/50 hover:bg-card/50 transition-all">
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-gradient-to-br from-green-500/20 to-emerald-500/20">
                      <CreditCard className="w-4 h-4 text-green-400" />
                    </div>
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">
                        ${(payment.amount / 100).toFixed(2)} {payment.currency.toUpperCase()}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {payment.description || 'Payment'}
                      </p>
                    </div>
                  </div>
                  <div className="text-right space-y-1">
                    {getStatusBadge(payment.status)}
                    <p className="text-xs text-muted-foreground">
                      {formatDistanceToNow(payment.created, { addSuffix: true })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
