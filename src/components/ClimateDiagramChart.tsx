import { useEffect, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Loader2 } from 'lucide-react';
import {
  fetchClimateNormalsClient,
  getCachedClimateNormals,
  type ClimateNormalsResponse,
  type MonthlyNormalPoint,
} from '../lib/climateNormals';

interface ClimateDiagramChartProps {
  lat: number;
  lon: number;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    payload?: MonthlyNormalPoint;
  }>;
}

function SeasonalTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;

  return (
    <div className="rounded border border-slate-700 bg-slate-950/95 px-2.5 py-1.5 text-[11px] shadow-lg backdrop-blur-sm">
      <p className="font-semibold text-slate-100">{point.monthFull}</p>
      <div className="mt-1 space-y-0.5 font-mono tabular-nums">
        <p className="text-amber-300">
          Temp. moy. : {point.tempC.toFixed(1)} °C
        </p>
        <p className="text-sky-300">Précip. : {point.precipMm} mm</p>
      </div>
    </div>
  );
}

export function ClimateDiagramChart({ lat, lon }: ClimateDiagramChartProps) {
  const cachedInitial = getCachedClimateNormals(lat, lon);
  const [data, setData] = useState<ClimateNormalsResponse | null>(
    cachedInitial
  );
  const [loading, setLoading] = useState(!cachedInitial);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = getCachedClimateNormals(lat, lon);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetchClimateNormalsClient(lat, lon, controller.signal)
      .then((json) => {
        if (!controller.signal.aborted) {
          setData(json);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof Error
            ? err.message
            : 'Diagramme climatique indisponible'
        );
        setLoading(false);
      });

    return () => controller.abort();
  }, [lat, lon]);

  return (
    <div className="mt-2.5 border-t border-slate-800 pt-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-200">
          Diagramme saisonnier ({data?.period ?? 'normales'})
        </span>
        {data && !loading && (
          <span className="font-mono text-[10px] text-slate-400 tabular-nums">
            {data.annualTempC.toFixed(1)} °C · {data.annualPrecipMm} mm/an
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex h-[164px] w-full items-center justify-center gap-2 rounded border border-slate-800/80 bg-slate-900/40 text-xs text-slate-400">
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-cyan-400"
            aria-hidden="true"
          />
          <span>Calcul des normales mensuelles…</span>
        </div>
      ) : error || !data ? (
        <div className="flex h-[110px] w-full items-center justify-center rounded border border-slate-800/80 bg-slate-900/40 px-3 text-center text-[11px] text-slate-400">
          {error || 'Normales saisonnières indisponibles pour ce point.'}
        </div>
      ) : (
        <>
          <div className="h-[164px] w-full min-w-[260px]">
            <ResponsiveContainer
              width="100%"
              height={164}
              minWidth={260}
              minHeight={164}
            >
              <ComposedChart
                data={data.months}
                margin={{ top: 8, right: 0, left: -8, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="#1e293b"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="month"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickFormatter={(value: string) => value.slice(0, 1)}
                  axisLine={{ stroke: '#334155' }}
                  tickLine={false}
                  interval={0}
                />
                <YAxis
                  yAxisId="temp"
                  tick={{ fill: '#fbbf24', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={38}
                  tickFormatter={(v: number) => `${v}°`}
                />
                <YAxis
                  yAxisId="precip"
                  orientation="right"
                  tick={{ fill: '#38bdf8', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  width={34}
                  tickFormatter={(v: number) => `${v}`}
                />
                <Tooltip
                  content={<SeasonalTooltip />}
                  cursor={{ fill: 'rgba(148, 163, 184, 0.08)' }}
                />
                <Bar
                  yAxisId="precip"
                  dataKey="precipMm"
                  name="Précipitations (mm)"
                  fill="#0ea5e9"
                  fillOpacity={0.55}
                  radius={[2, 2, 0, 0]}
                  barSize={12}
                  isAnimationActive={false}
                />
                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="tempC"
                  name="Température (°C)"
                  stroke="#fb923c"
                  strokeWidth={2}
                  dot={{ r: 2, fill: '#fb923c', strokeWidth: 0 }}
                  activeDot={{ r: 4, fill: '#fdba74', stroke: '#090d16' }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-0.5 w-3 bg-orange-400"
                  aria-hidden="true"
                />
                Température (°C)
              </span>
              <span className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-[1px] bg-sky-500/70"
                  aria-hidden="true"
                />
                Précipitations (mm)
              </span>
            </div>
            <span>{data.source}</span>
          </div>
        </>
      )}
    </div>
  );
}
