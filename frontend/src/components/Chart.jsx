import React, { useMemo } from 'react';
import {
  Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, 
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
} from 'chart.js';
import { Line, Bar, Pie, Scatter } from 'react-chartjs-2';
import ReactDOM from 'react-dom/client';

ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement, 
  BarElement, ArcElement, Title, Tooltip, Legend, Filler
);

const COLORS = ['#ec4899', '#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4'];
const BORDER_COLORS = COLORS.map(c => c + 'aa');

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

export default function Chart({ recipe, data }) {
    if (!data || data.length === 0) {
        return (
            <div className="empty-state" style={{ padding: '40px 0' }}>
                <p style={{ color: 'var(--text-muted)' }}>No data available for this query.</p>
            </div>
        );
    }

    const [hoverInsight, setHoverInsight] = React.useState(null);
    const [insightLoading, setInsightLoading] = React.useState(false);
    const [insightExpanded, setInsightExpanded] = React.useState(false);
    const hoverTimeout = React.useRef(null);
    const lastHoveredPoint = React.useRef(null);
    const clickedPoint = React.useRef(null);

    const fetchInsight = async (dataPoint, metric, value, isDetailed = false) => {
        // Only fetch if we are fullscreen (can be checked by document.fullscreenElement)
        if (!document.fullscreenElement) return;

        const pointKey = `${dataPoint}-${metric}-${value}${isDetailed ? '-detailed' : ''}`;
        
        if (!isDetailed) {
            if (lastHoveredPoint.current === pointKey || clickedPoint.current) return;
            lastHoveredPoint.current = pointKey;
            setHoverInsight(null);
            setInsightExpanded(false);
        } else {
            if (clickedPoint.current === pointKey) return;
            clickedPoint.current = pointKey;
        }

        setInsightLoading(true);

        try {
            const api_key = sessionStorage.getItem('api_key') || 'backend-managed-key';
            const dataset = sessionStorage.getItem('dataset_id') || 'nykaa';
            
            const apiBase = import.meta.env.VITE_API_URL || '';
            const req = await fetch(`${apiBase}/api/insight`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    dataset,
                    api_key,
                    data_point: String(dataPoint),
                    metric: String(metric),
                    value: Number(value),
                    context: recipe.title || "Data Analysis",
                    is_detailed: isDetailed
                })
            });
            const res = await req.json();
            
            if (isDetailed && clickedPoint.current === pointKey) {
                setHoverInsight(res.insight);
                setInsightExpanded(true);
            } else if (!isDetailed && lastHoveredPoint.current === pointKey && !clickedPoint.current) {
                setHoverInsight(res.insight);
            }
        } catch (e) {
            console.error("Failed to fetch insight", e);
        } finally {
            if (isDetailed && clickedPoint.current === pointKey) setInsightLoading(false);
            if (!isDetailed && lastHoveredPoint.current === pointKey) setInsightLoading(false);
        }
    };

    const handleHover = (event, elements, chart) => {
        if (!document.fullscreenElement) return;
        
        if (elements && elements.length > 0) {
            const el = elements[0];
            const datasetIndex = el.datasetIndex;
            const index = el.index;
            
            let dataPoint, metric, value;
            
            if (chartType === 'scatter') {
                const pt = chart.data.datasets[datasetIndex].data[index];
                dataPoint = `Point ${index}`;
                metric = recipe.metric;
                value = pt.y;
            } else {
                dataPoint = chart.data.labels[index];
                metric = datasetIndex === 0 ? recipe.metric : recipe.secondMetric;
                value = chart.data.datasets[datasetIndex].data[index];
            }

            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            // Don't trigger hover if we have a clicked point expanded
            if (!clickedPoint.current) {
                hoverTimeout.current = setTimeout(() => {
                    fetchInsight(dataPoint, metric, value, false);
                }, 600); // 600ms hover delay
            }
        } else {
            if (hoverTimeout.current) clearTimeout(hoverTimeout.current);
            if (!clickedPoint.current) {
                lastHoveredPoint.current = null;
                setHoverInsight(null);
                setInsightLoading(false);
            }
        }
    };

    const handleClick = (event, elements, chart) => {
        if (!document.fullscreenElement) return;
        
        if (elements && elements.length > 0) {
            const el = elements[0];
            const datasetIndex = el.datasetIndex;
            const index = el.index;
            
            let dataPoint, metric, value;
            
            if (chartType === 'scatter') {
                const pt = chart.data.datasets[datasetIndex].data[index];
                dataPoint = `Point ${index}`;
                metric = recipe.metric;
                value = pt.y;
            } else {
                dataPoint = chart.data.labels[index];
                metric = datasetIndex === 0 ? recipe.metric : recipe.secondMetric;
                value = chart.data.datasets[datasetIndex].data[index];
            }

            // Immediately fetch detailed insight on click
            fetchInsight(dataPoint, metric, value, true);
        }
    };

    const { chartType, metric, secondMetric } = recipe;

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

    const labels = data.map(d => d.name);
    
    // Common Chart.js Options
    const commonOptions = {
        responsive: true,
        maintainAspectRatio: false,
        onHover: handleHover,
        onClick: handleClick,
        interaction: {
            mode: 'index',
            intersect: false,
        },
        plugins: {
            legend: {
                display: chartType === 'pie' || chartType === 'donut' || !!secondMetric,
                position: 'top',
                labels: {
                    color: '#9898b8',
                    font: { family: 'Inter, sans-serif', size: 12 },
                    usePointStyle: true,
                    boxWidth: 8
                }
            },
            tooltip: {
                backgroundColor: 'rgba(21, 21, 33, 0.9)',
                titleColor: '#9898b8',
                bodyColor: '#fff',
                borderColor: 'rgba(255,255,255,0.1)',
                borderWidth: 1,
                padding: 12,
                cornerRadius: 8,
                titleFont: { size: 13, family: 'Inter, sans-serif', weight: 'normal' },
                bodyFont: { size: 14, family: 'Inter, sans-serif', weight: 'bold' },
                callbacks: {
                    label: function(context) {
                        let label = context.dataset.label || '';
                        if (label) {
                            label += ': ';
                        }
                        const m = context.datasetIndex === 0 ? metric : secondMetric;
                        if (context.parsed.y !== null) {
                            label += formatValue(context.parsed.y, m);
                        }
                        return label;
                    }
                }
            }
        },
        scales: (chartType !== 'pie' && chartType !== 'donut' && chartType !== 'scatter') ? {
            x: {
                grid: { display: false, drawBorder: false },
                ticks: { color: '#9898b8', font: { size: 11 } }
            },
            y: {
                grid: { color: 'rgba(255,255,255,0.05)', drawBorder: false },
                beginAtZero: false,
                ticks: {
                    color: '#9898b8', 
                    font: { size: 11 },
                    callback: function(val) { return formatValue(val, metric); }
                }
            }
        } : {}
    };

    if (chartType === 'line' || chartType === 'area') {
        const isArea = chartType === 'area';
        const chartData = {
            labels,
            datasets: [
                {
                    label: metric,
                    data: data.map(d => d.value),
                    borderColor: '#e8175d',
                    backgroundColor: isArea ? 'rgba(232, 23, 93, 0.2)' : 'transparent',
                    fill: isArea,
                    tension: 0.4,
                    borderWidth: 3,
                    pointBackgroundColor: '#e8175d',
                    pointBorderColor: '#fff',
                    pointHoverRadius: 6,
                    pointRadius: 3
                }
            ]
        };
        if (secondMetric) {
            chartData.datasets.push({
                label: secondMetric,
                data: data.map(d => d.value2),
                borderColor: '#ffd166',
                backgroundColor: isArea ? 'rgba(255, 209, 102, 0.2)' : 'transparent',
                fill: isArea,
                tension: 0.4,
                borderWidth: 3,
                pointBackgroundColor: '#ffd166',
                pointBorderColor: '#fff',
                pointHoverRadius: 6,
                pointRadius: 3
            });
        }
        return (
            <div style={{ height: '100%', minHeight: '290px', width: '100%', position: 'relative' }}>
                {/* AI Insight Overlay */}
                {(hoverInsight || insightLoading) && document.fullscreenElement && (
                    <div style={{ position: 'absolute', bottom: '40px', right: '40px', width: insightExpanded ? '480px' : '320px', background: 'rgba(21, 21, 33, 0.95)', border: '1px solid var(--pink)', borderRadius: '12px', padding: '16px', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, animation: 'fadeSlideUp 0.3s ease-out', backdropFilter: 'blur(10px)', transition: 'width 0.3s ease' }}>
                        <div style={{ fontSize: '11px', color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: insightLoading ? 'pulse 1s infinite' : 'none' }}></span>
                                {insightExpanded ? 'Detailed AI Insight' : 'AI Insight'}
                            </div>
                            {insightExpanded && (
                                <button onClick={() => { clickedPoint.current = null; setInsightExpanded(false); setHoverInsight(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>×</button>
                            )}
                        </div>
                        {insightLoading ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{insightExpanded ? 'Generating deep analysis...' : 'Analyzing point...'}</div> : <div style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)' }}>{hoverInsight}</div>}
                        {!insightExpanded && !insightLoading && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right', fontStyle: 'italic' }}>Click point for detail</div>
                        )}
                    </div>
                )}
                <Line options={commonOptions} data={chartData} />
            </div>
        );
    }

    if (chartType === 'pie' || chartType === 'donut') {
        const chartData = {
            labels,
            datasets: [
                {
                    data: data.map(d => d.value),
                    backgroundColor: COLORS,
                    borderColor: '#11111a', // Match app background
                    borderWidth: 2,
                    hoverOffset: 10
                }
            ]
        };
        const pieOptions = {
            ...commonOptions,
            cutout: chartType === 'donut' ? '65%' : '0%',
            plugins: {
                ...commonOptions.plugins,
                tooltip: {
                    ...commonOptions.plugins.tooltip,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((acc, curr) => acc + curr, 0);
                            const perc = ((val / total) * 100).toFixed(1);
                            return `${formatValue(val, metric)} (${perc}%)`;
                        }
                    }
                }
            }
        };
        return (
            <div style={{ height: '100%', minHeight: '290px', width: '100%', position: 'relative' }}>
                {/* AI Insight Overlay */}
                {(hoverInsight || insightLoading) && document.fullscreenElement && (
                    <div style={{ position: 'absolute', bottom: '40px', right: '40px', width: insightExpanded ? '480px' : '320px', background: 'rgba(21, 21, 33, 0.95)', border: '1px solid var(--pink)', borderRadius: '12px', padding: '16px', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, animation: 'fadeSlideUp 0.3s ease-out', backdropFilter: 'blur(10px)', transition: 'width 0.3s ease' }}>
                        <div style={{ fontSize: '11px', color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: insightLoading ? 'pulse 1s infinite' : 'none' }}></span>
                                {insightExpanded ? 'Detailed AI Insight' : 'AI Insight'}
                            </div>
                            {insightExpanded && (
                                <button onClick={() => { clickedPoint.current = null; setInsightExpanded(false); setHoverInsight(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>×</button>
                            )}
                        </div>
                        {insightLoading ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{insightExpanded ? 'Generating deep analysis...' : 'Analyzing point...'}</div> : <div style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)' }}>{hoverInsight}</div>}
                        {!insightExpanded && !insightLoading && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right', fontStyle: 'italic' }}>Click point for detail</div>
                        )}
                    </div>
                )}
                <Pie options={pieOptions} data={chartData} />
            </div>
        );
    }

    if (chartType === 'scatter') {
        const chartData = {
            datasets: [
                {
                    label: 'Data',
                    data: data.map(d => ({ x: d.value2, y: d.value })),
                    backgroundColor: '#e8175d',
                    pointRadius: 6,
                    pointHoverRadius: 8
                }
            ]
        };
        const scatterOptions = {
            ...commonOptions,
            scales: {
                x: {
                    type: 'linear',
                    position: 'bottom',
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9898b8', callback: (val) => formatValue(val, secondMetric) }
                },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9898b8', callback: (val) => formatValue(val, metric) }
                }
            },
            plugins: {
                ...commonOptions.plugins,
                tooltip: {
                    ...commonOptions.plugins.tooltip,
                    callbacks: {
                        label: function(context) {
                            return `X: ${formatValue(context.parsed.x, secondMetric)}, Y: ${formatValue(context.parsed.y, metric)}`;
                        }
                    }
                }
            }
        };
        return (
            <div style={{ height: '100%', minHeight: '290px', width: '100%', position: 'relative' }}>
                {/* AI Insight Overlay */}
                {(hoverInsight || insightLoading) && document.fullscreenElement && (
                    <div style={{ position: 'absolute', bottom: '40px', right: '40px', width: insightExpanded ? '480px' : '320px', background: 'rgba(21, 21, 33, 0.95)', border: '1px solid var(--pink)', borderRadius: '12px', padding: '16px', color: '#fff', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', zIndex: 100, animation: 'fadeSlideUp 0.3s ease-out', backdropFilter: 'blur(10px)', transition: 'width 0.3s ease' }}>
                        <div style={{ fontSize: '11px', color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: insightLoading ? 'pulse 1s infinite' : 'none' }}></span>
                                {insightExpanded ? 'Detailed AI Insight' : 'AI Insight'}
                            </div>
                            {insightExpanded && (
                                <button onClick={() => { clickedPoint.current = null; setInsightExpanded(false); setHoverInsight(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>×</button>
                            )}
                        </div>
                        {insightLoading ? <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{insightExpanded ? 'Generating deep analysis...' : 'Analyzing point...'}</div> : <div style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)' }}>{hoverInsight}</div>}
                        {!insightExpanded && !insightLoading && (
                            <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right', fontStyle: 'italic' }}>Click point for detail</div>
                        )}
                    </div>
                )}
                <Scatter options={scatterOptions} data={chartData} />
            </div>
        );
    }

    // Default to Bar
    const barData = {
        labels,
        datasets: [
            {
                label: metric,
                data: data.map(d => d.value),
                backgroundColor: data.map((_, i) => COLORS[i % COLORS.length]),
                borderRadius: 4,
                borderSkipped: false
            }
        ]
    };
    if (secondMetric) {
        // If there are two metrics, don't use multi-color for the first one to avoid confusion
        barData.datasets[0].backgroundColor = '#e8175d';
        barData.datasets.push({
            label: secondMetric,
            data: data.map(d => d.value2),
            backgroundColor: '#ffd166',
            borderRadius: 4,
            borderSkipped: false
        });
    }

    return (
        <div style={{ height: '100%', minHeight: '290px', width: '100%', position: 'relative' }}>
            {/* AI Insight Overlay (only shows when fullscreen and hovering) */}
            {(hoverInsight || insightLoading) && document.fullscreenElement && (
                <div style={{
                    position: 'absolute',
                    bottom: '40px',
                    right: '40px',
                    width: insightExpanded ? '480px' : '320px',
                    background: 'rgba(21, 21, 33, 0.95)',
                    border: '1px solid var(--pink)',
                    borderRadius: '12px',
                    padding: '16px',
                    color: '#fff',
                    boxShadow: '0 10px 30px rgba(0,0,0,0.5)',
                    zIndex: 100,
                    animation: 'fadeSlideUp 0.3s ease-out',
                    backdropFilter: 'blur(10px)',
                    transition: 'width 0.3s ease'
                }}>
                    <div style={{ fontSize: '11px', color: 'var(--pink)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--gold)', animation: insightLoading ? 'pulse 1s infinite' : 'none' }}></span>
                            {insightExpanded ? 'Detailed AI Insight' : 'AI Insight'}
                        </div>
                        {insightExpanded && (
                            <button onClick={() => { clickedPoint.current = null; setInsightExpanded(false); setHoverInsight(null); }} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '16px' }}>×</button>
                        )}
                    </div>
                    {insightLoading ? (
                        <div style={{ fontSize: '13px', color: 'var(--text-muted)' }}>{insightExpanded ? 'Generating deep analysis...' : 'Analyzing point...'}</div>
                    ) : (
                        <div style={{ fontSize: '14px', lineHeight: '1.5', color: 'var(--text-primary)' }}>{hoverInsight}</div>
                    )}
                    {!insightExpanded && !insightLoading && (
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '8px', textAlign: 'right', fontStyle: 'italic' }}>Click point for detail</div>
                    )}
                </div>
            )}
            <Bar options={commonOptions} data={barData} />
        </div>
    );
}
