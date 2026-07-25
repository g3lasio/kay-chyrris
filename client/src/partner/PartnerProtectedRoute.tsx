import { useEffect } from "react";
import { useLocation } from "wouter";
import { Loader2 } from "lucide-react";
import { usePartnerAuth } from "./usePartnerAuth";

export default function PartnerProtectedRoute({ children }: { children: React.ReactNode }) {
  const { partner, loading } = usePartnerAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && !partner && !location.startsWith("/login")) {
      setLocation("/login");
    }
  }, [loading, partner, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!partner) return null;
  return <>{children}</>;
}
