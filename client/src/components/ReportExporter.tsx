import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download, Printer, Loader2 } from 'lucide-react';

export type ReportRange = 'week' | 'month' | 'quarter';

const RANGES: { key: ReportRange; label: string }[] = [
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
  { key: 'quarter', label: 'Quarter' },
];

interface Props<T> {
  /** Imperative fetch of the period report for the chosen range. */
  fetchReport: (range: ReportRange) => Promise<T>;
  /** Render the report data to a complete, self-contained HTML document. */
  buildHtml: (data: T, range: ReportRange) => string;
  /** File name stem (e.g. "leadprime-finance"). */
  fileBase: string;
}

/**
 * Self-contained report export control: pick week / month / quarter, then either
 * download a standalone HTML file or open a print view (Save as PDF). Used by both
 * the Finance and System Health pages. Read-only — it only re-fetches data.
 */
export function ReportExporter<T>({ fetchReport, buildHtml, fileBase }: Props<T>) {
  const [range, setRange] = useState<ReportRange>('month');
  const [busy, setBusy] = useState<null | 'html' | 'pdf'>(null);

  async function run(kind: 'html' | 'pdf') {
    if (busy) return;
    setBusy(kind);
    try {
      const data = await fetchReport(range);
      const html = buildHtml(data, range);
      const stamp = new Date().toISOString().slice(0, 10);
      if (kind === 'html') {
        const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${fileBase}-${range}-${stamp}.html`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } else {
        const w = window.open('', '_blank');
        if (!w) {
          alert('Pop-up blocked — allow pop-ups to print/export the PDF.');
          return;
        }
        w.document.open();
        w.document.write(html);
        w.document.close();
        // Give the new document a tick to lay out before invoking print.
        w.onload = () => setTimeout(() => w.print(), 350);
      }
    } catch (err: any) {
      alert(`Could not build report: ${err?.message || err}`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-md border border-slate-700">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              range === r.key
                ? 'bg-emerald-500/20 text-emerald-300'
                : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <Button variant="outline" size="sm" onClick={() => run('html')} disabled={!!busy}>
        {busy === 'html' ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Download className="mr-2 h-4 w-4" />
        )}
        HTML
      </Button>
      <Button variant="outline" size="sm" onClick={() => run('pdf')} disabled={!!busy}>
        {busy === 'pdf' ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Printer className="mr-2 h-4 w-4" />
        )}
        PDF
      </Button>
    </div>
  );
}
