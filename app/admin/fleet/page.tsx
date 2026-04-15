import { createDrone } from '@/app/admin/actions';
import { fetchAdminOverview } from '@/lib/admin-ops';

function statusTone(status: string) {
  switch (status.toLowerCase()) {
    case 'available':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'assigned':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'en_route':
    case 'in_flight':
      return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
    case 'maintenance':
      return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
    default:
      return 'bg-slate-500/15 text-slate-300 border-slate-500/30';
  }
}

export default async function FleetPage() {
  const overview = await fetchAdminOverview();
  const defaultModelId = overview.models[0]?.modelId ?? '';

  const statusGroups = [
    { label: 'Available', count: overview.drones.filter((d) => d.status.toLowerCase() === 'available').length, color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/20' },
    { label: 'Assigned', count: overview.drones.filter((d) => d.status.toLowerCase() === 'assigned').length, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/20' },
    { label: 'En Route', count: overview.drones.filter((d) => d.status.toLowerCase() === 'en_route').length, color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/20' },
    { label: 'Total', count: overview.drones.length, color: 'text-slate-300', bg: 'bg-slate-500/15 border-slate-500/20' },
  ];

  return (
    <div className="min-h-full">
      {/* Header */}
      <div className="border-b border-slate-800/40 bg-[#070b14]">
        <div className="max-w-7xl mx-auto px-6 py-8 flex items-end justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Fleet Management</h1>
            <p className="text-sm text-slate-500 mt-1">Manage your drone fleet, create new drones, and monitor status.</p>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Fleet Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {statusGroups.map((group) => (
            <div key={group.label} className={`rounded-xl border bg-gradient-to-br ${group.bg} p-4`}>
              <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider mb-1">{group.label}</p>
              <p className={`text-2xl font-bold ${group.color} tracking-tight`}>{group.count}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
          {/* Drone Grid */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60">
            <div className="px-5 py-4 border-b border-slate-800/40">
              <h2 className="text-sm font-semibold text-slate-100">All Drones</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                {overview.drones.length} drones registered across {overview.hubs.length} hubs
              </p>
            </div>
            <div className="p-4">
              {overview.drones.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-700/50 p-8 text-center">
                  <div className="text-3xl mb-3">🚁</div>
                  <p className="text-sm text-slate-400 mb-1">No drones in your fleet</p>
                  <p className="text-xs text-slate-600">Create your first drone using the form on the right.</p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {overview.drones.map((drone) => (
                    <div
                      key={drone.droneId}
                      className="rounded-xl border border-slate-800/40 bg-[#080d17] p-4 transition-all hover:border-slate-700/60 hover:bg-[#0c1220] duration-200"
                    >
                      {/* Header */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${
                            drone.status.toLowerCase() === 'available'
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                              : drone.status.toLowerCase() === 'en_route'
                              ? 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                              : 'bg-blue-500/15 text-blue-400 border border-blue-500/20'
                          }`}>
                            #{drone.droneId}
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-slate-100 truncate">{drone.label}</div>
                            <div className="text-[11px] text-slate-500">ID: {drone.droneId}</div>
                          </div>
                        </div>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase shrink-0 ${statusTone(drone.status)}`}>
                          {drone.status}
                        </span>
                      </div>

                      {/* Details */}
                      <div className="space-y-1.5 text-[11px] text-slate-500">
                        <div className="flex items-center justify-between">
                          <span>Home Hub</span>
                          <span className="text-slate-400">{drone.currentHubId ? `Hub #${drone.currentHubId}` : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Operating Zone</span>
                          <span className="text-slate-400">{drone.zoneId ? `Zone ${drone.zoneId}` : '—'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Capacity</span>
                          <span className="text-slate-400">{drone.maxCapacity ?? '—'} kg</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Assignment</span>
                          <span className="text-slate-400">
                            {drone.assignedBatchId ? `Batch #${drone.assignedBatchId}` : 'Unassigned'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Create Drone Form */}
          <section className="rounded-2xl border border-slate-800/50 bg-[#0a0f1a]/60 h-fit sticky top-8">
            <div className="px-5 py-4 border-b border-slate-800/40">
              <h2 className="text-sm font-semibold text-slate-100">Register New Drone</h2>
              <p className="text-xs text-slate-500 mt-0.5">Add a new drone to the fleet and assign it to a hub.</p>
            </div>
            <form action={createDrone} className="p-5 space-y-4">
              {/* Model */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Drone Model</label>
                <select
                  name="modelId"
                  className="w-full rounded-lg border border-slate-700/50 bg-[#0c1220] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                  defaultValue={defaultModelId}
                >
                  {overview.models.length === 0 ? (
                    <option value="" disabled>No drone models available</option>
                  ) : (
                    overview.models.map((model) => (
                      <option key={model.modelId} value={model.modelId}>
                        {model.label} ({model.maxCapacity ?? '—'} kg)
                      </option>
                    ))
                  )}
                </select>
                <p className="text-[10px] text-slate-600 mt-1">
                  Select from the live drone models stored in the database.
                </p>
              </div>

              {/* Hub */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Home Hub</label>
                <select
                  name="hubId"
                  className="w-full rounded-lg border border-slate-700/50 bg-[#0c1220] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                >
                  {overview.hubs.map((hub) => (
                    <option key={hub.hubId} value={hub.hubId}>
                      Hub #{hub.hubId} — Zone {hub.zoneId}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-600 mt-1">The hub where this drone will be stationed.</p>
              </div>

              {/* Zone */}
              <div>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500 mb-1.5">Operating Zone</label>
                <select
                  name="zoneId"
                  className="w-full rounded-lg border border-slate-700/50 bg-[#0c1220] px-3 py-2.5 text-sm text-slate-100 outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/20 transition-all"
                >
                  {overview.zones.map((zone) => (
                    <option key={zone.zoneId} value={zone.zoneId}>
                      Zone {zone.zoneId} — {zone.label}
                    </option>
                  ))}
                </select>
              </div>

              <button className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-semibold text-white hover:from-blue-500 hover:to-blue-400 transition-all shadow-lg shadow-blue-500/15 active:scale-[0.98] mt-2">
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                  Register Drone
                </span>
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
