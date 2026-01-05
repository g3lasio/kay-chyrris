import { useState } from 'react';
import { trpc } from '../lib/trpc';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Bell, Check, Archive, Trash2 } from 'lucide-react';
import { useNavigate } from 'wouter';

interface NotificationCenterProps {
  userId?: string;
  applicationId: number;
}

export function NotificationCenter({ userId, applicationId }: NotificationCenterProps) {
  const navigate = useNavigate();
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [activeTab, setActiveTab] = useState<'all' | 'unread'>('all');

  // Get notifications
  const { data: notifications, refetch } = trpc.pushNotifications.getAll.useQuery({
    userId,
    applicationId,
    unreadOnly: activeTab === 'unread',
    priority: priorityFilter !== 'all' ? (priorityFilter as any) : undefined,
    category: categoryFilter !== 'all' ? categoryFilter : undefined,
    limit: 100,
  });

  // Mutations
  const markAsReadMutation = trpc.pushNotifications.markAsRead.useMutation({
    onSuccess: () => refetch(),
  });
  const markAllAsReadMutation = trpc.pushNotifications.markAllAsRead.useMutation({
    onSuccess: () => refetch(),
  });
  const archiveMutation = trpc.pushNotifications.archive.useMutation({
    onSuccess: () => refetch(),
  });

  const handleMarkAsRead = async (notificationId: number) => {
    await markAsReadMutation.mutateAsync({ notificationId });
  };

  const handleMarkAllAsRead = async () => {
    if (!userId) return;
    await markAllAsReadMutation.mutateAsync({ userId, applicationId });
  };

  const handleArchive = async (notificationId: number) => {
    await archiveMutation.mutateAsync({ notificationId });
  };

  const handleNotificationClick = (notification: any) => {
    if (!notification.read) {
      handleMarkAsRead(notification.id);
    }
    if (notification.actionUrl) {
      navigate(notification.actionUrl);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'bg-red-500/10 text-red-500 border-red-500/20';
      case 'important':
        return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
      case 'warning':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
      default:
        return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'critical':
        return '🚨';
      case 'important':
        return '⚠️';
      case 'warning':
        return '⚡';
      default:
        return 'ℹ️';
    }
  };

  const unreadCount = notifications?.filter((n: any) => !n.read).length || 0;

  return (
    <div className="container mx-auto p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Bell className="h-8 w-8 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Centro de Notificaciones</h1>
            <p className="text-muted-foreground">
              {unreadCount > 0 ? `${unreadCount} sin leer` : 'Todas las notificaciones leídas'}
            </p>
          </div>
        </div>
        {unreadCount > 0 && (
          <Button onClick={handleMarkAllAsRead} variant="outline">
            <Check className="h-4 w-4 mr-2" />
            Marcar todas como leídas
          </Button>
        )}
      </div>

      {/* Filters */}
      <Card className="p-4 mb-6">
        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-2 block">Prioridad</label>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="critical">🚨 Crítica</SelectItem>
                <SelectItem value="important">⚠️ Importante</SelectItem>
                <SelectItem value="warning">⚡ Advertencia</SelectItem>
                <SelectItem value="info">ℹ️ Información</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="text-sm font-medium mb-2 block">Categoría</label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas</SelectItem>
                <SelectItem value="payment">💰 Pagos</SelectItem>
                <SelectItem value="contract">✍️ Contratos</SelectItem>
                <SelectItem value="user">👤 Usuarios</SelectItem>
                <SelectItem value="system">⚙️ Sistema</SelectItem>
                <SelectItem value="lead">🎯 Leads</SelectItem>
                <SelectItem value="contact">📞 Contactos</SelectItem>
                <SelectItem value="pipeline">📊 Pipeline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as any)} className="mb-6">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="all">
            Todas ({notifications?.length || 0})
          </TabsTrigger>
          <TabsTrigger value="unread">
            Sin leer ({unreadCount})
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Notifications List */}
      <div className="space-y-3">
        {!notifications || notifications.length === 0 ? (
          <Card className="p-12 text-center">
            <Bell className="h-16 w-16 mx-auto text-muted-foreground/50 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No hay notificaciones</h3>
            <p className="text-muted-foreground">
              {activeTab === 'unread'
                ? 'No tienes notificaciones sin leer'
                : 'Aún no has recibido ninguna notificación'}
            </p>
          </Card>
        ) : (
          notifications.map((notification: any) => (
            <Card
              key={notification.id}
              className={`p-4 transition-all hover:shadow-md cursor-pointer ${
                !notification.read ? 'border-l-4 border-l-primary bg-accent/30' : ''
              }`}
              onClick={() => handleNotificationClick(notification)}
            >
              <div className="flex items-start gap-4">
                <span className="text-3xl flex-shrink-0">
                  {notification.icon || getPriorityIcon(notification.priority)}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <h3 className="font-semibold text-lg">{notification.title}</h3>
                    <Badge className={getPriorityColor(notification.priority)}>
                      {notification.priority}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground mb-3">{notification.message}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>
                        {new Date(notification.createdAt).toLocaleString('es-ES', {
                          year: 'numeric',
                          month: 'long',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      {notification.category && (
                        <Badge variant="outline" className="text-xs">
                          {notification.category}
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {!notification.read && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMarkAsRead(notification.id);
                          }}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          Marcar leída
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleArchive(notification.id);
                        }}
                      >
                        <Archive className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  {notification.actionUrl && notification.actionLabel && (
                    <Button variant="default" size="sm" className="mt-3">
                      {notification.actionLabel}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
