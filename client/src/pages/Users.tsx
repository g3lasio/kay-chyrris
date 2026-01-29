import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Search, Eye, UserX, UserCheck, Trash2, Key, AlertTriangle } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';

export default function Users() {
  const [search, setSearch] = useState('');
  const [planFilter, setPlanFilter] = useState<string>('all');
  const [selectedUser, setSelectedUser] = useState<any>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    type: 'disable' | 'enable' | 'delete' | 'reset' | 'changeEmail';
    title: string;
    description: string;
  } | null>(null);
  const [showChangeEmailDialog, setShowChangeEmailDialog] = useState(false);
  const [newEmail, setNewEmail] = useState('');

  const utils = trpc.useUtils();

  const { data, isLoading } = trpc.owlfenc.getUsers.useQuery();
  const { data: subscriptionData } = trpc.owlfenc.getUserSubscription.useQuery(
    { firebaseUid: selectedUser?.uid || '' },
    { enabled: !!selectedUser }
  );

  // Mutations
  const disableUserMutation = trpc.owlfenc.disableUser.useMutation({
    onSuccess: () => {
      toast.success('User disabled successfully');
      utils.owlfenc.getUsers.invalidate();
      setShowConfirmDialog(false);
      setShowDetailModal(false);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const enableUserMutation = trpc.owlfenc.enableUser.useMutation({
    onSuccess: () => {
      toast.success('User enabled successfully');
      utils.owlfenc.getUsers.invalidate();
      setShowConfirmDialog(false);
      setShowDetailModal(false);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const deleteUserMutation = trpc.owlfenc.deleteUser.useMutation({
    onSuccess: () => {
      toast.success('User deleted permanently');
      utils.owlfenc.getUsers.invalidate();
      setShowConfirmDialog(false);
      setShowDetailModal(false);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const resetPasswordMutation = trpc.owlfenc.sendPasswordReset.useMutation({
    onSuccess: () => {
      toast.success('Password reset email sent');
      setShowConfirmDialog(false);
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  const updateEmailMutation = trpc.owlfenc.updateEmail.useMutation({
    onSuccess: () => {
      toast.success('Email updated successfully. User needs to verify new email.');
      utils.owlfenc.getUsers.invalidate();
      setShowChangeEmailDialog(false);
      setShowDetailModal(false);
      setNewEmail('');
    },
    onError: (error) => {
      toast.error(`Error: ${error.message}`);
    },
  });

  // Get ALL users from Firebase (no hardcoded filter)
  const allUsers = data?.success && data.data ? data.data : [];

  // Calculate plan statistics
  const planStats = {
    total: allUsers.length,
    free: allUsers.filter((u: any) => u.planName === 'Primo Chambeador').length,
    patron: allUsers.filter((u: any) => u.planName === 'Mero Patrón').length,
    master: allUsers.filter((u: any) => u.planName === 'Master Contractor').length,
  };

  // Client-side search and plan filtering
  const filteredUsers = allUsers.filter((user: any) => {
    // Search filter
    const matchesSearch = !search || 
      user.email?.toLowerCase().includes(search.toLowerCase()) ||
      user.displayName?.toLowerCase().includes(search.toLowerCase());
    
    // Plan filter
    const matchesPlan = planFilter === 'all' || user.planName === planFilter;
    
    return matchesSearch && matchesPlan;
  });

  const handleSearch = (value: string) => {
    setSearch(value);
  };

  const formatDate = (dateString: any) => {
    try {
      if (!dateString) return 'N/A';
      return format(new Date(dateString), 'MMM d, yyyy');
    } catch {
      return 'N/A';
    }
  };

  const handleViewUser = (user: any) => {
    setSelectedUser(user);
    setShowDetailModal(true);
  };

  const handleDisableUser = () => {
    if (!selectedUser) return;
    setConfirmAction({
      type: 'disable',
      title: 'Disable User Account',
      description: `Are you sure you want to disable ${selectedUser.email}? The user will not be able to log in.`,
    });
    setShowConfirmDialog(true);
  };

  const handleEnableUser = () => {
    if (!selectedUser) return;
    setConfirmAction({
      type: 'enable',
      title: 'Enable User Account',
      description: `Are you sure you want to enable ${selectedUser.email}? The user will be able to log in again.`,
    });
    setShowConfirmDialog(true);
  };

  const handleDeleteUser = () => {
    if (!selectedUser) return;
    setConfirmAction({
      type: 'delete',
      title: 'Delete User Account',
      description: `⚠️ WARNING: This will permanently delete ${selectedUser.email} and all their data. This action cannot be undone!`,
    });
    setShowConfirmDialog(true);
  };

  const handleResetPassword = () => {
    if (!selectedUser) return;
    setConfirmAction({
      type: 'reset',
      title: 'Send Password Reset',
      description: `Send a password reset email to ${selectedUser.email}?`,
    });
    setShowConfirmDialog(true);
  };

  const handleChangeEmail = () => {
    if (!selectedUser) return;
    setNewEmail(selectedUser.email || '');
    setShowChangeEmailDialog(true);
  };

  const executeChangeEmail = () => {
    if (!selectedUser || !newEmail) return;
    if (newEmail === selectedUser.email) {
      toast.error('New email must be different from current email');
      return;
    }
    updateEmailMutation.mutate({ uid: selectedUser.uid, newEmail });
  };

  const executeConfirmedAction = () => {
    if (!selectedUser || !confirmAction) return;

    switch (confirmAction.type) {
      case 'disable':
        disableUserMutation.mutate({ uid: selectedUser.uid });
        break;
      case 'enable':
        enableUserMutation.mutate({ uid: selectedUser.uid });
        break;
      case 'delete':
        deleteUserMutation.mutate({ uid: selectedUser.uid });
        break;
      case 'reset':
        resetPasswordMutation.mutate({ email: selectedUser.email });
        break;
    }
  };

  const getStatusBadge = (disabled: boolean) => {
    if (disabled) {
      return <Badge className="bg-red-500/20 text-red-400 border-red-500/30">Disabled</Badge>;
    }
    return <Badge className="bg-green-500/20 text-green-400 border-green-500/30">Active</Badge>;
  };

  const getPlanBadge = (planName: string) => {
    const colors: Record<string, string> = {
      'Free Trial': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
      'Primo Chambeador': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
      'Mero Patrón': 'bg-purple-500/20 text-purple-400 border-purple-500/30',
      'Master Contractor': 'bg-amber-500/20 text-amber-400 border-amber-500/30',
    };
    return <Badge className={colors[planName] || colors['Free Trial']}>{planName}</Badge>;
  };

  const subscription = subscriptionData?.success && subscriptionData.data ? subscriptionData.data.subscription : null;
  const usage = subscriptionData?.success && subscriptionData.data ? subscriptionData.data.usage : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white">Owl Fenc Users</h1>
        <p className="text-slate-400 mt-2">
          Manage all Owl Fenc users ({filteredUsers.length} total users)
        </p>
      </div>

      {/* Plan Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Total Users</CardDescription>
            <CardTitle className="text-3xl text-white">{planStats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Primo Chambeador</CardDescription>
            <CardTitle className="text-3xl text-blue-400">{planStats.free}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">Free Plan</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Mero Patrón</CardDescription>
            <CardTitle className="text-3xl text-purple-400">{planStats.patron}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">$49.99/month</p>
          </CardContent>
        </Card>
        <Card className="bg-slate-900/50 border-slate-800">
          <CardHeader className="pb-3">
            <CardDescription className="text-slate-400">Master Contractor</CardDescription>
            <CardTitle className="text-3xl text-amber-400">{planStats.master}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-slate-500">$99.99/month</p>
          </CardContent>
        </Card>
      </div>

      {/* Search and Filter */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">Search & Filter Users</CardTitle>
          <CardDescription className="text-slate-400">
            Search by name or email, and filter by subscription plan
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search users..."
                value={search}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-10 bg-slate-800/50 border-slate-700 text-white"
              />
            </div>
            <select
              value={planFilter}
              onChange={(e) => setPlanFilter(e.target.value)}
              className="px-4 py-2 bg-slate-800/50 border border-slate-700 rounded-md text-white focus:outline-none focus:ring-2 focus:ring-cyan-500"
            >
              <option value="all">All Plans</option>
              <option value="Primo Chambeador">Primo Chambeador (Free)</option>
              <option value="Mero Patrón">Mero Patrón ($49.99)</option>
              <option value="Master Contractor">Master Contractor ($99.99)</option>
            </select>
            <Button 
              variant="outline" 
              onClick={() => { handleSearch(''); setPlanFilter('all'); }} 
              className="border-slate-700 text-slate-300"
            >
              Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Users Table */}
      <Card className="bg-slate-900/50 border-slate-800">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-white">All Users</CardTitle>
              <CardDescription className="text-slate-400">
                {filteredUsers.length} users from Firebase Authentication
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-slate-800">
            <Table>
              <TableHeader>
                <TableRow className="border-slate-800 hover:bg-slate-800/50">
                  <TableHead className="text-slate-300">Name</TableHead>
                  <TableHead className="text-slate-300">Email</TableHead>
                  <TableHead className="text-slate-300">Plan</TableHead>
                  <TableHead className="text-slate-300">Status</TableHead>
                  <TableHead className="text-slate-300">Login Method</TableHead>
                  <TableHead className="text-slate-300">Joined</TableHead>
                  <TableHead className="text-slate-300">Last Active</TableHead>
                  <TableHead className="text-right text-slate-300">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i} className="border-slate-800">
                      <TableCell><Skeleton className="h-4 w-32 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-48 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-28 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-5 w-16 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-20 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24 bg-slate-800" /></TableCell>
                      <TableCell><Skeleton className="h-8 w-20 ml-auto bg-slate-800" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <TableRow className="border-slate-800">
                    <TableCell colSpan={8} className="text-center py-8 text-slate-400">
                      No users found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredUsers.map((user: any) => (
                    <TableRow key={user.uid} className="border-slate-800 hover:bg-slate-800/30">
                      <TableCell className="font-medium text-white">
                        {user.displayName || 'N/A'}
                      </TableCell>
                      <TableCell className="text-slate-300">{user.email || 'N/A'}</TableCell>
                      <TableCell>
                        {getPlanBadge(user.planName || 'Primo Chambeador')}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(user.disabled)}
                      </TableCell>
                      <TableCell className="capitalize text-slate-300">
                        {user.phoneNumber ? 'Phone' : 'Email'}
                      </TableCell>
                      <TableCell className="text-slate-300">{formatDate(user.createdAt)}</TableCell>
                      <TableCell className="text-slate-300">{formatDate(user.lastSignInTime)}</TableCell>
                      <TableCell className="text-right">
                        <Button 
                          variant="ghost" 
                          size="sm"
                          onClick={() => handleViewUser(user)}
                          className="text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10"
                        >
                          <Eye className="h-4 w-4 mr-1" />
                          View
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* User Detail Modal */}
      <Dialog open={showDetailModal} onOpenChange={setShowDetailModal}>
        <DialogContent className="max-w-3xl bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-2xl text-white">User Details</DialogTitle>
            <DialogDescription className="text-slate-400">
              Complete information and admin actions
            </DialogDescription>
          </DialogHeader>

          {selectedUser && (
            <div className="space-y-6">
              {/* User Info */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm text-slate-400">Name</label>
                  <p className="text-white font-medium">{selectedUser.displayName || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Email</label>
                  <p className="text-white font-medium">{selectedUser.email}</p>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Status</label>
                  <div className="mt-1">
                    {getStatusBadge(selectedUser.disabled)}
                  </div>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Phone</label>
                  <p className="text-white font-medium">{selectedUser.phoneNumber || 'N/A'}</p>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Joined</label>
                  <p className="text-white font-medium">{formatDate(selectedUser.createdAt)}</p>
                </div>
                <div>
                  <label className="text-sm text-slate-400">Last Active</label>
                  <p className="text-white font-medium">{formatDate(selectedUser.lastSignInTime)}</p>
                </div>
              </div>

              {/* Subscription Info */}
              {subscription && (
                <div className="border-t border-slate-800 pt-4">
                  <h3 className="text-lg font-semibold text-white mb-3">Subscription</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm text-slate-400">Plan</label>
                      <div className="mt-1">
                        {getPlanBadge(subscription.planName)}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm text-slate-400">Price</label>
                      <p className="text-white font-medium">
                        ${subscription.price.toFixed(2)}/month
                      </p>
                    </div>
                    <div>
                      <label className="text-sm text-slate-400">Status</label>
                      <p className="text-white font-medium capitalize">{subscription.status}</p>
                    </div>
                    <div>
                      <label className="text-sm text-slate-400">Renewal Date</label>
                      <p className="text-white font-medium">
                        {subscription.currentPeriodEnd ? formatDate(subscription.currentPeriodEnd) : 'N/A'}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Usage Limits */}
              {usage && (
                <div className="border-t border-slate-800 pt-4">
                  <h3 className="text-lg font-semibold text-white mb-3">Usage & Limits</h3>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Basic Estimates</span>
                        <span className="text-white">
                          {usage.basicEstimatesUsed} / {usage.basicEstimatesLimit === -1 ? '∞' : usage.basicEstimatesLimit}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-cyan-500"
                          style={{ 
                            width: usage.basicEstimatesLimit === -1 
                              ? '0%' 
                              : `${Math.min((usage.basicEstimatesUsed / usage.basicEstimatesLimit) * 100, 100)}%` 
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">AI Estimates</span>
                        <span className="text-white">
                          {usage.aiEstimatesUsed} / {usage.aiEstimatesLimit === -1 ? '∞' : usage.aiEstimatesLimit}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-purple-500"
                          style={{ 
                            width: usage.aiEstimatesLimit === -1 
                              ? '0%' 
                              : `${Math.min((usage.aiEstimatesUsed / usage.aiEstimatesLimit) * 100, 100)}%` 
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Contracts</span>
                        <span className="text-white">
                          {usage.contractsUsed} / {usage.contractsLimit === -1 ? '∞' : usage.contractsLimit}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-green-500"
                          style={{ 
                            width: usage.contractsLimit === -1 
                              ? '0%' 
                              : `${Math.min((usage.contractsUsed / usage.contractsLimit) * 100, 100)}%` 
                          }}
                        />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-slate-400">Projects</span>
                        <span className="text-white">
                          {usage.projectsUsed} / {usage.projectsLimit === -1 ? '∞' : usage.projectsLimit}
                        </span>
                      </div>
                      <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-amber-500"
                          style={{ 
                            width: usage.projectsLimit === -1 
                              ? '0%' 
                              : `${Math.min((usage.projectsUsed / usage.projectsLimit) * 100, 100)}%` 
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Admin Actions */}
              <div className="border-t border-slate-800 pt-4">
                <h3 className="text-lg font-semibold text-white mb-3">Admin Actions</h3>
                <div className="grid grid-cols-2 gap-3">
                  {selectedUser.disabled ? (
                    <Button
                      onClick={handleEnableUser}
                      className="bg-green-600 hover:bg-green-700 text-white"
                    >
                      <UserCheck className="h-4 w-4 mr-2" />
                      Enable User
                    </Button>
                  ) : (
                    <Button
                      onClick={handleDisableUser}
                      variant="outline"
                      className="border-orange-500/30 text-orange-400 hover:bg-orange-500/10"
                    >
                      <UserX className="h-4 w-4 mr-2" />
                      Disable User
                    </Button>
                  )}
                  <Button
                    onClick={handleResetPassword}
                    variant="outline"
                    className="border-blue-500/30 text-blue-400 hover:bg-blue-500/10"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Reset Password
                  </Button>
                  <Button
                    onClick={handleChangeEmail}
                    variant="outline"
                    className="border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
                  >
                    <Key className="h-4 w-4 mr-2" />
                    Change Email
                  </Button>
                  <Button
                    onClick={handleDeleteUser}
                    variant="outline"
                    className="border-red-500/30 text-red-400 hover:bg-red-500/10 col-span-2"
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete User
                  </Button>
                </div>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDetailModal(false)} className="border-slate-700 text-slate-300">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              {confirmAction?.type === 'delete' && <AlertTriangle className="h-5 w-5 text-red-500" />}
              {confirmAction?.title}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {confirmAction?.description}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => setShowConfirmDialog(false)}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={executeConfirmedAction}
              className={
                confirmAction?.type === 'delete'
                  ? 'bg-red-600 hover:bg-red-700 text-white'
                  : confirmAction?.type === 'disable'
                  ? 'bg-orange-600 hover:bg-orange-700 text-white'
                  : 'bg-cyan-600 hover:bg-cyan-700 text-white'
              }
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Email Dialog */}
      <Dialog open={showChangeEmailDialog} onOpenChange={setShowChangeEmailDialog}>
        <DialogContent className="bg-slate-900 border-slate-800 text-white">
          <DialogHeader>
            <DialogTitle className="text-white">Change User Email</DialogTitle>
            <DialogDescription className="text-slate-400">
              Update the email address for {selectedUser?.displayName || selectedUser?.email}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm text-slate-400 mb-2 block">Current Email</label>
              <Input
                value={selectedUser?.email || ''}
                disabled
                className="bg-slate-800 border-slate-700 text-slate-400"
              />
            </div>
            <div>
              <label className="text-sm text-slate-400 mb-2 block">New Email</label>
              <Input
                type="email"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="Enter new email address"
                className="bg-slate-800 border-slate-700 text-white"
              />
            </div>
            <p className="text-xs text-amber-400">
              ⚠️ The user will need to verify the new email address
            </p>
          </div>
          <DialogFooter>
            <Button 
              variant="outline" 
              onClick={() => {
                setShowChangeEmailDialog(false);
                setNewEmail('');
              }}
              className="border-slate-700 text-slate-300"
            >
              Cancel
            </Button>
            <Button
              onClick={executeChangeEmail}
              disabled={!newEmail || newEmail === selectedUser?.email}
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              Update Email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
