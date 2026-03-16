import React from 'react';
import {
    ResponsiveContainer, BarChart, Bar, LineChart, Line, AreaChart, Area,
    PieChart, Pie, ScatterChart, Scatter, Cell, XAxis, YAxis, CartesianGrid,
    Tooltip, Legend
} from 'recharts';

const COLORS = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];

/**
 * Formats values based on metric type
 * @param {number} value
 * @param {string} metric
 * @returns {string|number} formatted value
 */
export function formatValue(value, metric) {
    if (value == null) return value;
    const v = parseFloat(value);
    if (isNaN(v)) return value;

    if (metric === 'Revenue' || metric === 'Acquisition_Cost') {
        if (Math.abs(v) >= 10000000) return `₹${(v / 10000000).toFixed(1)}Cr`;
        if (Math.abs(v) >= 100000) return `₹${(v / 100000).toFixed(1)}L`;
        if (Math.abs(v) >= 1000) return `₹${(v / 1000).toFixed(1)}K`;
        return `₹${v}`;
    }
    if (metric === 'ROI') return `${v.toFixed(2)}x`;
    if (metric === 'Engagement_Score') return v.toFixed(1);

    if (Math.abs(v) >= 1000000) return `${(v / 1000000).toFixed(1)}M`;
    if (Math.abs(v) >= 1000) return `${(v / 1000).toFixed(1)}K`;

    return v.toLocaleString();
}

/**
 * Custom tooltip component for Recharts
 */
const CustomTooltip = ({ active, payload, label, recipe }) => {
    if (active && payload && payload.length) {
        return (
            <div style={{
                background: 'var(--bg-2)', border: '1px solid var(--border-highlight)',
                borderRadius: '8px', padding: '10px 14px',
                fontFamily: 'var(--font-body)', fontSize: '13px', color: 'var(--text-primary)',
                boxShadow: 'var(--shadow-lg)'
            }}>
                <p style={{ margin: 0, marginBottom: 4, color: '#9898b8', fontSize: '11px' }}>{label}</p>
                {payload.map((entry, index) => (
                    <p key={index} style={{ margin: 0, color: entry.color || entry.fill || '#fff' }}>
                        {entry.name}: {formatValue(entry.value, entry.name === recipe.secondMetric ? recipe.secondMetric : recipe.metric)}
                    </p>
                ))}
            </div>
        );
    }
    return null;
};

/**
 * Renders the appropriate chart based on recipe.chartType
 * @param {Object} props
 * @param {Object} props.recipe
 * @param {Array} props.data
 */
export default function Chart({ recipe, data }) {
    if (!data || data.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 0' }}>
                <p style={{ color: 'var(--text-muted)' }}>No data available for this query.</p>
            </div>
        );
    }

    const { chartType, metric, secondMetric } = recipe;

    const commonProps = {
        data,
        margin: { top: 10, right: 10, left: -20, bottom: 0 }
    };

    const xAxis = <XAxis dataKey="name" tick={{ fill: "var(--text-muted)", fontSize: 11 }} angle={-30} textAnchor="end" height={50} />;
    const yAxis = <YAxis tick={{ fill: "var(--text-muted)", fontSize: 11 }} width={72} tickFormatter={(v) => formatValue(v, metric)} />;
    const grid = <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="4 4" vertical={false} />;
    const tooltip = <Tooltip content={<CustomTooltip recipe={recipe} />} cursor={{ fill: 'rgba(232,23,93,0.05)' }} />;

    if (chartType === 'table') {
        return (
            <div style={{ maxHeight: 300, overflowY: 'auto', paddingRight: 10 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
                    <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            <th style={{ padding: '8px 0' }}>#</th>
                            <th style={{ padding: '8px 0' }}>Name</th>
                            <th style={{ padding: '8px 0', textAlign: 'right' }}>{metric}</th>
                            {secondMetric && <th style={{ padding: '8px 0', textAlign: 'right' }}>{secondMetric}</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, i) => (
                            <tr key={i} style={{ borderBottom: '1px solid var(--bg-0)' }}>
                                <td style={{ padding: '10px 0', color: 'var(--text-ghost)' }}>{i + 1}</td>
                                <td style={{ padding: '10px 0' }}>{row.name}</td>
                                <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 500, color: 'var(--pink)' }}>
                                    {formatValue(row.value, metric)}
                                </td>
                                {secondMetric && (
                                    <td style={{ padding: '10px 0', textAlign: 'right', fontWeight: 500, color: 'var(--gold)' }}>
                                        {formatValue(row.value2, secondMetric)}
                                    </td>
                                )}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        );
    }

    if (chartType === 'line') {
        return (
            <ResponsiveContainer width="100%" height={290}>
                <LineChart {...commonProps}>
                    {grid}
                    {xAxis}
                    {yAxis}
                    {tooltip}
                    <Line type="monotone" dataKey="value" name={metric} stroke="#e8175d" strokeWidth={2.5} dot={{ fill: '#e8175d', r: 4 }} activeDot={{ r: 6 }} />
                    {secondMetric && <Line type="monotone" dataKey="value2" name={secondMetric} stroke="#ffd166" strokeWidth={2.5} dot={{ fill: '#ffd166', r: 4 }} />}
                </LineChart>
            </ResponsiveContainer>
        );
    }

    if (chartType === 'area') {
        return (
            <ResponsiveContainer width="100%" height={290}>
                <AreaChart {...commonProps}>
                    <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#e8175d" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="#e8175d" stopOpacity={0} />
                        </linearGradient>
                    </defs>
                    {grid}
                    {xAxis}
                    {yAxis}
                    {tooltip}
                    <Area type="monotone" dataKey="value" name={metric} stroke="#e8175d" fill="url(#colorValue)" />
                </AreaChart>
            </ResponsiveContainer>
        );
    }

    if (chartType === 'pie' || chartType === 'donut') {
        return (
            <ResponsiveContainer width="100%" height={290}>
                <PieChart>
                    {tooltip}
                    <Pie
                        data={data}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={115}
                        innerRadius={chartType === 'donut' ? 55 : 0}
                        label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                        labelLine={false}
                        stroke="var(--bg-2)"
                        strokeWidth={2}
                    >
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                    </Pie>
                </PieChart>
            </ResponsiveContainer>
        );
    }

    if (chartType === 'scatter') {
        return (
            <ResponsiveContainer width="100%" height={290}>
                <ScatterChart margin={{ top: 10, right: 10, left: 10, bottom: 10 }}>
                    {grid}
                    <XAxis type="number" dataKey="value2" name={secondMetric} tick={{ fill: "#52526a", fontSize: 11 }} tickFormatter={(v) => formatValue(v, secondMetric)} />
                    <YAxis type="number" dataKey="value" name={metric} tick={{ fill: "#52526a", fontSize: 11 }} width={72} tickFormatter={(v) => formatValue(v, metric)} />
                    {tooltip}
                    <Scatter name="Data" data={data} fill="#e8175d" opacity={0.7} />
                </ScatterChart>
            </ResponsiveContainer>
        );
    }

    // Default to Bar
    return (
        <ResponsiveContainer width="100%" height={290}>
            <BarChart {...commonProps}>
                {grid}
                {xAxis}
                {yAxis}
                {tooltip}
                <Bar dataKey="value" name={metric} radius={[4, 4, 0, 0]}>
                    {data.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                </Bar>
                {secondMetric && <Bar dataKey="value2" name={secondMetric} fill="#ffd166" radius={[4, 4, 0, 0]} />}
            </BarChart>
        </ResponsiveContainer>
    );
}
