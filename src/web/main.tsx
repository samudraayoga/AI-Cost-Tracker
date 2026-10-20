import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Decimal } from 'decimal.js';
import type { Project } from '../domain/projects.js';
import './styles.css';

function App() {
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [status, setStatus] = useState<{ transactionCount: number; reviewCount: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    Promise.all([fetch('/api/projects', { signal: controller.signal }), fetch('/api/status', { signal: controller.signal })])
      .then(async ([projectResponse, statusResponse]) => {
        if (!projectResponse.ok || !statusResponse.ok) throw new Error('Data proyek belum dapat dimuat.');
        return Promise.all([
          projectResponse.json() as Promise<{ projects: Project[] }>,
          statusResponse.json() as Promise<{ transactionCount: number; reviewCount: number }>,
        ]);
      })
      .then(([projectData, statusData]) => { setProjects(projectData.projects); setStatus(statusData); })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Koneksi gagal.'); });
    return () => controller.abort();
  }, [attempt]);
  const rupiah = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  return <main>
    <header><span className="brand-mark" aria-hidden="true">P</span><span>PRODUCTION / FINANCE</span></header>
    <div className="intro"><p className="eyebrow">AI Production Cost Tracker</p><h1>Semua proyek.<br />Satu tempat.</h1><p className="subtitle">Master proyek dan budget produksi untuk tim operasional.</p></div>
    <aside className="notice"><span className="dot" aria-hidden="true" /><div><strong>Import biaya siap digunakan</strong><p>{status && status.transactionCount > 0
      ? `${status.transactionCount} transaksi efektif tersimpan${status.reviewCount ? ` · ${status.reviewCount} record perlu ditinjau` : ''}. Ringkasan pengeluaran ditambahkan pada Sprint 3.`
      : 'Jalankan perintah import untuk memuat biaya. Ringkasan pengeluaran ditambahkan pada Sprint 3.'}</p></div></aside>
    <section aria-labelledby="projects-title"><div className="section-title"><h2 id="projects-title">Master proyek</h2>{projects && <span>{projects.length} proyek</span>}</div>
      {error ? <div role="alert" className="empty"><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Coba lagi</button></div>
        : projects === null ? <p role="status">Memuat proyek…</p>
        : projects.length === 0 ? <p className="empty">Belum ada master proyek yang dimuat.</p>
        : <div className="projects">{projects.map(project => <article key={project.code}>
          <div className="project-meta"><span className="code">{project.code}</span><span>{project.client}</span></div>
          <h3>{project.name}</h3><div className="budget"><span>Budget produksi</span><strong>{rupiah.format(BigInt(new Decimal(project.budgetIdr).toFixed(0)))}</strong></div>
        </article>)}</div>}
    </section>
    <footer>Nilai dalam Rupiah · Waktu operasional WIB</footer>
  </main>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
