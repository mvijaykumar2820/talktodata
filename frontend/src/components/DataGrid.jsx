import React from 'react';

/**
 * Professional Data Grid for viewing raw campaign records
 * @param {Object} props
 * @param {Array} props.data - Array of row objects
 */
export default function DataGrid({ data }) {
    if (!data || data.length === 0) return (
        <div className="data-grid-empty">
            <p>No data available to display.</p>
        </div>
    );

    const columns = Object.keys(data[0]).filter(c => !c.startsWith('_'));

    return (
        <div className="data-grid-container">
            <div className="data-grid-wrapper">
                <table className="data-grid">
                    <thead>
                        <tr>
                            {columns.map(col => (
                                <th key={col}>{col.replace(/_/g, ' ')}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, i) => (
                            <tr key={i}>
                                {columns.map(col => (
                                    <td key={col} className={typeof row[col] === 'number' ? 'num' : ''}>
                                        {typeof row[col] === 'number'
                                            ? (col.toLowerCase().includes('revenue') || col.toLowerCase().includes('cost')
                                                ? `₹${row[col].toLocaleString()}`
                                                : row[col].toLocaleString())
                                            : row[col]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            <div className="data-grid-footer">
                Showing top {data.length} records • Scroll for more
            </div>
        </div>
    );
}
