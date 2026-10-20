import { StrictMode, useEffect, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { Decimal } from 'decimal.js';
import type { DashboardData, ProjectCostSummary } from '../db/dashboard.js';
import type { CostSource } from '../domain/money.js';
import './styles.css';

const integerFormatter = new Intl.NumberFormat('id-ID');
const dateFormatter = new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'short', timeZone: 'Asia/Jakarta' });
const sourceNames: Record<CostSource, string> = {
  vendor_a: 'Vendor A', vendor_b: 'Vendor B', vendor_c: 'Vendor C', manual: 'Manual Ops',
};

function formatRupiah(value: string): string {
  const rounded = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const negative = rounded.isNegative();
  const [whole = '0', fraction = '00'] = rounded.abs().toFixed(2).split('.');
  const decimals = fraction === '00' ? '' : `,${fraction}`;
  return `${negative ? '-' : ''}Rp${integerFormatter.format(BigInt(whole))}${decimals}`;
}

function formatPercent(value: string): string {
  return `${new Decimal(value).toDecimalPlaces(1, Decimal.ROUND_HALF_UP).toFixed(1).replace('.', ',')}%`;
}

function shortRupiah(value: string): string {
  const amount = new Decimal(value);
  const absolute = amount.abs();
  if (absolute.greaterThanOrEqualTo(1_000_000_000)) return `${amount.div(1_000_000_000).toDecimalPlaces(1).toFixed().replace('.', ',')} M`;
  if (absolute.greaterThanOrEqualTo(1_000_000)) return `${amount.div(1_000_000).toDecimalPlaces(1).toFixed().replace('.', ',')} jt`;
  if (absolute.greaterThanOrEqualTo(1_000)) return `${amount.div(1_000).toDecimalPlaces(1).toFixed().replace('.', ',')} rb`;
  return amount.toDecimalPlaces(0).toFixed();
}

function formatWeek(start: string, end: string): string {
  const atWib = (date: string) => new Date(`${date}T00:00:00+07:00`);
  return `${dateFormatter.format(atWib(start))}–${dateFormatter.format(atWib(end))}`;
}

function projectState(project: ProjectCostSummary) {
  const usage = new Decimal(project.usagePercent);
  if (usage.gt(100)) return { label: 'Overbudget', className: 'danger' };
  if (usage.gt(80)) return { label: 'Di atas 80%', className: 'warning' };
  return { label: project.transactionCount ? 'Terkendali' : 'Belum ada biaya', className: 'safe' };
}

function DataNotice({ dashboard }: { dashboard: DashboardData }) {
  const { dataQuality, summary } = dashboard;
  if (!dataQuality.importsComplete) return <aside className="notice warning-notice">
    <span className="notice-icon" aria-hidden="true">!</span>
    <div><strong>{summary.transactionCount ? 'Import terakhir belum lengkap' : 'Biaya belum diimpor'}</strong>
      <p>{summary.transactionCount
        ? `Periksa sumber: ${dataQuality.incompleteSources.map(source => sourceNames[source]).join(', ')}. Angka pada halaman ini mungkin belum final.`
        : 'Jalankan perintah import untuk memuat biaya dari keempat sumber.'}</p></div>
  </aside>;
  if (dataQuality.reviewCount > 0) return <aside className="notice review-notice">
    <span className="notice-icon" aria-hidden="true">!</span>
    <div><strong>{dataQuality.reviewCount} record perlu ditinjau</strong>
      <p>Ringkasan hanya menghitung transaksi yang sudah terhubung ke proyek. Record yang belum terpetakan belum masuk ke angka di bawah.</p></div>
  </aside>;
  return <aside className="notice ready-notice">
    <span className="notice-icon check" aria-hidden="true">✓</span>
    <div><strong>Data siap digunakan</strong><p>Keempat sumber berhasil diimpor dan tidak ada record yang menunggu tinjauan.</p></div>
  </aside>;
}

