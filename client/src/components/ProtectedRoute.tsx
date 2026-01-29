import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';

// ⚠️ TEMPORARY AUTH BYPASS
// Set VITE_DISABLE_AUTH=true in .env to bypass authentication
// Remove or set to false to re-enable authentication
const AUTH_BYPASS_ENABLED = import.meta.env.VITE_DISABLE_AUTH === 'true';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  // 🚨 AUTH BYPASS: Skip authentication if enabled
  if (AUTH_BYPASS_ENABLED) {
    console.warn('⚠️ Authentication bypass is ENABLED. This should only be used in development!');
    return <>{children}</>;
  }

  const [, setLocation] = useLocation();
  const { data: user, isLoading, error } = trpc.auth.me.useQuery();

  useEffect(() => {
    // Si hay un error de autenticación o no hay usuario después de cargar
    if (!isLoading && (!user || error)) {
      setLocation('/login');
    }
  }, [user, isLoading, error, setLocation]);

  // Mostrar loading mientras se verifica la sesión
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Si no hay usuario, no renderizar nada (el useEffect ya redirigió)
  if (!user) {
    return null;
  }

  // Usuario autenticado, renderizar children
  return <>{children}</>;
}
