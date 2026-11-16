import { useState } from 'react';
import { Bell, Check, Info, AlertTriangle, CheckCircle, Package, XCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  useGetNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/api/notifications.api';
import { formatDistanceToNow } from 'date-fns';

const getIconForType = (type) => {
  switch (type) {
    case 'compliance_gap':
      return <AlertTriangle className="h-5 w-5 text-amber-500" />;
    case 'import_complete':
      return <CheckCircle className="h-5 w-5 text-green-500" />;
    case 'export_ready':
      return <Package className="h-5 w-5 text-brand-500" />;
    case 'export_failed':
      return <XCircle className="h-5 w-5 text-red-500" />;
    case 'recall_simulation':
      return <AlertTriangle className="h-5 w-5 text-red-500" />;
    default:
      return <Info className="h-5 w-5 text-blue-500" />;
  }
};

export const NotificationBell = () => {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  // Fetch only unread for the badge, but fetch all for the list when open
  const { data: unreadData } = useGetNotifications({ unreadOnly: true, limit: 10 });
  const { data: allData, isLoading } = useGetNotifications({ limit: 20 });
  
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();

  const unreadCount = unreadData?.pagination?.total || 0;
  const notifications = allData?.data || [];

  const handleNotificationClick = async (notification) => {
    if (!notification.is_read) {
      await markReadMutation.mutateAsync(notification.id);
    }
    setOpen(false);
    if (notification.link) {
      navigate(notification.link);
    }
  };

  const handleMarkAllRead = async () => {
    await markAllReadMutation.mutateAsync();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5 text-gray-600" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-600 ring-2 ring-white" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <h4 className="font-semibold text-sm">Notifications</h4>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllRead}
              className="text-xs text-brand-600 hover:text-brand-700 h-auto py-1 px-2"
              disabled={markAllReadMutation.isPending}
            >
              <Check className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[300px] overflow-y-auto">
          {isLoading ? (
            <div className="p-4 text-center text-sm text-gray-500">Loading...</div>
          ) : notifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-gray-500">
              No notifications yet.
            </div>
          ) : (
            <div className="flex flex-col">
              {notifications.map((notif) => (
                <button
                  key={notif.id}
                  onClick={() => handleNotificationClick(notif)}
                  className={cn(
                    "flex items-start gap-3 p-4 text-left transition-colors hover:bg-gray-50 border-b border-gray-50 last:border-0",
                    !notif.is_read ? "bg-brand-50/50" : ""
                  )}
                >
                  <div className="shrink-0 mt-0.5">
                    {getIconForType(notif.type)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn("text-sm font-medium text-gray-900", !notif.is_read && "font-semibold")}>
                      {notif.title}
                    </p>
                    <p className="text-sm text-gray-500 line-clamp-2 mt-0.5">
                      {notif.message}
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {formatDistanceToNow(new Date(notif.created_at), { addSuffix: true })}
                    </p>
                  </div>
                  {!notif.is_read && (
                    <div className="shrink-0 w-2 h-2 rounded-full bg-brand-600 mt-1.5" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
