import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './ui/button';

export type NotificationPriority = 'info' | 'warning' | 'important' | 'critical';

interface NotificationToastProps {
  id: number;
  title: string;
  message: string;
  priority: NotificationPriority;
  icon?: string;
  actionUrl?: string;
  actionLabel?: string;
  onClose: () => void;
  onAction?: () => void;
  duration?: number; // Auto-dismiss duration in ms
}

export function NotificationToast({
  id,
  title,
  message,
  priority,
  icon,
  actionUrl,
  actionLabel,
  onClose,
  onAction,
  duration,
}: NotificationToastProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Slide in animation
    setTimeout(() => setIsVisible(true), 10);

    // Auto-dismiss based on priority if duration not specified
    const autoDismissDuration = duration || getPriorityDuration(priority);
    
    if (autoDismissDuration > 0) {
      const timer = setTimeout(() => {
        handleClose();
      }, autoDismissDuration);

      return () => clearTimeout(timer);
    }
  }, [duration, priority]);

  const getPriorityDuration = (p: NotificationPriority) => {
    switch (p) {
      case 'critical':
        return 0; // Never auto-dismiss
      case 'important':
        return 10000; // 10 seconds
      case 'warning':
        return 7000; // 7 seconds
      default:
        return 5000; // 5 seconds
    }
  };

  const getPriorityStyles = (p: NotificationPriority) => {
    switch (p) {
      case 'critical':
        return 'bg-red-500/90 border-red-600 text-white';
      case 'important':
        return 'bg-orange-500/90 border-orange-600 text-white';
      case 'warning':
        return 'bg-yellow-500/90 border-yellow-600 text-black';
      default:
        return 'bg-blue-500/90 border-blue-600 text-white';
    }
  };

  const getPriorityIcon = (p: NotificationPriority) => {
    switch (p) {
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

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match animation duration
  };

  const handleActionClick = () => {
    if (onAction) {
      onAction();
    }
    handleClose();
  };

  return (
    <div
      className={`
        fixed bottom-4 right-4 z-50 w-96 max-w-[calc(100vw-2rem)]
        rounded-lg border-2 shadow-2xl backdrop-blur-sm
        transition-all duration-300 ease-out
        ${getPriorityStyles(priority)}
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
      `}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl flex-shrink-0">
            {icon || getPriorityIcon(priority)}
          </span>
          <div className="flex-1 min-w-0">
            <h4 className="font-semibold text-sm mb-1">{title}</h4>
            <p className="text-sm opacity-90 line-clamp-3">{message}</p>
            {actionUrl && actionLabel && (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={handleActionClick}
              >
                {actionLabel}
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 flex-shrink-0 hover:bg-white/20"
            onClick={handleClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
      
      {/* Progress bar for auto-dismiss */}
      {duration && duration > 0 && (
        <div className="h-1 bg-white/20 overflow-hidden">
          <div
            className="h-full bg-white/60 animate-shrink"
            style={{ animationDuration: `${duration}ms` }}
          />
        </div>
      )}
    </div>
  );
}

// Container for managing multiple toasts
interface NotificationToastContainerProps {
  notifications: Array<{
    id: number;
    title: string;
    message: string;
    priority: NotificationPriority;
    icon?: string;
    actionUrl?: string;
    actionLabel?: string;
  }>;
  onDismiss: (id: number) => void;
  onAction?: (id: number, actionUrl?: string) => void;
}

export function NotificationToastContainer({
  notifications,
  onDismiss,
  onAction,
}: NotificationToastContainerProps) {
  return (
    <div className="fixed bottom-0 right-0 z-50 p-4 pointer-events-none">
      <div className="flex flex-col gap-3 pointer-events-auto">
        {notifications.map((notification, index) => (
          <div
            key={notification.id}
            style={{
              marginBottom: `${index * 8}px`,
            }}
          >
            <NotificationToast
              {...notification}
              onClose={() => onDismiss(notification.id)}
              onAction={
                notification.actionUrl && onAction
                  ? () => onAction(notification.id, notification.actionUrl)
                  : undefined
              }
            />
          </div>
        ))}
      </div>
    </div>
  );
}
