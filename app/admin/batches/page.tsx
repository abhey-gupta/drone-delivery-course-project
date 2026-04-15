import { assignDroneToBatch, releaseDroneFromBatch, updateBatchStatus } from '@/app/admin/actions';
import { AdminAutoRefresh } from '@/components/admin/auto-refresh';
import { AdminOperationsMap } from '@/components/maps/admin-operations-map';
import { fetchAdminOverview } from '@/lib/admin-ops';
import { formatLocalDateTime } from '@/lib/time';
import Link from 'next/link';

function formatDateTime(value: string | null) {
  return formatLocalDateTime(value, '—');
}

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

export default async function BatchesPage(props: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const searchParams = (await props.searchParams) ?? {};
  const batchQuery = searchParams.batch;
  const selectedBatchId = Number(Array.isArray(batchQuery) ? batchQuery[0] : batchQuery);

  const overview = await fetchAdminOverview();
  const selectedBatch = overview.batches.find((batch) => batch.batchId === selectedBatchId) ?? overview.batches[0] ?? null;
  const availableDrones = overview.drones.filter((drone) => drone.status.toLowerCase() === 'available' || drone.assignedBatchId === selectedBatch?.batchId);

  return (
    <div className="min-h-full">
      <AdminAutoRefresh intervalMs={3000} />
      {/* Header */}
      <div className="border-b border-slate-800/40 bg-[#070b14]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Batch Management</h1>
            <p className="text-sm text-slate-500 mt-1">
              {overview.batches.length} batches total · {overview.stats.collectingBatches} collecting · {overview.stats.readyBatches} ready
            </p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)_300px]">
          {/* Batch List */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            <div className="px-5 py-4 border-b border-slate-800/40">
              <h2 className="text-sm font-semibold text-slate-100">All Batches</h2>
              <p className="text-xs text-slate-500 mt-0.5">Newest first. Select to inspect.</p>
            </div>
            <div className="max-h-[72vh] space-y-2 overflow-auto p-3">
              {overview.batches.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700/50 p-4 text-sm text-slate-500 text-center">
                  No batches yet.
                </div>
              ) : (
                overview.batches.map((batch) => {
                  const active = batch.batchId === selectedBatch?.batchId;
                  return (
                    <Link
                      key={batch.batchId}
                      href={`/admin/batches?batch=${batch.batchId}`}
                      className={`block rounded-xl border px-4 py-3.5 transition-all duration-200 ${
                        active
                          ? 'border-blue-500/40 bg-blue-500/10 shadow-[0_0_20px_rgba(139,92,246,0.05)]'
                          : 'border-slate-800/50 bg-[#080d17] hover:border-slate-700/60 hover:bg-[#0c1220]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-100">Batch #{batch.batchId}</div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            Zone {batch.zoneId ?? '—'} · {batch.orderCount} orders
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase shrink-0 ${statusTone(batch.status)}`}>
                          {batch.status}
                        </span>
                      </div>
                      <div className="mt-2.5 space-y-0.5 text-xs text-slate-400">
                        <div>Weight: {batch.totalWeight.toFixed(1)} kg</div>
                        <div>Drone: {batch.droneLabel ?? 'Unassigned'}</div>
                      </div>
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          {/* Batch Detail */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            {selectedBatch ? (
              <>
                <div className="px-5 py-4 border-b border-slate-800/40">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-lg font-semibold text-slate-100">Batch #{selectedBatch.batchId}</h2>
                      <p className="text-sm text-slate-500">
                        Zone {selectedBatch.zoneId ?? '—'} · {selectedBatch.orderCount} orders · {selectedBatch.totalWeight.toFixed(1)} kg
                      </p>
                    </div>
                    <span className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase ${statusTone(selectedBatch.status)}`}>
                      {selectedBatch.status}
                    </span>
                  </div>
                </div>

                <div className="space-y-6 p-5">
                  {/* Map */}
                  <AdminOperationsMap selectedBatch={selectedBatch} zones={overview.zones} />

                  {/* Info + Controls */}
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-xl border border-slate-800/40 bg-[#080d17] p-4">
                      <h3 className="text-sm font-medium text-slate-100 mb-3">Batch Details</h3>
                      <div className="space-y-2 text-sm text-slate-400">
                        <div className="flex justify-between">
                          <span>Collection start</span>
                          <span className="text-slate-300">{formatDateTime(selectedBatch.collectionWindowStart)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Collection end</span>
                          <span className="text-slate-300">{formatDateTime(selectedBatch.collectionWindowEnd)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Drone</span>
                          <span className="text-slate-300">{selectedBatch.droneLabel ?? 'Not assigned'}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Drone status</span>
                          <span className="text-slate-300">{selectedBatch.droneStatus ?? '—'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-xl border border-slate-800/40 bg-[#080d17] p-4">
                      <h3 className="text-sm font-medium text-slate-100 mb-3">Status Controls</h3>
                      <div className="flex flex-wrap gap-2">
                        {['collecting', 'ready', 'assigned', 'in_progress', 'completed', 'failed'].map((status) => (
                          <form key={status} action={updateBatchStatus}>
                            <input type="hidden" name="batchId" value={selectedBatch.batchId} />
                            <input type="hidden" name="status" value={status} />
                            <button
                              className={`rounded-lg border px-3 py-2 text-xs font-medium transition-all duration-200 ${
                                selectedBatch.status === status
                                  ? 'border-blue-500/40 bg-blue-500/15 text-blue-300 cursor-default'
                                  : 'border-slate-700/50 text-slate-300 hover:border-blue-400/40 hover:text-white hover:bg-blue-500/10'
                              }`}
                              disabled={selectedBatch.status === status}
                            >
                              {status.replace('_', ' ')}
                            </button>
                          </form>
                        ))}
                        {selectedBatch.droneId ? (
                          <form action={releaseDroneFromBatch}>
                            <input type="hidden" name="batchId" value={selectedBatch.batchId} />
                            <button className="rounded-lg border border-rose-500/30 px-3 py-2 text-xs font-medium text-rose-300 hover:border-rose-400/50 hover:text-white hover:bg-rose-500/10 transition-all">
                              Release drone
                            </button>
                          </form>
                        ) : null}
                      </div>
                      <p className="mt-3 text-[11px] text-slate-600">
                        &quot;Assigned&quot; = drone reserved. &quot;In progress&quot; = drone in flight.
                      </p>
                    </div>
                  </div>

                  {/* Orders table */}
                  <div className="rounded-xl border border-slate-800/40 bg-[#080d17] overflow-hidden">
                    <div className="px-5 py-3.5 border-b border-slate-800/30">
                      <h3 className="text-sm font-medium text-slate-100">Orders in this batch</h3>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead className="text-left text-[11px] uppercase text-slate-500 tracking-wider bg-[#070b14]">
                          <tr>
                            <th className="px-5 py-3 font-medium">Stop</th>
                            <th className="px-5 py-3 font-medium">Order</th>
                            <th className="px-5 py-3 font-medium">Seller</th>
                            <th className="px-5 py-3 font-medium">Weight</th>
                            <th className="px-5 py-3 font-medium">Destination</th>
                            <th className="px-5 py-3 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800/30">
                          {selectedBatch.orders.map((order) => (
                            <tr key={order.orderId} className="hover:bg-white/[0.015] transition-colors">
                              <td className="px-5 py-3 text-slate-400">{order.stopSequence ?? '—'}</td>
                              <td className="px-5 py-3 text-slate-200 font-medium">ORD-{order.orderId}</td>
                              <td className="px-5 py-3">
                                <div className="text-slate-200">{order.sellerName}</div>
                                <div className="text-xs text-slate-500">{order.sellerEmail}</div>
                              </td>
                              <td className="px-5 py-3 text-slate-300">{order.weight} kg</td>
                              <td className="px-5 py-3 text-xs text-slate-500 font-mono">
                                {order.destinationLat !== null && order.destinationLng !== null
                                  ? `${order.destinationLat.toFixed(4)}, ${order.destinationLng.toFixed(4)}`
                                  : '—'}
                              </td>
                              <td className="px-5 py-3">
                                <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase ${statusTone(order.status)}`}>
                                  {order.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex h-full min-h-[420px] items-center justify-center p-8 text-slate-500">
                No batch selected.
              </div>
            )}
          </section>

          {/* Drone Assignment Panel */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            <div className="px-5 py-4 border-b border-slate-800/40">
              <h2 className="text-sm font-semibold text-slate-100">Drone Assignment</h2>
              <p className="text-xs text-slate-500 mt-0.5">Assign an available drone to the selected batch.</p>
            </div>
            <div className="space-y-4 p-4">
              {selectedBatch ? (
                <div className="rounded-xl border border-slate-800/40 bg-[#080d17] p-4">
                  <div className="text-sm font-medium text-slate-100 mb-3">
                    Assign to Batch #{selectedBatch.batchId}
                  </div>
                  {availableDrones.length > 0 ? (
                    <form action={assignDroneToBatch} className="space-y-3">
                      <input type="hidden" name="batchId" value={selectedBatch.batchId} />
                      <select
                        name="droneId"
                        defaultValue={selectedBatch.droneId ?? availableDrones[0]?.droneId}
                        className="w-full rounded-lg border border-slate-700/50 bg-[#0c1220] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                      >
                        {availableDrones.map((drone) => (
                          <option key={drone.droneId} value={drone.droneId}>
                            {drone.label} · {drone.status} · {drone.maxCapacity ?? '—'} kg cap
                          </option>
                        ))}
                      </select>
                      <button className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-3 py-2.5 text-sm font-semibold text-white hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg shadow-blue-500/15 active:scale-[0.98]">
                        Assign drone
                      </button>
                    </form>
                  ) : (
                    <div className="text-sm text-slate-500 py-2">No available drones in the fleet.</div>
                  )}
                </div>
              ) : null}

              {/* Full drone list */}
              <div className="space-y-2">
                <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-600">All Drones</p>
                {overview.drones.map((drone) => (
                  <div key={drone.droneId} className="rounded-xl border border-slate-800/40 bg-[#080d17] p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-200">{drone.label}</div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Hub {drone.currentHubId ?? '—'}
                        </div>
                      </div>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${statusTone(drone.status)}`}>
                        {drone.status}
                      </span>
                    </div>
                    <div className="mt-2 text-[11px] text-slate-500">
                      {drone.maxCapacity ?? '—'} kg capacity · {drone.assignedBatchId ? `Batch #${drone.assignedBatchId}` : 'Unassigned'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
