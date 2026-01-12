import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { trpc } from '@/lib/trpc';

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
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
