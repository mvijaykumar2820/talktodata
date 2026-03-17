import React, { useState, useRef, useEffect } from 'react';
import { BarChart2, LineChart, PieChart, TableProperties, Maximize2, Minimize2, Download } from 'lucide-react';
import Chart from './Chart';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

/**
 * Dashboard card component displaying a query, its generated chart, and insights
 * @param {Object} props
 * @param {Object} props.item - Data item containing recipe, chartData, etc.
 * @param {number} props.index - Index for animation delay
 */
export default function Card({ item, index }) {
    const { recipe, chartData, userQuery, rowsAnalyzed } = item;
    const [activeChartType, setActiveChartType] = useState(recipe.chartType || 'bar');
    const [isMaximized, setIsMaximized] = useState(false);
    const cardRef = useRef(null);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsMaximized(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
    }, []);

    const toggleMaximize = () => {
        if (!document.fullscreenElement) {
            if (cardRef.current?.requestFullscreen) {
                cardRef.current.requestFullscreen().catch(err => {
                    console.error("Error attempting to enable fullscreen:", err);
                });
            }
        } else {
            if (document.exitFullscreen) {
                document.exitFullscreen();
            }
        }
    };

    const [isDownloading, setIsDownloading] = useState(false);

    const downloadPDF = async () => {
        if (!cardRef.current || isDownloading) return;
        setIsDownloading(true);
        try {
            // Wait a bit longer for Chart.js to re-render with light theme
            await new Promise(r => setTimeout(r, 400));
            
            const canvas = await html2canvas(cardRef.current, {
                scale: 2,
                backgroundColor: '#27272a', // Exact card background
                onclone: (clonedDoc) => {
                    const style = clonedDoc.createElement('style');
                    style.innerHTML = `
                        .btn-ghost { display: none !important; } /* Hide action buttons in PDF */
                        .chart-switcher { display: none !important; }
                    `;
                    clonedDoc.head.appendChild(style);
                }
            });
            
            const imgData = canvas.toDataURL('image/png');
            let pdfOrientation = canvas.width > canvas.height ? 'landscape' : 'portrait';
            
            const pdf = new jsPDF({
                orientation: pdfOrientation,
                unit: 'px',
                format: [canvas.width, canvas.height]
            });
            
            pdf.addImage(imgData, 'PNG', 0, 0, canvas.width, canvas.height);
            pdf.save(`Report_${recipe.title ? recipe.title.replace(/\\s+/g, '_') : 'Data_Analysis'}.pdf`);
        } catch (err) {
            console.error("Failed to generate PDF", err);
        } finally {
            setIsDownloading(false);
        }
    };

    // Determine allowed chart types based on data
    const allowedTypes = ['table'];

    if (recipe.groupBy !== null) {
        allowedTypes.push('bar', 'line', 'pie', 'donut');
        if (recipe.groupBy.includes('Date') || recipe.groupBy.includes('month') || recipe.groupBy.includes('quarter')) {
            allowedTypes.push('area');
        }
    }

    if (recipe.secondMetric !== null && recipe.groupBy === null) {
        allowedTypes.push('scatter');
    }

    if (!allowedTypes.includes(activeChartType)) {
        allowedTypes.push(activeChartType);
    }
    const uniqueAllowed = [...new Set(allowedTypes)];

    const iconMap = {
        'bar': <BarChart2 size={12} />,
        'line': <LineChart size={12} />,
        'area': <LineChart size={12} />,
        'pie': <PieChart size={12} />,
        'donut': <PieChart size={12} />,
        'table': <TableProperties size={12} />,
        'scatter': <BarChart2 size={12} />
    };

    return (
        <div ref={cardRef} className={`dashboard-card ${isMaximized ? 'fullscreen' : ''}`} style={!isMaximized ? { animationDelay: `${index * 0.08}s` } : {}}>
            <div className="card-top-accent" />

            <div className="card-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <div className="card-type-badge">
                        {iconMap[activeChartType] || <BarChart2 size={12} />} {activeChartType} chart
                    </div>
                    <h3 className="card-title">{recipe.title || "Data Analysis"}</h3>
                    {userQuery && <p className="card-query">"{userQuery}"</p>}
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                        className="btn-ghost" 
                        onClick={downloadPDF}
                        disabled={isDownloading}
                        style={{ padding: '6px', opacity: isDownloading ? 0.5 : 1 }}
                        title="Download PDF Report"
                    >
                        <Download size={16} />
                    </button>
                    <button 
                        className="btn-ghost" 
                        onClick={toggleMaximize}
                        style={{ padding: '6px' }}
                        title={isMaximized ? "Minimize" : "Maximize"}
                    >
                        {isMaximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    </button>
                </div>
            </div>

            {uniqueAllowed.length > 1 && (
                <div className="chart-switcher">
                    {uniqueAllowed.map((type) => (
                        <button
                            key={type}
                            className={`switcher-btn ${activeChartType === type ? 'active' : ''}`}
                            onClick={() => setActiveChartType(type)}
                        >
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                        </button>
                    ))}
                </div>
            )}

            <div className="card-chart-container" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <Chart recipe={{ ...recipe, chartType: activeChartType }} data={chartData} isExporting={isDownloading} />
            </div>

            {recipe.insight && (
                <div className="card-insight">
                    <div className="insight-label">Insight</div>
                    <div className="insight-text">{recipe.insight}</div>
                </div>
            )}

            <div className="card-meta">
                <div className="meta-pill">{recipe.aggregation} of {recipe.metric}</div>
                {recipe.groupBy && <div className="meta-pill">by {recipe.groupBy.replace(/_/g, ' ')}</div>}
                {recipe.secondMetric && <div className="meta-pill">and {recipe.secondMetric}</div>}
            </div>

            {rowsAnalyzed !== undefined && (
                <p className="card-rows-analyzed">
                    Analyzed {rowsAnalyzed.toLocaleString()} records
                </p>
            )}
        </div>
    );
}
