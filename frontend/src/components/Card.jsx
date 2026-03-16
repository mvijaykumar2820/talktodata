import React, { useState } from 'react';
import { BarChart2, LineChart, PieChart, TableProperties } from 'lucide-react';
import Chart from './Chart';

/**
 * Dashboard card component displaying a query, its generated chart, and insights
 * @param {Object} props
 * @param {Object} props.item - Data item containing recipe, chartData, etc.
 * @param {number} props.index - Index for animation delay
 */
export default function Card({ item, index }) {
    const { recipe, chartData, userQuery, rowsAnalyzed } = item;
    const [activeChartType, setActiveChartType] = useState(recipe.chartType || 'bar');

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
        <div className="dashboard-card" style={{ animationDelay: `${index * 0.08}s` }}>
            <div className="card-top-accent" />

            <div className="card-header">
                <div className="card-type-badge">
                    {iconMap[activeChartType] || <BarChart2 size={12} />} {activeChartType} chart
                </div>
                <h3 className="card-title">{recipe.title || "Data Analysis"}</h3>
                {userQuery && <p className="card-query">"{userQuery}"</p>}
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

            <Chart recipe={{ ...recipe, chartType: activeChartType }} data={chartData} />

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
