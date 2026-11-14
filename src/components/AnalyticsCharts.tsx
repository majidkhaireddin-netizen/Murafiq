import React, { useMemo, useState } from 'react';
import { BreakdownItem, TrendBucketPoint } from '../utils/analytics';
import { BarChart3, Table2 } from 'lucide-react';

interface TrendTimelineChartProps {
  title: string;
  subtitle?: string;
  series: TrendBucketPoint[];
  mode: 'meetings' | 'tasks';
  language: 'ar' | 'en';
  testId?: string;
}

export const TrendTimelineChart: React.FC<TrendTimelineChartProps> = ({
  title,
  subtitle,
  series,
  mode,
  language,
  testId,
}) => {
  const isAr = language === 'ar';
  const [showTable, setShowTable] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const hasAnyValue = useMemo(
    () =>
      series.some((pt) =>
        mode === 'meetings'
          ? pt.heldMeetings > 0 || pt.scheduledMeetings > 0 || pt.cancelledMeetings > 0
          : pt.completedTasks > 0
      ),
    [series, mode]
  );

  const maxVal = useMemo(() => {
    let peak = 0;
    for (const pt of series) {
      if (mode === 'meetings') {
        const stack = pt.heldMeetings + pt.scheduledMeetings;
        if (stack > peak) peak = stack;
        if (pt.cancelledMeetings > peak) peak = pt.cancelledMeetings;
      } else {
        if (pt.completedTasks > peak) peak = pt.completedTasks;
      }
    }
    return Math.max(4, peak);
  }, [series, mode]);

  const activePoint =
    activeIndex !== null && series[activeIndex] ? series[activeIndex] : null;

  // Geometry for SVG (640 x 190)
  const width = 640;
  const height = 190;
  const padTop = 16;
  const padBottom = 28;
  const padX = 24;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBottom;

  const tickIndices = useMemo(() => {
    if (series.length <= 1) return [0];
    if (series.length <= 7) return series.map((_, i) => i);
    const mid = Math.floor((series.length - 1) / 2);
    return Array.from(new Set([0, mid, series.length - 1]));
  }, [series]);

  return (
    <div
      data-testid={testId}
      className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
    >
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div>
          <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">{title}</h4>
          {subtitle && (
            <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">{subtitle}</p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowTable((v) => !v)}
          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-stone-200 bg-stone-50 hover:bg-stone-100 text-[11px] font-medium text-stone-700 transition-colors shrink-0"
        >
          {showTable ? (
            <>
              <BarChart3 className="w-3.5 h-3.5 text-emerald-700" />
              <span>{isAr ? 'عرض الرسم البياني' : 'Show Chart'}</span>
            </>
          ) : (
            <>
              <Table2 className="w-3.5 h-3.5 text-stone-600" />
              <span>{isAr ? 'عرض جدول رقمي' : 'Tabular View'}</span>
            </>
          )}
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-[11px] text-stone-600 flex-wrap">
        {mode === 'meetings' ? (
          <>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-emerald-700 inline-block" />
              <span>{isAr ? 'اجتماعات منعقدة (منتهية)' : 'Held (Completed)'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-sky-500 inline-block" />
              <span>{isAr ? 'مجدولة / مسودة' : 'Scheduled / Draft'}</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-rose-400 inline-block" />
              <span>{isAr ? 'ملغاة' : 'Cancelled'}</span>
            </span>
          </>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-xs bg-emerald-700 inline-block" />
            <span>{isAr ? 'مهام منجزة (بتاريخ إنجاز موثق)' : 'Completed Tasks (verified completedAt)'}</span>
          </span>
        )}
      </div>

      {/* Active Point Live Readout */}
      <div className="min-h-[28px] px-2.5 py-1 rounded-lg bg-stone-50 border border-stone-200/80 text-[11px] text-stone-700 flex items-center justify-between gap-2 tabular-nums">
        {activePoint ? (
          mode === 'meetings' ? (
            <>
              <span className="font-bold text-stone-900">
                {isAr ? activePoint.labelAr : activePoint.labelEn}
              </span>
              <span className="text-stone-600">
                {isAr
                  ? `منعقدة: ${activePoint.heldMeetings} • مجدولة: ${activePoint.scheduledMeetings} • ملغاة: ${activePoint.cancelledMeetings}`
                  : `Held: ${activePoint.heldMeetings} • Scheduled: ${activePoint.scheduledMeetings} • Cancelled: ${activePoint.cancelledMeetings}`}
              </span>
            </>
          ) : (
            <>
              <span className="font-bold text-stone-900">
                {isAr ? activePoint.labelAr : activePoint.labelEn}
              </span>
              <span className="text-emerald-800 font-semibold">
                {isAr
                  ? `مهام منجزة: ${activePoint.completedTasks}`
                  : `Completed tasks: ${activePoint.completedTasks}`}
              </span>
            </>
          )
        ) : (
          <span className="text-stone-400">
            {isAr
              ? 'مرّر أو اختر نقطة زمنية لعرض التفاصيل الدقيقة'
              : 'Hover or focus a point to inspect exact counts'}
          </span>
        )}
      </div>

      {!hasAnyValue ? (
        <div className="py-8 text-center rounded-xl border border-dashed border-stone-200 bg-stone-50/50 text-xs text-stone-500">
          {isAr
            ? 'لا توجد بيانات زمنية مسجلة ضمن الفترة المختارة.'
            : 'No timestamped records in the selected period.'}
        </div>
      ) : showTable ? (
        <div className="overflow-x-auto border border-stone-200 rounded-xl">
          <table className="w-full text-[11px] text-start tabular-nums">
            <thead className="bg-stone-50 text-stone-600 border-b border-stone-200">
              <tr>
                <th className="py-2 px-3 text-start font-semibold">
                  {isAr ? 'الفترة الزمنية' : 'Bucket'}
                </th>
                {mode === 'meetings' ? (
                  <>
                    <th className="py-2 px-3 text-start font-semibold">
                      {isAr ? 'منعقدة' : 'Held'}
                    </th>
                    <th className="py-2 px-3 text-start font-semibold">
                      {isAr ? 'مجدولة/مسودة' : 'Scheduled'}
                    </th>
                    <th className="py-2 px-3 text-start font-semibold">
                      {isAr ? 'ملغاة' : 'Cancelled'}
                    </th>
                  </>
                ) : (
                  <th className="py-2 px-3 text-start font-semibold">
                    {isAr ? 'المهام المنجزة' : 'Completed Tasks'}
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {series.map((pt) => (
                <tr key={pt.bucketKey} className="hover:bg-stone-50/70">
                  <td className="py-1.5 px-3 font-medium text-stone-800">
                    {isAr ? pt.labelAr : pt.labelEn}
                  </td>
                  {mode === 'meetings' ? (
                    <>
                      <td className="py-1.5 px-3 text-emerald-800 font-semibold">
                        {pt.heldMeetings}
                      </td>
                      <td className="py-1.5 px-3 text-sky-700">{pt.scheduledMeetings}</td>
                      <td className="py-1.5 px-3 text-rose-700">{pt.cancelledMeetings}</td>
                    </>
                  ) : (
                    <td className="py-1.5 px-3 text-emerald-800 font-semibold">
                      {pt.completedTasks}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div dir="ltr" className="w-full overflow-hidden">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-44 select-none"
            role="img"
            aria-label={title}
          >
            {/* Horizontal grid lines */}
            {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
              const y = padTop + plotH * (1 - ratio);
              const val = Math.round(maxVal * ratio);
              return (
                <g key={ratio}>
                  <line
                    x1={padX}
                    y1={y}
                    x2={width - padX}
                    y2={y}
                    stroke="#e7e5e4"
                    strokeWidth="1"
                    strokeDasharray={ratio === 0 ? undefined : '3 3'}
                  />
                  <text
                    x={padX - 6}
                    y={y + 3}
                    textAnchor="end"
                    fontSize="9"
                    fill="#78716c"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {mode === 'meetings' ? (
              series.map((pt, idx) => {
                const slotW = plotW / Math.max(1, series.length);
                const barW = Math.min(24, Math.max(5, slotW * 0.56));
                const centerX = padX + slotW * idx + slotW / 2;
                const x = centerX - barW / 2;

                const heldH = (pt.heldMeetings / maxVal) * plotH;
                const schedH = (pt.scheduledMeetings / maxVal) * plotH;
                const baseY = padTop + plotH;
                const heldY = baseY - heldH;
                const schedY = heldY - schedH;
                const isActive = activeIndex === idx;

                return (
                  <g
                    key={pt.bucketKey}
                    tabIndex={0}
                    role="button"
                    aria-label={`${pt.labelAr}: منعقدة ${pt.heldMeetings}, مجدولة ${pt.scheduledMeetings}`}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onFocus={() => setActiveIndex(idx)}
                    onMouseLeave={() => setActiveIndex(null)}
                    className="cursor-pointer outline-hidden"
                  >
                    {isActive && (
                      <rect
                        x={centerX - slotW / 2}
                        y={padTop}
                        width={slotW}
                        height={plotH}
                        fill="#f5f5f4"
                        rx="4"
                      />
                    )}
                    {pt.scheduledMeetings > 0 && (
                      <rect
                        x={x}
                        y={schedY}
                        width={barW}
                        height={Math.max(2, schedH)}
                        fill="#0ea5e9"
                        rx="2"
                      />
                    )}
                    {pt.heldMeetings > 0 && (
                      <rect
                        x={x}
                        y={heldY}
                        width={barW}
                        height={Math.max(2, heldH)}
                        fill="#047857"
                        rx="2"
                      />
                    )}
                    {pt.cancelledMeetings > 0 && (
                      <circle
                        cx={centerX}
                        cy={baseY - (pt.cancelledMeetings / maxVal) * plotH}
                        r="3"
                        fill="#fb7185"
                      />
                    )}
                  </g>
                );
              })
            ) : (
              <>
                {series.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="#047857"
                    strokeWidth="2.2"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    points={series
                      .map((pt, idx) => {
                        const x =
                          padX +
                          (idx / Math.max(1, series.length - 1)) * plotW;
                        const y = padTop + plotH - (pt.completedTasks / maxVal) * plotH;
                        return `${x},${y}`;
                      })
                      .join(' ')}
                  />
                )}
                {series.map((pt, idx) => {
                  const x =
                    series.length === 1
                      ? padX + plotW / 2
                      : padX + (idx / Math.max(1, series.length - 1)) * plotW;
                  const y = padTop + plotH - (pt.completedTasks / maxVal) * plotH;
                  const isActive = activeIndex === idx;
                  return (
                    <g
                      key={pt.bucketKey}
                      tabIndex={0}
                      role="button"
                      aria-label={`${pt.labelAr}: ${pt.completedTasks}`}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onFocus={() => setActiveIndex(idx)}
                      onMouseLeave={() => setActiveIndex(null)}
                      className="cursor-pointer outline-hidden"
                    >
                      <circle
                        cx={x}
                        cy={y}
                        r={isActive ? 5.5 : 3.5}
                        fill={pt.completedTasks > 0 ? '#047857' : '#d6d3d1'}
                        stroke="#ffffff"
                        strokeWidth="1.5"
                      />
                    </g>
                  );
                })}
              </>
            )}

            {/* X-axis tick labels */}
            {tickIndices.map((idx) => {
              const pt = series[idx];
              if (!pt) return null;
              const x =
                mode === 'meetings'
                  ? padX + (plotW / Math.max(1, series.length)) * idx + plotW / Math.max(1, series.length) / 2
                  : series.length === 1
                  ? padX + plotW / 2
                  : padX + (idx / Math.max(1, series.length - 1)) * plotW;
              return (
                <text
                  key={pt.bucketKey}
                  x={x}
                  y={height - 8}
                  textAnchor="middle"
                  fontSize="9.5"
                  fill="#57534e"
                >
                  {isAr ? pt.labelAr : pt.labelEn}
                </text>
              );
            })}
          </svg>
        </div>
      )}
    </div>
  );
};

interface DistributionBarListProps<K extends string> {
  title: string;
  subtitle?: string;
  items: BreakdownItem<K>[];
  language: 'ar' | 'en';
  barColorClass?: (key: K) => string;
  onItemClick?: (item: BreakdownItem<K>) => void;
  hideZeroRows?: boolean;
}

export function DistributionBarList<K extends string>({
  title,
  subtitle,
  items,
  language,
  barColorClass,
  onItemClick,
  hideZeroRows = false,
}: DistributionBarListProps<K>) {
  const isAr = language === 'ar';
  const visibleItems = hideZeroRows ? items.filter((i) => i.count > 0) : items;
  const totalCount = items.reduce((sum, i) => sum + i.count, 0);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
      <div>
        <h4 className="font-heading font-bold text-xs sm:text-sm text-stone-900">{title}</h4>
        {subtitle && (
          <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">{subtitle}</p>
        )}
      </div>

      {totalCount === 0 || visibleItems.length === 0 ? (
        <p className="text-xs text-stone-400 py-4 text-center">
          {isAr ? 'لا توجد سجلات مصنفة في هذا القسم.' : 'No categorized records in this section.'}
        </p>
      ) : (
        <div className="space-y-2.5">
          {visibleItems.map((item) => {
            const fillColor = barColorClass ? barColorClass(item.key) : 'bg-emerald-700';
            const content = (
              <div className="space-y-1 w-full text-start">
                <div className="flex items-center justify-between text-[11px] gap-2">
                  <span className="font-medium text-stone-800 truncate">
                    {isAr ? item.labelAr : item.labelEn}
                  </span>
                  <span className="text-stone-600 tabular-nums shrink-0 font-semibold">
                    {item.count}{' '}
                    <span className="text-stone-400 font-normal">({item.sharePercent}%)</span>
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-stone-100 overflow-hidden">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${fillColor}`}
                    style={{ width: `${Math.max(item.count > 0 ? 3 : 0, item.sharePercent)}%` }}
                  />
                </div>
              </div>
            );

            if (onItemClick && item.count > 0) {
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onItemClick(item)}
                  className="w-full block hover:bg-stone-50 rounded-lg p-1 -m-1 transition-colors"
                >
                  {content}
                </button>
              );
            }

            return <div key={item.key}>{content}</div>;
          })}
        </div>
      )}
    </div>
  );
}
