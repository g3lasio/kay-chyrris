import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Database, Hammer, ArrowRight } from "lucide-react";

export default function MyApps() {
  const [, setLocation] = useLocation();

  const apps = [
    {
      id: "owlfenc",
      name: "Owl Fenc",
      description: "Construction Management Platform",
      icon: Hammer,
      color: "from-orange-500 to-amber-600",
      route: "/owlfenc",
      stats: {
        users: "7 users",
        clients: "996 clients",
        contracts: "20 contracts"
      }
    },
    {
      id: "leadprime",
      name: "LeadPrime",
      description: "Lead Management System",
      icon: Database,
      color: "from-blue-500 to-cyan-600",
      route: "/apps/leadprime",
      stats: {
        leads: "Coming soon",
        campaigns: "Coming soon",
        conversions: "Coming soon"
      }
    }
  ];

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">My Apps</h1>
        <p className="text-muted-foreground">
          Select an application to view its dashboard and manage its data
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {apps.map((app) => {
          const Icon = app.icon;
          return (
            <Card
              key={app.id}
              className="group hover:shadow-xl transition-all duration-300 cursor-pointer overflow-hidden"
              onClick={() => setLocation(app.route)}
            >
              <div className={`h-2 bg-gradient-to-r ${app.color}`} />
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-xl bg-gradient-to-br ${app.color} text-white`}>
                      <Icon className="h-8 w-8" />
                    </div>
                    <div>
                      <h2 className="text-2xl font-bold group-hover:text-primary transition-colors">
                        {app.name}
                      </h2>
                      <p className="text-sm text-muted-foreground">{app.description}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted-foreground group-hover:text-primary group-hover:translate-x-1 transition-all" />
                </div>

                <div className="grid grid-cols-3 gap-4 mt-6 pt-6 border-t">
                  {Object.entries(app.stats).map(([key, value]) => (
                    <div key={key}>
                      <p className="text-xs text-muted-foreground capitalize mb-1">{key}</p>
                      <p className="text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>

                <Button
                  className="w-full mt-6"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocation(app.route);
                  }}
                >
                  Open Dashboard
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