function ProjectCard({ project }: { project: ProjectCostSummary }) {
  const state = projectState(project);
  const fill = Decimal.max(0, Decimal.min(100, new Decimal(project.usagePercent))).toNumber();
  const remaining = new Decimal(project.remainingIdr);
  return <article className={`project-card ${state.className}`}>
    <div className="project-heading">
      <div><span className="code">{project.code}</span><p>{project.client}</p></div>
      <span className={`status ${state.className}`}>{state.label}</span>
    </div>
    <h3>{project.name}</h3>
    <div className="project-spend"><div><span>Pengeluaran</span><strong>{formatRupiah(project.spendIdr)}</strong></div><b>{formatPercent(project.usagePercent)}</b></div>
    <div className="progress" role="progressbar" aria-label={`Pemakaian budget ${project.name}`} aria-valuenow={Math.max(0, Math.min(100, Number(project.usagePercent)))} aria-valuetext={`${formatPercent(project.usagePercent)} budget terpakai`} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${fill}%` }} />
    </div>
    <div className="project-foot">
      <span>Budget {formatRupiah(project.budgetIdr)}</span>
      <span>{remaining.isNegative() ? `Lebih ${formatRupiah(remaining.abs().toFixed())}` : `Sisa ${formatRupiah(project.remainingIdr)}`}</span>
    </div>
  </article>;
}

function Dashboard({ data, onRefresh, refreshing }: { data: DashboardData; onRefresh: () => void; refreshing: boolean }) {
  const vendorMax = Decimal.max(0, ...data.vendors.map(vendor => new Decimal(vendor.spendIdr).abs())).toNumber();
  const weekMax = Decimal.max(0, ...data.weekly.map(week => new Decimal(week.spendIdr).abs())).toNumber();
  return <main>
    <header><div className="brand"><span className="brand-mark" aria-hidden="true">P</span><span>PRODUCTION / FINANCE</span></div>
      <button className="refresh" onClick={onRefresh} disabled={refreshing}>{refreshing ? 'Memuat…' : 'Perbarui data'}</button></header>

    <div className="intro"><div><p className="eyebrow">AI Production Cost Tracker</p><h1>Pantau biaya.<br />Jaga budget.</h1></div>
      <p className="subtitle">Ringkasan biaya produksi dari seluruh vendor dan pencatatan operasional dalam Rupiah.</p></div>

    <DataNotice dashboard={data} />

    <section className="summary-grid" aria-label="Ringkasan seluruh proyek">
      <article className="metric primary"><span>Total pengeluaran</span><strong>{formatRupiah(data.summary.totalSpendIdr)}</strong><small>Dari {data.summary.transactionCount} transaksi efektif</small></article>
      <article className="metric"><span>Pemakaian budget</span><strong>{formatPercent(data.summary.usagePercent)}</strong><small>Total budget {formatRupiah(data.summary.totalBudgetIdr)}</small></article>
      <article className="metric"><span>Sisa budget</span><strong>{formatRupiah(data.summary.remainingBudgetIdr)}</strong><small>Gabungan {data.summary.projectCount} proyek</small></article>
    </section>

    <section aria-labelledby="projects-title">
      <div className="section-title"><div><p className="kicker">PORTOFOLIO</p><h2 id="projects-title">Pengeluaran per proyek</h2></div><span>{data.projects.length} proyek</span></div>
      <div className="projects">{data.projects.map(project => <ProjectCard key={project.code} project={project} />)}</div>
    </section>

    <div className="detail-grid">
      <section className="panel" aria-labelledby="vendors-title">
        <div className="panel-heading"><div><p className="kicker">DISTRIBUSI</p><h2 id="vendors-title">Biaya per vendor</h2></div><span>{data.vendors.length} vendor</span></div>
        {data.vendors.length === 0 ? <p className="empty">Belum ada biaya vendor untuk ditampilkan.</p> : <div className="vendor-list">
          {data.vendors.map(vendor => {
            const width = vendorMax ? new Decimal(vendor.spendIdr).abs().div(vendorMax).times(100).toNumber() : 0;
            return <div className="vendor-row" key={vendor.vendor}>
              <div className="vendor-label"><strong>{vendor.vendor}</strong><span>{vendor.transactionCount} transaksi · {formatPercent(vendor.sharePercent)}</span></div>
              <div className="vendor-amount"><strong>{formatRupiah(vendor.spendIdr)}</strong><div className="mini-track"><span className={new Decimal(vendor.spendIdr).isNegative() ? 'negative' : ''} style={{ width: `${width}%` }} /></div></div>
            </div>;
          })}
        </div>}
      </section>

      <section className="panel trend-panel" aria-labelledby="trend-title">
        <div className="panel-heading"><div><p className="kicker">WAKTU WIB</p><h2 id="trend-title">Tren mingguan</h2></div><span>Senin–Minggu</span></div>
        {data.weekly.length === 0 ? <p className="empty">Tren akan muncul setelah biaya berhasil diimpor.</p> : <div className="week-chart" aria-label="Grafik pengeluaran bersih per minggu">
          {data.weekly.map(week => {
            const negative = new Decimal(week.spendIdr).isNegative();
            const height = weekMax ? new Decimal(week.spendIdr).abs().div(weekMax).times(100).toNumber() : 0;
            return <div className="week" key={week.weekStartWib} title={`${formatWeek(week.weekStartWib, week.weekEndWib)}: ${formatRupiah(week.spendIdr)}`}>
              <span className="week-value">{shortRupiah(week.spendIdr)}</span>
              <div className="bar-space"><span className={`week-bar ${negative ? 'negative' : ''}`} style={{ '--bar-height': `${Math.max(height, 3)}%` } as CSSProperties} /></div>
              <strong>{formatWeek(week.weekStartWib, week.weekEndWib)}</strong><small>{week.transactionCount} trx</small>
            </div>;
          })}
        </div>}
      </section>
    </div>
    <footer>Nilai dalam Rupiah · Transaksi dikelompokkan menurut waktu WIB · Minggu dimulai hari Senin</footer>
  </main>;
}

function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    setRefreshing(true);
    fetch('/api/dashboard', { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Data dashboard belum dapat dimuat.');
        return response.json() as Promise<DashboardData>;
      })
      .then(setData)
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Koneksi gagal.'); })
      .finally(() => { if (!controller.signal.aborted) setRefreshing(false); });
    return () => controller.abort();
  }, [attempt]);
  if (error && !data) return <main className="center-state"><div role="alert" className="load-card"><span className="brand-mark">P</span><h1>Dashboard belum dapat dibuka.</h1><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Coba lagi</button></div></main>;
  if (!data) return <main className="center-state"><p role="status">Memuat dashboard…</p></main>;
  return <Dashboard data={data} refreshing={refreshing} onRefresh={() => setAttempt(value => value + 1)} />;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
