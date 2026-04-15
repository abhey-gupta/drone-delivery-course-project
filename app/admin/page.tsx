import Link from 'next/link';
import { fetchAdminOverview } from '@/lib/admin-ops';
import { AdminAutoRefresh } from '@/components/admin/auto-refresh';
import { AdminOverviewMap } from '@/components/maps/admin-overview-map';

function statusTone(status: string) {
  switch (status.toLowerCase()) {
    case 'collecting':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'ready':
      return 'bg-sky-500/15 text-sky-300 border-sky-500/30';
    case 'assigned':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'in_progress':
    case 'out_for_delivery':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'completed':
    case 'delivered':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'failed':
    case 'cancelled':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
}

export default async function AdminOverviewPage() {
  const overview = await fetchAdminOverview();

  const statCards = [
    { label: 'Total Batches', value: overview.stats.totalBatches, icon: '📦', gradient: 'from-blue-500/15 to-blue-600/5', border: 'border-blue-500/20', text: 'text-blue-400' },
    { label: 'Collecting', value: overview.stats.collectingBatches, icon: '⏳', gradient: 'from-amber-500/15 to-amber-600/5', border: 'border-amber-500/20', text: 'text-amber-400' },
    { label: 'Ready', value: overview.stats.readyBatches, icon: '✅', gradient: 'from-sky-500/15 to-sky-600/5', border: 'border-sky-500/20', text: 'text-sky-400' },
    { label: 'Assigned / In Flight', value: overview.stats.assignedBatches + overview.stats.inProgressBatches, icon: '🚁', gradient: 'from-blue-500/15 to-blue-600/5', border: 'border-blue-500/20', text: 'text-blue-400' },
    { label: 'Total Orders', value: overview.stats.totalOrders, icon: '🛒', gradient: 'from-emerald-500/15 to-emerald-600/5', border: 'border-emerald-500/20', text: 'text-emerald-400' },
    { label: 'Available Drones', value: overview.stats.availableDrones, icon: '✈️', gradient: 'from-cyan-500/15 to-cyan-600/5', border: 'border-cyan-500/20', text: 'text-cyan-400' },
  ];

  const recentBatches = overview.batches.slice(0, 5);

  return (
    <div className="min-h-full">
      <AdminAutoRefresh intervalMs={3000} />
      {/* Header */}
      <div className="border-b border-slate-800/40 bg-[#070b14]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Operations Overview</h1>
            <p className="text-sm text-slate-500 mt-1">System-wide status across all zones, batches, and drones.</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/admin/fleet"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-700/50 text-sm font-medium text-slate-300 hover:text-white hover:border-slate-600 transition-all"
            >
              Manage Fleet
            </Link>
            <Link
              href="/admin/infrastructure"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-500 transition-all shadow-lg shadow-blue-500/20"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              Configure Zones
            </Link>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Stats row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {statCards.map((card) => (
            <div
              key={card.label}
              className={`rounded-xl border bg-gradient-to-br ${card.gradient} ${card.border} p-4 transition-all hover:scale-[1.02] duration-200`}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span className="text-base">{card.icon}</span>
                <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">{card.label}</span>
              </div>
              <p className={`text-2xl font-bold ${card.text} tracking-tight`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Map */}
        <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-800/40 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-100">Live Operations Map</h2>
              <p className="text-xs text-slate-500 mt-0.5">All zones, hubs, drones, sellers, and only live orders</p>
            </div>
          </div>
          <div className="p-1">
            <AdminOverviewMap markers={overview.mapMarkers} zones={overview.zones} />
          </div>
        </section>

        {/* Two-column: Recent Batches + Active Drones */}
        <div className="grid gap-6 xl:grid-cols-2">
          {/* Recent Batches */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            <div className="px-5 py-4 border-b border-slate-800/40 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Recent Batches</h2>
                <p className="text-xs text-slate-500 mt-0.5">{overview.batches.length} total batches</p>
              </div>
              <Link href="/admin/batches" className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors">
                View all →
              </Link>
            </div>
            <div className="divide-y divide-slate-800/40">
              {recentBatches.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">No batches yet.</div>
              ) : (
                recentBatches.map((batch) => (
                  <Link
                    key={batch.batchId}
                    href={`/admin/batches?batch=${batch.batchId}`}
                    className="flex items-center justify-between px-5 py-3.5 hover:bg-white/[0.02] transition-colors group"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors">
                        Batch #{batch.batchId}
                      </div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        Zone {batch.zoneId ?? '—'} · {batch.orderCount} orders · {batch.totalWeight.toFixed(1)} kg
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(batch.status)}`}>
                      {batch.status}
                    </span>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* Drones Activity */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            <div className="px-5 py-4 border-b border-slate-800/40 flex items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-slate-100">Fleet Status</h2>
                <p className="text-xs text-slate-500 mt-0.5">{overview.drones.length} total drones · {overview.stats.availableDrones} available</p>
              </div>
              <Link href="/admin/fleet" className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors">
                Manage fleet →
              </Link>
            </div>
            <div className="divide-y divide-slate-800/40">
              {overview.drones.length === 0 ? (
                <div className="p-6 text-center text-sm text-slate-500">No drones registered.</div>
              ) : (
                overview.drones.map((drone) => (
                  <div key={drone.droneId} className="flex items-center justify-between px-5 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 ${
                        drone.status.toLowerCase() === 'available'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : drone.status.toLowerCase() === 'en_route'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-blue-500/15 text-blue-400'
                      }`}>
                        {drone.droneId}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-200">{drone.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Hub {drone.currentHubId ?? '—'}
                          {drone.assignedBatchId ? ` · Batch #${drone.assignedBatchId}` : ''}
                        </div>
                      </div>
                    </div>
                    <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(drone.status)}`}>
                      {drone.status}
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        {/* Sellers overview */}
        <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
          <div className="px-5 py-4 border-b border-slate-800/40">
            <h2 className="text-sm font-semibold text-slate-100">Registered Sellers</h2>
            <p className="text-xs text-slate-500 mt-0.5">{overview.sellers.length} sellers across {overview.zones.length} zones</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-slate-500 tracking-wider bg-[#080d17]">
                <tr>
                  <th className="px-5 py-3 font-medium">Seller</th>
                  <th className="px-5 py-3 font-medium">Email</th>
                  <th className="px-5 py-3 font-medium">Zone</th>
                  <th className="px-5 py-3 font-medium">Location</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/30">
                {overview.sellers.map((seller) => (
                  <tr key={seller.sellerId} className="hover:bg-white/[0.02] transition-colors">
                    <td className="px-5 py-3 text-slate-200 font-medium">{seller.name}</td>
                    <td className="px-5 py-3 text-slate-400">{seller.email}</td>
                    <td className="px-5 py-3 text-slate-400">{seller.zoneId ? `Zone ${seller.zoneId}` : '—'}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs font-mono">
                      {seller.position ? `${seller.position.lat.toFixed(4)}, ${seller.position.lng.toFixed(4)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
