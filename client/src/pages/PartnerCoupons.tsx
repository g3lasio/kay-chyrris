import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Tag, Plus, Trash2, CheckCircle2, XCircle, Users, Percent, Calendar, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function PartnerCoupons() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    discountType: 'percent' as 'percent' | 'amount',
    percentOff: 15,
    amountOff: 0,
    duration: 'forever' as 'forever' | 'once' | 'repeating',
    durationInMonths: 3,
    maxRedemptions: '',
    redeemByDate: '',
    appliesTo: 'Master Contractor',
  });

  const { data: couponsData, isLoading, refetch } = trpc.stripe.getCoupons.useQuery();
  const createMutation = trpc.stripe.createCoupon.useMutation({
    onSuccess: () => {
      toast.success(`Partner code "${form.name}" is now active in Stripe.`);
      setIsCreateOpen(false);
      setForm({ name: '', discountType: 'percent', percentOff: 15, amountOff: 0, duration: 'forever', durationInMonths: 3, maxRedemptions: '', redeemByDate: '', appliesTo: 'Master Contractor' });
      refetch();
    },
    onError: (err) => {
      toast.error(`Error creating coupon: ${err.message}`);
    },
  });
  const deactivateMutation = trpc.stripe.deactivateCoupon.useMutation({
    onSuccess: () => {
      toast.success('The partner code has been removed from Stripe.');
      refetch();
    },
    onError: (err) => {
      toast.error(`Error deactivating coupon: ${err.message}`);
    },
  });

  const coupons = couponsData?.data || [];

  const handleCreate = () => {
    if (!form.name.trim()) {
      toast.error('Please enter a partner code name.');
      return;
    }
    const input: any = {
      name: form.name.trim().toUpperCase(),
      duration: form.duration,
      appliesTo: form.appliesTo,
    };
    if (form.discountType === 'percent') {
      input.percentOff = form.percentOff;
    } else {
      input.amountOff = Math.round(form.amountOff * 100); // convert to cents
      input.currency = 'usd';
    }
    if (form.duration === 'repeating') input.durationInMonths = form.durationInMonths;
    if (form.maxRedemptions) input.maxRedemptions = parseInt(form.maxRedemptions);
    if (form.redeemByDate) input.redeemBy = Math.floor(new Date(form.redeemByDate).getTime() / 1000);
    createMutation.mutate(input);
  };

  const getDurationLabel = (coupon: any) => {
    if (coupon.duration === 'forever') return 'Forever';
    if (coupon.duration === 'once') return 'One-time';
    if (coupon.duration === 'repeating') return `${coupon.durationInMonths} months`;
    return coupon.duration;
  };

  const getDiscountLabel = (coupon: any) => {
    if (coupon.percentOff) return `${coupon.percentOff}% off`;
    if (coupon.amountOff) return `$${(coupon.amountOff / 100).toFixed(2)} off`;
    return 'Unknown';
  };

  const totalRedemptions = coupons.reduce((sum, c) => sum + c.timesRedeemed, 0);
  const activeCoupons = coupons.filter((c) => c.valid).length;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-gradient-to-br from-orange-500 to-amber-500">
              <Tag className="w-6 h-6 text-white" />
            </div>
            <h1 className="text-4xl font-bold gradient-text">Partner Coupons</h1>
          </div>
          <p className="text-muted-foreground">
            Manage agency and partner discount codes. Codes are created directly in Stripe and apply automatically at checkout.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-orange-500 to-amber-500 text-white hover:opacity-90">
                <Plus className="w-4 h-4 mr-2" />
                New Partner Code
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[520px]">
              <DialogHeader>
                <DialogTitle>Create Partner Discount Code</DialogTitle>
                <DialogDescription>
                  The code name will be the partner's identifier (e.g. NEXLEAD). It will be created in Stripe and work automatically at checkout.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-1">
                  <Label>Partner Code Name</Label>
                  <Input
                    placeholder="e.g. NEXLEAD"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value.toUpperCase() })}
                    className="font-mono tracking-widest"
                  />
                  <p className="text-xs text-muted-foreground">Will be stored in uppercase. This is the code partners share with their clients.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Discount Type</Label>
                    <Select value={form.discountType} onValueChange={(v: any) => setForm({ ...form, discountType: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" className="z-[9999]">
                        <SelectItem value="percent">Percentage (%)</SelectItem>
                        <SelectItem value="amount">Fixed Amount ($)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label>{form.discountType === 'percent' ? 'Percent Off' : 'Amount Off ($)'}</Label>
                    {form.discountType === 'percent' ? (
                      <Input
                        type="number" min={1} max={100}
                        value={form.percentOff}
                        onChange={(e) => setForm({ ...form, percentOff: Number(e.target.value) })}
                      />
                    ) : (
                      <Input
                        type="number" min={1}
                        value={form.amountOff}
                        onChange={(e) => setForm({ ...form, amountOff: Number(e.target.value) })}
                      />
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Duration</Label>
                    <Select value={form.duration} onValueChange={(v: any) => setForm({ ...form, duration: v })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent position="popper" className="z-[9999]">
                        <SelectItem value="forever">Forever (every billing cycle)</SelectItem>
                        <SelectItem value="once">Once (first payment only)</SelectItem>
                        <SelectItem value="repeating">Repeating (X months)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {form.duration === 'repeating' && (
                    <div className="space-y-1">
                      <Label>Months</Label>
                      <Input
                        type="number" min={1}
                        value={form.durationInMonths}
                        onChange={(e) => setForm({ ...form, durationInMonths: Number(e.target.value) })}
                      />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label>Max Redemptions (optional)</Label>
                    <Input
                      type="number" min={1} placeholder="Unlimited"
                      value={form.maxRedemptions}
                      onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Expiry Date (optional)</Label>
                    <Input
                      type="date"
                      value={form.redeemByDate}
                      onChange={(e) => setForm({ ...form, redeemByDate: e.target.value })}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label>Applies To (Plan)</Label>
                  <Select value={form.appliesTo} onValueChange={(v) => setForm({ ...form, appliesTo: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent position="popper" className="z-[9999]">
                      <SelectItem value="Master Contractor">Master Contractor only</SelectItem>
                      <SelectItem value="Mero Patron">Mero Patrón only</SelectItem>
                      <SelectItem value="All Plans">All Plans</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Note: plan restriction is enforced by the backend, not by Stripe itself.</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                <Button
                  onClick={handleCreate}
                  disabled={createMutation.isPending}
                  className="bg-gradient-to-r from-orange-500 to-amber-500 text-white"
                >
                  {createMutation.isPending ? 'Creating...' : 'Create Partner Code'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          { label: 'Total Partner Codes', value: coupons.length, icon: Tag, gradient: 'from-orange-500 to-amber-500' },
          { label: 'Active Codes', value: activeCoupons, icon: CheckCircle2, gradient: 'from-green-500 to-emerald-500' },
          { label: 'Total Redemptions', value: totalRedemptions, icon: Users, gradient: 'from-blue-500 to-cyan-500' },
        ].map((metric) => (
          <Card key={metric.label} className="border-border/50">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className={`p-3 rounded-xl bg-gradient-to-br ${metric.gradient}`}>
                  <metric.icon className="w-5 h-5 text-white" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{metric.label}</p>
                  {isLoading ? <Skeleton className="h-8 w-12 mt-1" /> : (
                    <p className="text-3xl font-bold">{metric.value}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Coupons table */}
      <Card className="border-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="w-5 h-5" />
            Partner Codes
          </CardTitle>
          <CardDescription>
            All discount codes synced from Stripe. Codes are validated live — any code created here works at checkout immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : coupons.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Tag className="w-12 h-12 mx-auto mb-4 opacity-30" />
              <p className="text-lg font-medium">No partner codes yet</p>
              <p className="text-sm">Create your first partner discount code to get started.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {coupons.map((coupon) => (
                <div
                  key={coupon.id}
                  className="flex items-center justify-between p-4 rounded-xl border border-border/50 bg-card/50 hover:bg-card transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${coupon.valid ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                      {coupon.valid
                        ? <CheckCircle2 className="w-5 h-5 text-green-500" />
                        : <XCircle className="w-5 h-5 text-red-500" />
                      }
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-lg tracking-widest">{coupon.name}</span>
                        <Badge variant={coupon.valid ? 'default' : 'secondary'} className="text-xs">
                          {coupon.valid ? 'Active' : 'Inactive'}
                        </Badge>
                        {coupon.appliesTo && (
                          <Badge variant="outline" className="text-xs">
                            {coupon.appliesTo}
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Percent className="w-3 h-3" />
                          {getDiscountLabel(coupon)}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3" />
                          {getDurationLabel(coupon)}
                        </span>
                        <span>·</span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3 h-3" />
                          {coupon.timesRedeemed} used
                          {coupon.maxRedemptions ? ` / ${coupon.maxRedemptions} max` : ''}
                        </span>
                        <span>·</span>
                        <span>Created {format(new Date(coupon.created), 'MMM d, yyyy')}</span>
                      </div>
                    </div>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-red-500 hover:text-red-600 hover:bg-red-500/10"
                        disabled={!coupon.valid}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Deactivate partner code?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This will permanently delete <strong>{coupon.name}</strong> from Stripe. Existing subscribers who already applied this discount will keep their discount, but new users will no longer be able to use this code. This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => deactivateMutation.mutate({ couponId: coupon.id })}
                          className="bg-red-500 hover:bg-red-600 text-white"
                        >
                          Deactivate
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
