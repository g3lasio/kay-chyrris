import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { Activity, AlertTriangle, Calendar, FileText, Mail, Users, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";

type DateRange = "all" | "day" | "month" | "year" | "custom";

type SortColumn = 'name' | 'email' | 'clients' | 'contracts' | 'invoices' | 'estimates' | 'projects' | 'permits' | 'properties' | 'dualSignatures' | 'modifications' | 'pdfs' | 'total';
type SortDirection = 'asc' | 'desc';

export default function UsageSystem() {
  const [searchQuery, setSearchQuery] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");

  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  
  // Sorting state
  const [sortColumn, setSortColumn] = useState<SortColumn>('total');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Calculate date range for queries
  const getDateRangeParams = () => {
    // If "All Time" is selected, return empty object (no date filter)
    if (dateRange === "all") {
      return {};
    }
    
    const now = new Date();
    let startDate: string | undefined;
    let endDate: string | undefined;

    switch (dateRange) {
      case "day":
        startDate = new Date(now.setHours(0, 0, 0, 0)).toISOString();
        endDate = new Date(now.setHours(23, 59, 59, 999)).toISOString();
        break;
      case "month":
        startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
        endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999).toISOString();
        break;
      case "year":
        startDate = new Date(now.getFullYear(), 0, 1).toISOString();
        endDate = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999).toISOString();
        break;
      case "custom":
        if (customStartDate && customEndDate) {
          startDate = new Date(customStartDate).toISOString();
          endDate = new Date(customEndDate + "T23:59:59.999Z").toISOString();
        }
        break;
    }

    return startDate && endDate ? { startDate, endDate } : {};
  };

  const dateParams = getDateRangeParams();

  // Fetch usage data with near-real-time refetch (2 seconds)
  const { data: systemUsage, isLoading: loadingSystem, refetch: refetchSystem } = trpc.owlfenc.getSystemUsage.useQuery(
    dateParams as any,
    {
      refetchInterval: 2000, // Refetch every 2 seconds for near-real-time updates
      refetchIntervalInBackground: false, // Only refetch when tab is active
    }
  );
  const { data: userUsageList, isLoading: loadingUsers, refetch: refetchUsers } = trpc.owlfenc.getUserUsageBreakdown.useQuery(
    dateParams as any,
    {
      refetchInterval: 2000, // Refetch every 2 seconds for near-real-time updates
      refetchIntervalInBackground: false, // Only refetch when tab is active
    }
  );
  // Fetch Resend email usage stats (direct from Resend API)
  const { data: resendUsage, isLoading: loadingResend, refetch: refetchResend } = trpc.owlfenc.getResendUsage.useQuery(
    undefined,
    {
      refetchInterval: 30000, // Refetch every 30 seconds (less frequent since it's external API)
      refetchIntervalInBackground: false,
    }
  );

  // Update last updated timestamp when data changes
  useEffect(() => {
    setLastUpdated(new Date());
  }, [systemUsage, userUsageList]);

  // Manual refresh function
  const handleManualRefresh = () => {
    refetchSystem();
    refetchUsers();
    refetchResend();
    setLastUpdated(new Date());
  };

  // Format last updated time
  const getLastUpdatedText = () => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - lastUpdated.getTime()) / 1000);
    if (diffInSeconds < 10) return "Just now";
    if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
    return `${Math.floor(diffInSeconds / 60)}m ago`;
  };

  // Handle sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New column, default to descending
      setSortColumn(column);
      setSortDirection('desc');
    }
  };

  // Filter and sort users
  const filteredUsers = userUsageList?.filter((user: any) => 
    user.email?.toLowerCase().includes(searchQuery.toLowerCase()) ||
    user.displayName?.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a: any, b: any) => {
    let aValue: any;
    let bValue: any;

    switch (sortColumn) {
      case 'name':
        aValue = a.displayName?.toLowerCase() || '';
        bValue = b.displayName?.toLowerCase() || '';
        break;
      case 'email':
        aValue = a.email?.toLowerCase() || '';
        bValue = b.email?.toLowerCase() || '';
        break;
      case 'clients':
        aValue = a.clientsCount || 0;
        bValue = b.clientsCount || 0;
        break;
      case 'contracts':
        aValue = a.contractsCount || 0;
        bValue = b.contractsCount || 0;
        break;
      case 'invoices':
        aValue = a.invoicesCount || 0;
        bValue = b.invoicesCount || 0;
        break;
      case 'estimates':
        aValue = a.estimatesCount || 0;
        bValue = b.estimatesCount || 0;
        break;
      case 'projects':
        aValue = a.projectsCount || 0;
        bValue = b.projectsCount || 0;
        break;

      case 'permits':
        aValue = a.permitSearchesCount || 0;
        bValue = b.permitSearchesCount || 0;
        break;
      case 'properties':
        aValue = a.propertyVerificationsCount || 0;
        bValue = b.propertyVerificationsCount || 0;
        break;
      case 'dualSignatures':
        aValue = a.dualSignatureContractsCount || 0;
        bValue = b.dualSignatureContractsCount || 0;
        break;

      case 'modifications':
        aValue = a.contractModificationsCount || 0;
        bValue = b.contractModificationsCount || 0;
        break;

      case 'pdfs':
        aValue = a.pdfsGeneratedCount || 0;
        bValue = b.pdfsGeneratedCount || 0;
        break;
      case 'total':
        aValue = (a.clientsCount || 0) + (a.contractsCount || 0) + (a.invoicesCount || 0) + 
                 (a.estimatesCount || 0) + (a.projectsCount || 0) +
                 (a.permitSearchesCount || 0) + (a.propertyVerificationsCount || 0) +
                 (a.dualSignatureContractsCount || 0) +
                 (a.contractModificationsCount || 0) + (a.pdfsGeneratedCount || 0);
        bValue = (b.clientsCount || 0) + (b.contractsCount || 0) + (b.invoicesCount || 0) + 
                 (b.estimatesCount || 0) + (b.projectsCount || 0) +
                 (b.permitSearchesCount || 0) + (b.propertyVerificationsCount || 0) +
                 (b.dualSignatureContractsCount || 0) +
                 (b.contractModificationsCount || 0) + (b.pdfsGeneratedCount || 0);
        break;
      default:
        aValue = 0;
        bValue = 0;
    }

    // Compare values
    if (typeof aValue === 'string') {
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue);
    } else {
      return sortDirection === 'asc'
        ? aValue - bValue
        : bValue - aValue;
    }
  }) || [];

  // Calculate email limit percentage
  const emailLimitPercentage = systemUsage?.emailsSentToday 
    ? (systemUsage.emailsSentToday / 500) * 100 
    : 0;

  const getAlertColor = (percentage: number) => {
    if (percentage >= 95) return "text-red-500 bg-red-500/10";
    if (percentage >= 80) return "text-amber-500 bg-amber-500/10";
    return "text-green-500 bg-green-500/10";
  };

  const getDateRangeLabel = () => {
    switch (dateRange) {
      case "all": return "All Time";
      case "day": return "Today";
      case "month": return "This Month";
      case "year": return "This Year";
      case "custom": return customStartDate && customEndDate 
        ? `${customStartDate} to ${customEndDate}` 
        : "Custom Range";
      default: return "All Time";
    }
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
      <div className="max-w-7xl mx-auto space-y-4">
        {/* Header with Date Filter */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white mb-1">Usage System</h1>
            <p className="text-slate-400 text-sm">Monitor system-wide and per-user resource usage</p>
          </div>
          
          {/* Date Range Filter & Refresh */}
          <div className="flex items-center gap-4">
            {/* Last Updated */}
            <div className="text-xs text-slate-500">
              Updated {getLastUpdatedText()}
            </div>
            
            {/* Manual Refresh Button */}
            <button
              onClick={handleManualRefresh}
              className="p-2 rounded-lg bg-slate-900 border border-slate-700 hover:bg-slate-800 transition-colors"
              title="Refresh data"
            >
              <RefreshCw className="w-4 h-4 text-cyan-500" />
            </button>
            
            {/* Date Range Filter */}
            <div className="flex items-center gap-3">
              <Calendar className="w-5 h-5 text-cyan-500" />
              <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRange)}>
                <SelectTrigger className="w-[180px] bg-slate-900 border-slate-700 text-white">
                  <SelectValue placeholder="Select range" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700">
                  <SelectItem value="all" className="text-white hover:bg-slate-800">All Time</SelectItem>
                  <SelectItem value="day" className="text-white hover:bg-slate-800">Today</SelectItem>
                  <SelectItem value="month" className="text-white hover:bg-slate-800">This Month</SelectItem>
                  <SelectItem value="year" className="text-white hover:bg-slate-800">This Year</SelectItem>
                  <SelectItem value="custom" className="text-white hover:bg-slate-800">Custom Range</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {/* Custom Date Range Inputs */}
        {dateRange === "custom" && (
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <label className="text-sm text-slate-400 mb-1 block">Start Date</label>
                <Input
                  type="date"
                  value={customStartDate}
                  onChange={(e) => setCustomStartDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
              <div className="flex-1">
                <label className="text-sm text-slate-400 mb-1 block">End Date</label>
                <Input
                  type="date"
                  value={customEndDate}
                  onChange={(e) => setCustomEndDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-white"
                />
              </div>
            </div>
          </Card>
        )}

        {/* Compact Global System Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Emails Sent */}
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <Mail className="w-6 h-6 text-cyan-500" />
              {emailLimitPercentage >= 80 && (
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Emails Sent ({getDateRangeLabel()})</p>
              <p className="text-2xl font-bold text-white">
                {dateRange === "day" ? systemUsage?.emailsSentToday || 0 : (systemUsage as any)?.emailsSentMonth || 0}
                {dateRange === "day" && <span className="text-sm text-slate-400"> / 500</span>}
              </p>
              {dateRange === "day" && (
                <>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
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
                </>
              )}
            </div>
          </Card>

          {/* Resend Email Usage (with alerts) */}
          <Card className={`border-slate-800 p-4 ${
            resendUsage?.data?.isCritical ? 'bg-red-900/20 border-red-500' :
            resendUsage?.data?.isNearLimit ? 'bg-yellow-900/20 border-yellow-500' :
            'bg-slate-900'
          }`}>
            <div className="flex items-center justify-between mb-2">
              <Mail className={`w-6 h-6 ${
                resendUsage?.data?.isCritical ? 'text-red-400' :
                resendUsage?.data?.isNearLimit ? 'text-yellow-400' :
                'text-blue-500'
              }`} />
              {resendUsage?.data?.isNearLimit && (
                <AlertTriangle className={`w-5 h-5 ${
                  resendUsage?.data?.isCritical ? 'text-red-400 animate-pulse' : 'text-yellow-400'
                }`} />
              )}
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Resend Emails (Today)</p>
              <p className="text-2xl font-bold text-white">
                {resendUsage?.data?.emailsSentToday || 0}
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">
                  {resendUsage?.data?.usagePercentage || 0}% of daily limit
                </span>
                <span className={`font-semibold ${
                  resendUsage?.data?.isCritical ? 'text-red-400' :
                  resendUsage?.data?.isNearLimit ? 'text-yellow-400' :
                  'text-slate-500'
                }`}>
                  {resendUsage?.data?.dailyLimit || 500} max
                </span>
              </div>
              {resendUsage?.data?.isNearLimit && (
                <p className={`text-xs font-semibold mt-1 ${
                  resendUsage?.data?.isCritical ? 'text-red-400' : 'text-yellow-400'
                }`}>
                  ⚠️ {resendUsage?.data?.isCritical ? 'CRITICAL' : 'WARNING'}: Approaching limit!
                </p>
              )}
            </div>
          </Card>

          {/* Total Operations */}
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-6 h-6 text-green-500" />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Total Operations</p>
              <p className="text-2xl font-bold text-white">
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
          <Card className="bg-slate-900 border-slate-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-6 h-6 text-amber-500" />
            </div>
            <div className="space-y-1">
              <p className="text-xs text-slate-400">Active Users</p>
              <p className="text-2xl font-bold text-white">
                {userUsageList?.length || 0}
              </p>
              <p className="text-xs text-slate-500">
                With activity tracked
              </p>
            </div>
          </Card>
        </div>

        {/* Compact Feature Breakdown */}
        <Card className="bg-slate-900 border-slate-800 p-4">
          <h2 className="text-lg font-semibold text-white mb-3">System-Wide Feature Usage</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Total Clients</p>
              <p className="text-xl font-bold text-cyan-400">{systemUsage?.totalClients || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Total Contracts</p>
              <p className="text-xl font-bold text-purple-400">{systemUsage?.totalContracts || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Total Invoices</p>
              <p className="text-xl font-bold text-green-400">{systemUsage?.totalInvoices || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Total Estimates</p>
              <p className="text-xl font-bold text-amber-400">{systemUsage?.totalEstimates || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Total Projects</p>
              <p className="text-xl font-bold text-blue-400">{(systemUsage as any)?.totalProjects || 0}</p>
            </div>
            {/* NEW: High-priority metrics */}
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Permit Searches</p>
              <p className="text-xl font-bold text-orange-400">{(systemUsage as any)?.totalPermitSearches || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Property Verifications</p>
              <p className="text-xl font-bold text-teal-400">{(systemUsage as any)?.totalPropertyVerifications || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Dual Signatures</p>
              <p className="text-xl font-bold text-indigo-400">{(systemUsage as any)?.totalDualSignatureContracts || 0}</p>
            </div>
            <div className="bg-slate-800/50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Contract Mods</p>
              <p className="text-xl font-bold text-violet-400">{(systemUsage as any)?.totalContractModifications || 0}</p>
            </div>
          </div>
        </Card>

        {/* Per-User Usage Breakdown */}
        <Card className="bg-slate-900 border-slate-800 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">Per-User Usage Breakdown</h2>
            <Input
              type="text"
              placeholder="Search users..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="max-w-xs bg-slate-800 border-slate-700 text-white text-sm"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-800">
                  <th onClick={() => handleSort('name')} className="text-left py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    User {sortColumn === 'name' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('email')} className="text-left py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Email {sortColumn === 'email' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('clients')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Clients {sortColumn === 'clients' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('contracts')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Contracts {sortColumn === 'contracts' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('invoices')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Invoices {sortColumn === 'invoices' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('estimates')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Estimates {sortColumn === 'estimates' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('projects')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Projects {sortColumn === 'projects' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('permits')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Permits {sortColumn === 'permits' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('properties')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Properties {sortColumn === 'properties' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('dualSignatures')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Dual Sigs {sortColumn === 'dualSignatures' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('modifications')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Contract Mods {sortColumn === 'modifications' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('pdfs')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    PDFs {sortColumn === 'pdfs' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                  <th onClick={() => handleSort('total')} className="text-center py-2 px-3 text-xs font-semibold text-slate-400 cursor-pointer hover:text-cyan-400 transition-colors">
                    Total {sortColumn === 'total' && (sortDirection === 'asc' ? '↑' : '↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={14} className="text-center py-6 text-slate-500 text-sm">
                      No users found
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map((user: any) => {
                    const total = (user.clientsCount || 0) + (user.contractsCount || 0) + 
                                  (user.invoicesCount || 0) + (user.estimatesCount || 0) +
                                  (user.projectsCount || 0) +
                                  (user.permitSearchesCount || 0) + (user.propertyVerificationsCount || 0) +
                                  (user.dualSignatureContractsCount || 0) +
                                  (user.contractModificationsCount || 0) + (user.pdfsGeneratedCount || 0);
                    
                    return (
                      <tr key={user.uid} className="border-b border-slate-800 hover:bg-slate-800/50">
                        <td className="py-2 px-3 text-white text-sm">{user.displayName || 'N/A'}</td>
                        <td className="py-2 px-3 text-slate-400 text-sm">{user.email}</td>
                        <td className="py-2 px-3 text-center text-cyan-400 font-semibold text-sm">
                          {user.clientsCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-purple-400 font-semibold text-sm">
                          {user.contractsCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-green-400 font-semibold text-sm">
                          {user.invoicesCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-amber-400 font-semibold text-sm">
                          {user.estimatesCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-blue-400 font-semibold text-sm">
                          {user.projectsCount || 0}
                        </td>
                        {/* NEW: High-priority metrics */}
                        <td className="py-2 px-3 text-center text-orange-400 font-semibold text-sm">
                          {user.permitSearchesCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-teal-400 font-semibold text-sm">
                          {user.propertyVerificationsCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-indigo-400 font-semibold text-sm">
                          {user.dualSignatureContractsCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-violet-400 font-semibold text-sm">
                          {user.contractModificationsCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-purple-300 font-semibold text-sm">
                          {user.pdfsGeneratedCount || 0}
                        </td>
                        <td className="py-2 px-3 text-center text-white font-bold text-sm">
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
        {emailLimitPercentage >= 80 && dateRange === "day" && (
          <Card className={`border-2 p-4 ${getAlertColor(emailLimitPercentage)}`}>
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5" />
              <div>
                <h3 className="font-semibold text-base mb-1">
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
