import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';

// ✅ Authentication is ENABLED — OTP-based login required
export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();

  // retry: false prevents the query from retrying on 401 which causes the OTP loop
  const { data: user, isLoading, error } = trpc.auth.me.useQuery(undefined, {
    retry: false,
  });

  useEffect(() => {
    // Only redirect if:
    // 1. Loading is complete
    // 2. There is no authenticated user
    // 3. We're not already on the login page (prevents redirect loop)
    // Note: errors (UNAUTHORIZED) are handled by the global queryCache subscriber in main.tsx
    if (!isLoading && !user && !error && !location.startsWith('/login')) {
      setLocation('/login');
    }
  }, [user, isLoading, error, location, setLocation]);

  // Show loading spinner while verifying session
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // If no user, render nothing (useEffect already redirected)
  if (!user) {
    return null;
  }

  // Authenticated — render children
  return <>{children}</>;
}
