import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, FileText, Mail, Users } from "lucide-react";
import { useState } from "react";

export default function UsageSystem() {
  const [searchQuery, setSearchQuery] = useState("");

  // Fetch usage data
  const { data: systemUsage, isLoading: loadingSystem } = trpc.owlfenc.getSystemUsage.useQuery();
  const { data: userUsageList, isLoading: loadingUsers } = trpc.owlfenc.getUserUsageBreakdown.useQuery();

  // Filter users by search
  const filteredUsers = userUsageList?.filter((user: any) => 
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  ) || [];

  // Calculate email limit percentage
  const emailLimitPercentage = systemUsage?.emailsSentToday 
    ? (systemUsage.emailsSentToday / 500) * 100 
    : 0;

  const getAlertColor = (percentage: number) => {
    if (percentage >= 95) return "text-red-500 bg-red-500/10";
    if (percentage >= 80) return "text-amber-500 bg-amber-500/10";
    return "text-green-500 bg-green-500/10";
  };

  if (loadingSystem || loadingUsers) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-white text-lg">Loading usage data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Usage System</h1>
          <p className="text-slate-400">Monitor system-wide and per-user resource usage</p>
        </div>

        {/* Global System Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Emails Sent Today */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <Mail className="w-8 h-8 text-cyan-500" />
              {emailLimitPercentage >= 80 && (
                <AlertTriangle className="w-5 h-5 text-amber-500" />
              )}
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">Emails Sent Today</p>
              <p className="text-3xl font-bold text-white">
                {systemUsage?.emailsSentToday || 0}
                <span className="text-lg text-slate-400"> / 500</span>
              </p>
              <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                <div 
                  className={`h-full transition-all ${
                    emailLimitPercentage >= 95 ? 'bg-red-500' :
                    emailLimitPercentage >= 80 ? 'bg-amber-500' : 'bg-cyan-500'
                  }`}
                  style={{ width: `${Math.min(emailLimitPercentage, 100)}%` }}
                />
              </div>
              <p className="text-xs text-slate-500">
                {emailLimitPercentage.toFixed(1)}% of daily limit
              </p>
            </div>
          </Card>

          {/* PDFs Generated */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <FileText className="w-8 h-8 text-purple-500" />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">PDFs Generated (Month)</p>
              <p className="text-3xl font-bold text-white">
                {systemUsage?.pdfsGeneratedMonth || 0}
              </p>
              <p className="text-xs text-slate-500">
                {systemUsage?.pdfsGeneratedToday || 0} today
              </p>
            </div>
          </Card>

          {/* Total Operations */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <Activity className="w-8 h-8 text-green-500" />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">Total Operations</p>
              <p className="text-3xl font-bold text-white">
                {(systemUsage?.totalClients || 0) + 
                 (systemUsage?.totalContracts || 0) + 
                 (systemUsage?.totalInvoices || 0)}
              </p>
              <p className="text-xs text-slate-500">
                Clients + Contracts + Invoices
              </p>
            </div>
          </Card>

          {/* Active Users */}
          <Card className="bg-slate-900 border-slate-800 p-6">
            <div className="flex items-center justify-between mb-4">
              <Users className="w-8 h-8 text-amber-500" />
            </div>
            <div className="space-y-2">
              <p className="text-sm text-slate-400">Active Users</p>
              <p className="text-3xl font-bold text-white">
                {userUsageList?.length || 0}
              </p>
              <p className="text-xs text-slate-500">
                With activity tracked
              </p>
            </div>
          </Card>
        </div>

        {/* Feature Breakdown */}
        <Card className="bg-slate-900 border-slate-800 p-6">
          <h2 className="text-xl font-semibold text-white mb-4">System-Wide Feature Usage</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Clients</p>
              <p className="text-2xl font-bold text-cyan-400">{systemUsage?.totalClients || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Contracts</p>
              <p className="text-2xl font-bold text-purple-400">{systemUsage?.totalContracts || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Invoices</p>
              <p className="text-2xl font-bold text-green-400">{systemUsage?.totalInvoices || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Estimates</p>
              <p className="text-2xl font-bold text-amber-400">{systemUsage?.totalEstimates || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Projects</p>
              <p className="text-2xl font-bold text-blue-400">{(systemUsage as any)?.totalProjects || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-4">
              <p className="text-sm text-slate-400 mb-1">Total Payments</p>
              <p className="text-2xl font-bold text-pink-400">{(systemUsage as any)?.totalPayments || 0}</p>
            </div>
          </div>
        </Card>

        {/* Per-User Usage Breakdown */}
        <Card className="bg-slate-900 border-slate-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-semibold text-white">Per-User Usage Breakdown</h2>
            <Input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs bg-slate-800 border-slate-700 text-white"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">User</th>
                  <th className="text-left py-3 px-4 text-sm font-semibold text-slate-400">Email</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Clients</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Contracts</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Invoices</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Estimates</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Projects</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Payments</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Emails</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">PDFs</th>
                  <th className="text-center py-3 px-4 text-sm font-semibold text-slate-400">Total</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="text-center py-8 text-slate-500">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user: any) => {
                    const total = (user.clientsCount || 0) + (user.contractsCount || 0) + 
                                  (user.invoicesCount || 0) + (user.estimatesCount || 0) +
                                  (user.projectsCount || 0) + (user.paymentsCount || 0) +
                                  (user.emailsSentCount || 0) + (user.pdfsGeneratedCount || 0);
                    
                    return (
                      <tr key={user.uid} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="py-3 px-4 text-white">{user.displayName || 'N/A'}</td>
                        <td className="py-3 px-4 text-slate-400">{user.email}</td>
                        <td className="py-3 px-4 text-center text-cyan-400 font-semibold">
                          {user.clientsCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-purple-400 font-semibold">
                          {user.contractsCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-green-400 font-semibold">
                          {user.invoicesCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-amber-400 font-semibold">
                          {user.estimatesCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-blue-400 font-semibold">
                          {user.projectsCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-pink-400 font-semibold">
                          {user.paymentsCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-cyan-300 font-semibold">
                          {user.emailsSentCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-purple-300 font-semibold">
                          {user.pdfsGeneratedCount || 0}
                        </td>
                        <td className="py-3 px-4 text-center text-white font-bold">
                          {total}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Alerts Section */}
        {emailLimitPercentage >= 80 && (
          <Card className={`border-2 p-6 ${getAlertColor(emailLimitPercentage)}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-6 h-6 mt-1" />
              <div>
                <h3 className="font-semibold text-lg mb-1">
                  {emailLimitPercentage >= 95 ? 'Critical: Email Limit Nearly Reached' : 'Warning: Approaching Email Limit'}
                </h3>
                <p className="text-sm opacity-90">
                  You've used {systemUsage?.emailsSentToday} of your 500 daily email limit ({emailLimitPercentage.toFixed(1)}%). 
                  {emailLimitPercentage >= 95 
                    ? ' Consider upgrading your Resend plan immediately.'
                    : ' Monitor usage closely and consider upgrading your plan.'}
                </p>
              </div>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
