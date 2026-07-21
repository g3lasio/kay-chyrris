/**
 * UserPicker — selector de cuentas de LeadPrime con DOS modos en un control:
 *   1. Dropdown: click en el campo (o en la flecha) lista las cuentas de
 *      inmediato, sin escribir nada — para elegir visualmente.
 *   2. Buscador: escribir filtra en el servidor por nombre, negocio, email o
 *      teléfono — para cuando ya sabes a quién buscas.
 *
 * Compartido por la página de Usuarios y la de Suscripciones (asignar tier,
 * agregar staff, crear cuenta) para no duplicar la lógica de búsqueda.
 */
import { useState, useRef, useEffect } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Loader2, Search, User, X, ChevronDown } from 'lucide-react';

export interface PickedUser {
  id: string;
  name: string;
  businessName: string | null;
  email: string;
  subscriptionPlan: string | null;
}

export function UserPicker({ selected, onSelect, placeholder }: {
  selected: PickedUser | null;
  onSelect: (u: PickedUser | null) => void;
  placeholder?: string;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Cerrar el dropdown al hacer click fuera.
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  // Sin texto → lista completa (modo dropdown). Con texto → búsqueda en servidor.
  const usersQuery = trpc.leadprime.getUsers.useQuery(
    { search: search.trim() || undefined, limit: search.trim() ? 10 : 100, offset: 0 },
    { enabled: open, staleTime: 30_000 }
  );
  const results = (usersQuery.data?.data ?? []) as Array<{
    id: string; name: string; businessName: string | null; email: string; subscriptionPlan: string | null;
  }>;

  if (selected) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2">
        <User className="h-4 w-4 text-violet-300 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{selected.businessName ?? selected.name}</p>
          <p className="text-xs text-muted-foreground truncate font-mono">{selected.id}</p>
        </div>
        <button onClick={() => onSelect(null)} className="shrink-0 p-1 rounded hover:bg-accent transition-colors" title="Cambiar">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder={placeholder ?? 'Elegir de la lista o buscar por nombre, email, teléfono...'}
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          className="pl-8 pr-8 h-9 text-sm"
        />
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-accent transition-colors"
          title="Ver lista de cuentas"
        >
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-background shadow-xl divide-y divide-border max-h-64 overflow-y-auto">
          {usersQuery.isLoading ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : results.length === 0 ? (
            <p className="text-xs text-muted-foreground px-3 py-2.5">
              {search.trim() ? `Sin resultados para “${search}”.` : 'No hay cuentas.'}
            </p>
          ) : (
            results.map(u => (
              <button
                key={u.id}
                onClick={() => { onSelect({ id: u.id, name: u.name, businessName: u.businessName, email: u.email, subscriptionPlan: u.subscriptionPlan }); setOpen(false); setSearch(''); }}
                className="w-full text-left px-3 py-2 hover:bg-muted/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium truncate">{u.businessName ?? u.name}</span>
                  {u.subscriptionPlan && (
                    <span className="text-[10px] text-muted-foreground shrink-0">{u.subscriptionPlan}</span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">{u.email} · <span className="font-mono">{u.id}</span></p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
