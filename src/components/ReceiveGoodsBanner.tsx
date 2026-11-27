import React, { useMemo, useState, useEffect } from 'react';
import { BranchInfo, BranchTransfer, BranchTransferItem } from '../types/stock';
import {
  BellRing,
  CheckCircle2,
  CheckSquare,
  PackageCheck,
  Square,
  Truck,
  ArrowRight,
  Barcode,
  Loader2,
  Pencil,
} from 'lucide-react';

interface ReceiveGoodsBannerProps {
  activeBranch: BranchInfo;
  transfers: BranchTransfer[];
  isReceiving?: boolean;
  onReceiveSelected: (selections: Array<{ transferId: string; itemIds: string[] }>) => void;
}

interface PendingRow {
  key: string;
  transfer: BranchTransfer;
  item: BranchTransferItem;
}

export const ReceiveGoodsBanner: React.FC<ReceiveGoodsBannerProps> = ({
  activeBranch,
  transfers,
  isReceiving = false,
  onReceiveSelected,
}) => {
  const pendingRows = useMemo<PendingRow[]>(() => {
    const rows: PendingRow[] = [];
    transfers
      .filter((t) => t.toBranchId === activeBranch.id && t.status !== 'received')
      .forEach((trf) => {
        (trf.items || []).forEach((item) => {
          if (!item.received) {
            rows.push({
              key: `${trf.id}::${item.id}`,
              transfer: trf,
              item,
            });
          }
        });
      });
    return rows;
  }, [transfers, activeBranch.id]);

  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    const valid = new Set(pendingRows.map((r) => r.key));
    setCheckedKeys((prev) => {
      const next = new Set<string>();
      prev.forEach((k) => {
        if (valid.has(k)) next.add(k);
      });
      return next;
    });
  }, [pendingRows]);

  // Summarize incoming batteries by sender branch (e.g. "3 - Yard City Center sent you 1 battery (60×24 FLAT)")
  const senderSummaries = useMemo(() => {
    const bySender = new Map<string, { senderName: string; totalUnits: number; labels: string[] }>();
    pendingRows.forEach(({ transfer, item }) => {
      const current = bySender.get(transfer.fromBranchId) || {
        senderName: transfer.fromBranchName,
        totalUnits: 0,
        labels: [],
      };
      current.totalUnits += item.quantity || 1;
      current.labels.push(`${item.quantity}× ${item.modelName}`);
      bySender.set(transfer.fromBranchId, current);
    });
    return Array.from(bySender.values());
  }, [pendingRows]);

  if (pendingRows.length === 0) return null;

  const allChecked = pendingRows.length > 0 && checkedKeys.size === pendingRows.length;
  const totalPendingUnits = pendingRows.reduce((sum, r) => sum + (r.item.quantity || 0), 0);
  const checkedRows = pendingRows.filter((r) => checkedKeys.has(r.key));
  const checkedUnits = checkedRows.reduce((sum, r) => sum + (r.item.quantity || 0), 0);

  const toggleRow = (key: string) => {
    setCheckedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    if (allChecked) {
      setCheckedKeys(new Set());
    } else {
      setCheckedKeys(new Set(pendingRows.map((r) => r.key)));
    }
  };

  const buildSelections = (rows: PendingRow[]) => {
    const grouped = new Map<string, string[]>();
    rows.forEach((r) => {
      const list = grouped.get(r.transfer.id) || [];
      list.push(r.item.id);
      grouped.set(r.transfer.id, list);
    });
    return Array.from(grouped.entries()).map(([transferId, itemIds]) => ({
      transferId,
      itemIds,
    }));
  };

  const handleReceiveSingle = (row: PendingRow) => {
    if (isReceiving) return;
    onReceiveSelected(buildSelections([row]));
  };

  const handleReceiveChecked = () => {
    if (checkedRows.length === 0 || isReceiving) return;
    onReceiveSelected(buildSelections(checkedRows));
  };

  const handleCheckAndReceiveAll = () => {
    if (pendingRows.length === 0 || isReceiving) return;
    setCheckedKeys(new Set(pendingRows.map((r) => r.key)));
    onReceiveSelected(buildSelections(pendingRows));
  };

  const headlineSummary = senderSummaries
    .map(
      (s) =>
        `${s.senderName} sent you ${s.totalUnits} batter${s.totalUnits === 1 ? 'y' : 'ies'} (${s.labels.join(', ')})`
    )
    .join(' · ');

  return (
    <div className="bg-amber-50/95 border-2 border-amber-400 rounded-xl shadow-md overflow-hidden">
      {/* Notification Header */}
      <div className="px-4 sm:px-5 py-3.5 bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 text-slate-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-950 text-amber-400 flex items-center justify-center shrink-0 shadow-xs">
            <BellRing className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-black tracking-tight">
                {headlineSummary}
              </h3>
              <span className="px-2 py-0.5 rounded-full text-[11px] font-extrabold bg-slate-950 text-amber-300">
                {pendingRows.length} Pending · {totalPendingUnits} Unit{totalPendingUnits === 1 ? '' : 's'}
              </span>
            </div>
            <p className="text-xs font-semibold text-slate-900/90 mt-0.5">
              Click <strong>Receive</strong> to review or edit battery details and automatically add to {activeBranch.shortName} stock.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleCheckAndReceiveAll}
          disabled={isReceiving}
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-extrabold text-white bg-emerald-700 hover:bg-emerald-800 disabled:opacity-60 rounded-lg shadow-sm transition-colors cursor-pointer shrink-0"
        >
          {isReceiving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <PackageCheck className="w-4 h-4" />
          )}
          <span>Receive All & Review ({totalPendingUnits})</span>
        </button>
      </div>

      {/* Checklist Rows */}
      <div className="p-3 sm:p-4 space-y-2.5 bg-white/90">
        <div className="flex items-center justify-between px-2 py-1 text-xs border-b border-amber-200 pb-2">
          <button
            type="button"
            onClick={toggleAll}
            className="inline-flex items-center gap-2 font-bold text-slate-800 hover:text-blue-700 cursor-pointer"
          >
            {allChecked ? (
              <CheckSquare className="w-4 h-4 text-emerald-600" />
            ) : (
              <Square className="w-4 h-4 text-slate-500" />
            )}
            <span>{allChecked ? 'Uncheck All Items' : `Check All (${pendingRows.length} items)`}</span>
          </button>

          <span className="text-[11px] font-semibold text-slate-600">
            Selected: <strong className="text-slate-900">{checkedRows.length}</strong> item(s) ·{' '}
            <strong className="text-emerald-700">+{checkedUnits} units</strong>
          </span>
        </div>

        <div className="space-y-2">
          {pendingRows.map((row) => {
            const { key, transfer, item } = row;
            const isChecked = checkedKeys.has(key);
            return (
              <div
                key={key}
                className={`flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 p-3 rounded-xl border transition-all ${
                  isChecked
                    ? 'bg-emerald-50/90 border-emerald-400 ring-1 ring-emerald-400/50 shadow-2xs'
                    : 'bg-white border-amber-200 hover:border-amber-400'
                }`}
              >
                <div
                  onClick={() => toggleRow(key)}
                  className="flex items-start gap-3 flex-1 cursor-pointer select-none"
                >
                  <div className="pt-0.5 shrink-0">
                    {isChecked ? (
                      <CheckSquare className="w-5 h-5 text-emerald-600" />
                    ) : (
                      <Square className="w-5 h-5 text-slate-400" />
                    )}
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-extrabold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                        {item.modelName}
                      </span>
                      <span className="text-xs font-black text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                        +{item.quantity} Batter{item.quantity === 1 ? 'y' : 'ies'}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-900 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                        <Truck className="w-3 h-3 text-blue-600" />
                        <span>{transfer.fromBranchName}</span>
                        <ArrowRight className="w-3 h-3 text-blue-500" />
                        <span>{transfer.toBranchName}</span>
                      </span>
                    </div>

                    <div className="flex items-center gap-3 flex-wrap text-[11px] text-slate-600">
                      <span>
                        Dispatched Date: <strong className="font-mono text-slate-800">{transfer.date}</strong>
                      </span>
                      {transfer.partner && (
                        <span>
                          Carrier / Person: <strong className="text-slate-800">{transfer.partner}</strong>
                        </span>
                      )}
                      {(item.notes || transfer.notes) && (
                        <span className="italic text-slate-600">
                          "{item.notes || transfer.notes}"
                        </span>
                      )}
                    </div>

                    {item.serialNos && item.serialNos.length > 0 && (
                      <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                        <Barcode className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                        {item.serialNos.map((sn) => (
                          <span
                            key={sn}
                            className="text-[10px] font-mono font-bold px-1.5 py-0.5 bg-blue-50 text-blue-800 border border-blue-200 rounded"
                          >
                            {sn}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 sm:shrink-0 pl-8 sm:pl-0">
                  <button
                    type="button"
                    onClick={() => handleReceiveSingle(row)}
                    disabled={isReceiving}
                    className="inline-flex items-center gap-1.5 text-xs font-extrabold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs transition-colors cursor-pointer"
                    title="Review / Edit details and receive into stock"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    <span>Receive Battery</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {/* Bottom Action Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-amber-200">
          <span className="text-[11px] text-slate-600 font-medium">
            Clicking Receive opens the battery details so you can verify or edit before saving into <strong>{activeBranch.name}</strong> stock.
          </span>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleReceiveChecked}
              disabled={checkedRows.length === 0 || isReceiving}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 text-xs font-extrabold text-white bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500 rounded-lg shadow-xs transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              {isReceiving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>
                Receive Checked ({checkedRows.length} · +{checkedUnits} units)
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
