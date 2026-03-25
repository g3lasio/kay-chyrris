import { Wallet, Users, TrendingUp, ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';

export default function LeadPrimeDashboard() {
  const [, setLocation] = useLocation();
  const statsQuery = trpc.leadprime.getStats.useQuery();
  const stats = statsQuery.data?.data;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">LeadPrime Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Manage your LeadPrime CRM platform from here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/50 cursor-pointer hover:bg-card transition-colors" onClick={() => setLocation('/leadprime/credits')}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Wallet className="h-5 w-5 text-primary" />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{stats ? `$${(stats.totalBalanceCents / 100).toFixed(2)}` : '—'}</p>
            <p className="text-sm text-muted-foreground mt-1">Total Credits in Circulation</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 cursor-pointer hover:bg-card transition-colors" onClick={() => setLocation('/leadprime/credits')}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <Users className="h-5 w-5 text-green-400" />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{stats?.activeSubscribers ?? '—'}</p>
            <p className="text-sm text-muted-foreground mt-1">Active Subscribers</p>
          </CardContent>
        </Card>

        <Card className="bg-card/50 cursor-pointer hover:bg-card transition-colors" onClick={() => setLocation('/leadprime/credits')}>
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-3">
              <TrendingUp className="h-5 w-5 text-amber-400" />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>
            <p className="text-2xl font-bold">{stats ? `$${(stats.totalGrantedThisMonth / 100).toFixed(2)}` : '—'}</p>
            <p className="text-sm text-muted-foreground mt-1">Granted This Month</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-3">
        <Button onClick={() => setLocation('/leadprime/credits')} className="gap-2">
          <Wallet className="h-4 w-4" />
          Manage Credits
        </Button>
      </div>
    </div>
  );
}
