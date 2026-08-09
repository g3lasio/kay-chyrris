/**
 * ContractorPicker — elegir un contratista por NOMBRE, nunca por ID.
 *
 * POR QUÉ EXISTE: la atribución manual de referidos pedía pegar a mano un
 * `con_xxxxx`. El dueño no tiene forma práctica de saber ese identificador: lo
 * conoce por el nombre de la persona o el de su empresa. Un campo así no es que
 * sea incómodo — es que hace la función inservible, y de hecho nunca se usó.
 *
 * Aquí se busca por nombre de contacto o de empresa, el nombre se muestra
 * grande y el ID queda chiquito y secundario, solo como confirmación de que se
 * eligió a la persona correcta.
 *
 * La búsqueda ocurre EN EL SERVIDOR (el endpoint ya filtra por nombre, correo,
 * teléfono y empresa), así que funciona con cualquier cantidad de usuarios, no
 * solo con los de la primera página.
 */
import { useEffect, useMemo, useState } from 'react';
import { trpc } from '@/lib/trpc';
import { Input } from '@/components/ui/input';
import { Check, Loader2, Search, X } from 'lucide-react';

export interface ContractorPickerProps {
  /** Id seleccionado, o null. El componente lo comunica hacia arriba. */
  value: string | null;
  onChange: (contractorId: string | null, label?: string) => void;
  placeholder?: string;
  /** Texto de ayuda bajo el campo. */
  hint?: string;
}

export function ContractorPicker({
  value,
  onChange,
  placeholder = 'Busca por nombre o empresa…',
  hint,
}: ContractorPickerProps) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [chosenLabel, setChosenLabel] = useState<string | null>(null);

  // Debounce: no consultar en cada tecla.
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(term.trim()), 250);
    return () => clearTimeout(t);
  }, [term]);

  const query = trpc.leadprime.getEnrichedUsers.useQuery(
    { search: debounced, limit: 20, offset: 0 },
    { enabled: open && debounced.length >= 2 }
  );

  const results = useMemo(() => {
    const rows = (query.data?.data as any[]) ?? [];
    return rows.map(u => ({
      id: u.id as string,
      name: (u.name as string) || '(sin nombre)',
      business: (u.businessName || u.companyName || null) as string | null,
      email: (u.email as string) || '',
    }));
  }, [query.data]);

  if (value && chosenLabel) {
    return (
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
          <div className="min-w-0">
            {/* El NOMBRE manda; el id va abajo, chiquito, solo para confirmar. */}
            <p className="truncate text-sm font-medium">{chosenLabel}</p>
            <p className="truncate font-mono text-[10px] text-muted-foreground">{value}</p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted"
            onClick={() => {
              onChange(null);
              setChosenLabel(null);
              setTerm('');
            }}
            aria-label="Quitar selección"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={term}
          onChange={e => {
            setTerm(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className="h-9 pl-8"
        />
        {query.isFetching && (
          <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {open && debounced.length >= 2 && (
        <div className="max-h-64 overflow-y-auto rounded-md border bg-popover shadow-md">
          {query.isFetching && results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Buscando…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">
              Nadie coincide con “{debounced}”.
            </p>
          ) : (
            results.map(r => {
              const label = r.business ? `${r.name} · ${r.business}` : r.name;
              return (
                <button
                  key={r.id}
                  type="button"
                  className="flex w-full items-start gap-2 border-b px-3 py-2 text-left last:border-0 hover:bg-accent"
                  onClick={() => {
                    onChange(r.id, label);
                    setChosenLabel(label);
                    setOpen(false);
                  }}
                >
                  <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    {r.business && (
                      <span className="block truncate text-xs text-muted-foreground">{r.business}</span>
                    )}
                    <span className="block truncate text-[10px] text-muted-foreground">{r.email}</span>
                  </span>
                </button>
              );
            })
          )}
        </div>
      )}

      {open && debounced.length > 0 && debounced.length < 2 && (
        <p className="text-[11px] text-muted-foreground">Escribe al menos 2 letras.</p>
      )}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
