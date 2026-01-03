import { Card, CardContent } from '@/components/ui/card';
import { Zap, Users, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AppSelectorProps {
  selectedApp: 'owlfenc' | 'leadprime';
  onSelectApp: (app: 'owlfenc' | 'leadprime') => void;
}

export default function AppSelector({ selectedApp, onSelectApp }: AppSelectorProps) {
  const apps = [
    {
      id: 'owlfenc' as const,
      name: 'Owl Fenc',
      description: 'Construction Management Platform',
      icon: Zap,
      gradient: 'from-cyan-500 to-blue-500',
      stats: {
        users: '20+',
        status: 'Active',
      },
    },
    {
      id: 'leadprime' as const,
      name: 'LeadPrime',
      description: 'CRM & Lead Management',
      icon: Users,
      gradient: 'from-purple-500 to-pink-500',
      stats: {
        users: 'Coming Soon',
        status: 'Beta',
      },
    },
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {apps.map((app) => {
        const isSelected = selectedApp === app.id;
        const Icon = app.icon;

        return (
          <Card
            key={app.id}
            className={cn(
              'cursor-pointer transition-all duration-300 group relative overflow-hidden',
              isSelected
                ? 'card-glow border-primary/50 scale-105'
                : 'border-border/50 hover:border-primary/30 hover:scale-102'
            )}
            onClick={() => onSelectApp(app.id)}
          >
            {/* Selection indicator */}
            {isSelected && (
              <div className="absolute top-4 right-4 z-10">
                <div className="p-2 rounded-full bg-primary/20 backdrop-blur-sm">
                  <CheckCircle className="w-5 h-5 text-primary" />
                </div>
              </div>
            )}

            {/* Gradient overlay */}
            <div
              className={cn(
                'absolute inset-0 opacity-0 transition-opacity duration-300',
                isSelected ? 'opacity-10' : 'group-hover:opacity-5'
              )}
            >
              <div className={`w-full h-full bg-gradient-to-br ${app.gradient}`} />
            </div>

            <CardContent className="p-6 relative z-10">
              <div className="space-y-4">
                {/* Icon and Title */}
                <div className="flex items-start gap-4">
                  <div
                    className={cn(
                      'p-4 rounded-2xl bg-gradient-to-br shadow-lg transition-transform duration-300',
                      app.gradient,
                      isSelected ? 'scale-110' : 'group-hover:scale-105'
                    )}
                  >
                    <Icon className="w-8 h-8 text-white" />
                  </div>
                  <div className="flex-1 space-y-1">
                    <h3
                      className={cn(
                        'text-2xl font-bold transition-colors',
                        isSelected ? 'gradient-text' : 'text-foreground'
                      )}
                    >
                      {app.name}
                    </h3>
                    <p className="text-sm text-muted-foreground">{app.description}</p>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6 pt-4 border-t border-border/50">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Users</p>
                    <p className="text-lg font-bold text-neon-cyan">{app.stats.users}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <div className="flex items-center gap-2">
                      <div
                        className={cn(
                          'w-2 h-2 rounded-full animate-pulse',
                          app.stats.status === 'Active' ? 'bg-green-500' : 'bg-yellow-500'
                        )}
                      />
                      <p className="text-sm font-medium text-foreground">{app.stats.status}</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
