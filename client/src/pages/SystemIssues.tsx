import { useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Bug,
  Lightbulb,
  Settings2,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Wrench,
  TrendingUp,
  Download,
} from 'lucide-react';

// ── Types ────────────────────────────────────────────────────────────────────

type IssueStatus = 'new' | 'reviewing' | 'resolved';
type IssueType = 'bug' | 'feature_request' | 'config_error';

interface SystemIssue {
  id: string;
  contractorId: string;
  toolName: string | null;
  issueType: IssueType;
  title: string;
  description: string;
  errorMessage: string | null;
  status: IssueStatus;
  occurrences: number;
  affectedContractors: string[];
  createdAt: string;
  updatedAt: string;
  /** Filas distintas de la tabla agrupadas bajo este issue (nada se borró). */
  groupedRows?: number;
  firstSeenAt?: string;
  lastSeenAt?: string;
  /** Usuarios distintos afectados en todo el grupo. */
  affectedCount?: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(status: IssueStatus) {
  switch (status) {
    case 'new':
      return (
        <Badge className="bg-red-500/20 text-red-400 border-red-500/30 hover:bg-red-500/30">
          <AlertTriangle className="h-3 w-3 mr-1" />
          New
        </Badge>
      );
    case 'reviewing':
      return (
        <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-500/30">
          <Clock className="h-3 w-3 mr-1" />
          Reviewing
        </Badge>
      );
    case 'resolved':
      return (
        <Badge className="bg-green-500/20 text-green-400 border-green-500/30 hover:bg-green-500/30">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Resolved
        </Badge>
      );
  }
}

function typeBadge(type: IssueType) {
  switch (type) {
    case 'bug':
      return (
        <Badge variant="outline" className="text-red-400 border-red-500/40">
          <Bug className="h-3 w-3 mr-1" />
          Bug
        </Badge>
      );
    case 'feature_request':
      return (
        <Badge variant="outline" className="text-blue-400 border-blue-500/40">
          <Lightbulb className="h-3 w-3 mr-1" />
          Feature
        </Badge>
      );
    case 'config_error':
      return (
        <Badge variant="outline" className="text-orange-400 border-orange-500/40">
          <Settings2 className="h-3 w-3 mr-1" />
          Config
        </Badge>
      );
  }
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function SystemIssues() {
  const [activeTab, setActiveTab] = useState<'all' | IssueStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | IssueType>('all');
  const [selectedIssue, setSelectedIssue] = useState<SystemIssue | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  // Queries
  const statsQuery = trpc.leadprime.getSystemIssueStats.useQuery(undefined, {
    refetchInterval: 30000,
  });

  const issuesQuery = trpc.leadprime.getSystemIssues.useQuery(
    {
      status: activeTab === 'all' ? 'all' : activeTab,
      issue_type: typeFilter,
      limit: 50,
      offset: 0,
    },
    { refetchInterval: 30000 }
  );

  const updateStatusMutation = trpc.leadprime.updateSystemIssueStatus.useMutation({
    onSuccess: () => {
      issuesQuery.refetch();
      statsQuery.refetch();
      setSelectedIssue(null);
      setUpdatingId(null);
    },
    onError: () => {
      setUpdatingId(null);
    },
  });

  const stats = statsQuery.data?.data;
  const issues: SystemIssue[] = (issuesQuery.data?.data as SystemIssue[]) ?? [];
  // El router devuelve {success:false, data:[]} cuando la consulta revienta. Sin
  // mirar este flag, un error se renderizaba idéntico a "no hay nada".
  const issuesError =
    issuesQuery.data?.success === false
      ? issuesQuery.data?.error || 'error desconocido'
      : issuesQuery.error
        ? issuesQuery.error.message
        : null;
  const total = issuesQuery.data?.total ?? 0;
  const newCount = stats?.byStatus?.new ?? 0;

  function handleStatusUpdate(issue: SystemIssue, newStatus: IssueStatus) {
    setUpdatingId(issue.id);
    updateStatusMutation.mutate({ issueId: issue.id, status: newStatus });
  }

  function exportIssuesToJson() {
    // Build a well-organized export object
    const exportData = {
      exportedAt: new Date().toISOString(),
      exportedBy: 'LeadPrime Admin',
      totalIssues: issues.length,
      summary: {
        bugs: issues.filter(i => i.issueType === 'bug').length,
        featureRequests: issues.filter(i => i.issueType === 'feature_request').length,
        configErrors: issues.filter(i => i.issueType === 'config_error').length,
        statusNew: issues.filter(i => i.status === 'new').length,
        statusReviewing: issues.filter(i => i.status === 'reviewing').length,
        statusResolved: issues.filter(i => i.status === 'resolved').length,
      },
      issues: issues.map(issue => ({
        id: issue.id,
        title: issue.title,
        description: issue.description,
        errorMessage: issue.errorMessage ?? null,
        issueType: issue.issueType,
        status: issue.status,
        toolName: issue.toolName ?? null,
        occurrences: issue.occurrences,
        affectedContractors: issue.affectedContractors ?? [],
        reportedAt: issue.createdAt,
        lastUpdated: issue.updatedAt,
      })),
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    a.href = url;
    a.download = `leadprime-issues-${dateStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            System Issues
            {newCount > 0 && (
              <Badge className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full">
                {newCount}
              </Badge>
            )}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Real-time bug reports and feature requests from the LeadPrime AI agent.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={exportIssuesToJson}
            disabled={issues.length === 0}
          >
            <Download className="h-4 w-4 mr-2" />
            Export JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => { issuesQuery.refetch(); statsQuery.refetch(); }}
            disabled={issuesQuery.isFetching}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${issuesQuery.isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Bug className="h-4 w-4 text-red-400" />
                <span className="text-2xl font-bold">{stats.byType.bug}</span>
              </div>
              <p className="text-xs text-muted-foreground">Bugs</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <Lightbulb className="h-4 w-4 text-blue-400" />
                <span className="text-2xl font-bold">{stats.byType.feature_request}</span>
              </div>
              <p className="text-xs text-muted-foreground">Feature Requests</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <AlertTriangle className="h-4 w-4 text-red-500" />
                <span className="text-2xl font-bold text-red-400">{stats.byStatus.new}</span>
              </div>
              <p className="text-xs text-muted-foreground">Needs Attention</p>
            </CardContent>
          </Card>
          <Card className="bg-card/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <CheckCircle2 className="h-4 w-4 text-green-400" />
                <span className="text-2xl font-bold text-green-400">{stats.byStatus.resolved}</span>
              </div>
              <p className="text-xs text-muted-foreground">Resolved</p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Top Issues */}
      {stats && stats.topIssues.length > 0 && (
        <Card className="bg-card/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-orange-400" />
              Most Reported (Active)
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {stats.topIssues.map((issue, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground truncate max-w-[70%]">{issue.title}</span>
                  <div className="flex items-center gap-2">
                    {typeBadge(issue.issueType as IssueType)}
                    <Badge variant="secondary" className="text-xs">
                      {issue.occurrences}×
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters + Tabs */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)}>
          <TabsList>
            <TabsTrigger value="all">
              All
              {stats && <span className="ml-1.5 text-xs opacity-60">{stats.total}</span>}
            </TabsTrigger>
            <TabsTrigger value="new" className="relative">
              New
              {newCount > 0 && (
                <span className="ml-1.5 bg-red-500 text-white text-xs px-1.5 rounded-full">
                  {newCount}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="reviewing">
              Reviewing
              {stats && <span className="ml-1.5 text-xs opacity-60">{stats.byStatus.reviewing}</span>}
            </TabsTrigger>
            <TabsTrigger value="resolved">
              Resolved
              {stats && <span className="ml-1.5 text-xs opacity-60">{stats.byStatus.resolved}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="bug">Bugs</SelectItem>
            <SelectItem value="feature_request">Feature Requests</SelectItem>
            <SelectItem value="config_error">Config Errors</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Issues List */}
      {issuesQuery.isLoading ? (
        <div className="text-center text-muted-foreground py-12">Loading issues...</div>
      ) : issuesError ? (
        // Un fallo de la consulta NO puede verse como "no hay issues": exactamente
        // eso escondió la regresión del agrupado — 139 issues en los contadores y
        // la lista diciendo que el agente nunca había reportado nada.
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-6 text-center">
          <AlertTriangle className="h-10 w-10 mx-auto mb-3 text-red-400" />
          <p className="font-medium text-red-300">No se pudo cargar la lista de issues</p>
          <p className="mt-1 text-sm text-muted-foreground">
            La consulta falló — esto NO significa que no haya issues. Los contadores de arriba
            vienen de otra consulta y siguen siendo válidos.
          </p>
          <pre className="mt-3 overflow-x-auto rounded bg-muted/50 p-3 text-left text-xs text-red-300">
            {issuesError}
          </pre>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => issuesQuery.refetch()}>
            Reintentar
          </Button>
        </div>
      ) : issues.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">
          <CheckCircle2 className="h-10 w-10 mx-auto mb-3 text-green-400 opacity-50" />
          <p className="font-medium">No issues found</p>
          <p className="text-sm mt-1">
            {activeTab === 'all'
              ? 'The AI agent has not reported any issues yet.'
              : `No ${activeTab} issues.`}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map((issue) => (
            <Card
              key={issue.id}
              className={`bg-card/50 cursor-pointer hover:bg-card transition-colors border ${
                issue.status === 'new' ? 'border-red-500/30' : 'border-border'
              }`}
              onClick={() => setSelectedIssue(issue)}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      {statusBadge(issue.status)}
                      {typeBadge(issue.issueType)}
                      {issue.toolName && (
                        <Badge variant="outline" className="text-xs text-muted-foreground">
                          <Wrench className="h-3 w-3 mr-1" />
                          {issue.toolName}
                        </Badge>
                      )}
                    </div>
                    <p className="font-medium text-sm mt-1 truncate">{issue.title}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {issue.description}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="flex items-center gap-1 text-xs text-muted-foreground justify-end">
                      <Users className="h-3 w-3" />
                      <span>{issue.affectedCount ?? issue.affectedContractors.length}</span>
                    </div>
                    {issue.occurrences > 1 && (
                      <Badge variant="secondary" className="text-xs mt-1">
                        {issue.occurrences}×
                      </Badge>
                    )}
                    {/* El mismo fallo llegó en varias filas (texto ligeramente
                        distinto en cada reporte). Se muestran juntas; ninguna
                        se borró de la base. */}
                    {(issue.groupedRows ?? 1) > 1 && (
                      <p
                        className="text-[11px] text-muted-foreground mt-1"
                        title={`${issue.groupedRows} reportes agrupados por ser el mismo fallo. Nada fue eliminado.`}
                      >
                        {issue.groupedRows} reportes agrupados
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {timeAgo(issue.lastSeenAt ?? issue.createdAt)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {total > issues.length && (
            <p className="text-center text-xs text-muted-foreground py-2">
              Showing {issues.length} of {total} issues
            </p>
          )}
        </div>
      )}

      {/* Issue Detail Dialog */}
      <Dialog open={!!selectedIssue} onOpenChange={(open) => !open && setSelectedIssue(null)}>
        {selectedIssue && (
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 flex-wrap">
                {typeBadge(selectedIssue.issueType)}
                {selectedIssue.title}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground">
                ID: {selectedIssue.id.slice(0, 8)}... · Reported {timeAgo(selectedIssue.createdAt)}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">DESCRIPTION</p>
                <p className="text-sm leading-relaxed">{selectedIssue.description}</p>
              </div>

              {selectedIssue.errorMessage && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1">ERROR MESSAGE</p>
                  <pre className="bg-muted/50 rounded p-3 text-xs overflow-x-auto whitespace-pre-wrap break-all">
                    {selectedIssue.errorMessage}
                  </pre>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-muted-foreground mb-1">STATUS</p>
                  {statusBadge(selectedIssue.status)}
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">OCCURRENCES</p>
                  <p className="font-medium">{selectedIssue.occurrences}×</p>
                  {(selectedIssue.groupedRows ?? 1) > 1 && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {selectedIssue.groupedRows} reportes agrupados
                      {selectedIssue.firstSeenAt && ` · desde ${timeAgo(selectedIssue.firstSeenAt)}`}
                    </p>
                  )}
                </div>
                <div>
                  <p className="text-muted-foreground mb-1">AFFECTED USERS</p>
                  <p className="font-medium">
                    {selectedIssue.affectedCount ?? selectedIssue.affectedContractors.length}
                  </p>
                </div>
                {selectedIssue.toolName && (
                  <div>
                    <p className="text-muted-foreground mb-1">TOOL</p>
                    <p className="font-medium font-mono">{selectedIssue.toolName}</p>
                  </div>
                )}
              </div>
            </div>

            <DialogFooter className="flex-col sm:flex-row gap-2">
              {selectedIssue.status !== 'resolved' && (
                <>
                  {selectedIssue.status === 'new' && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={updatingId === selectedIssue.id}
                      onClick={() => handleStatusUpdate(selectedIssue, 'reviewing')}
                    >
                      <Clock className="h-4 w-4 mr-2" />
                      Mark Reviewing
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={updatingId === selectedIssue.id}
                    onClick={() => handleStatusUpdate(selectedIssue, 'resolved')}
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Mark Resolved
                  </Button>
                </>
              )}
              {selectedIssue.status === 'resolved' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={updatingId === selectedIssue.id}
                  onClick={() => handleStatusUpdate(selectedIssue, 'new')}
                >
                  <AlertTriangle className="h-4 w-4 mr-2" />
                  Reopen
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
