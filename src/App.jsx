import React, { useState, useEffect, useRef } from 'react';
import Card from './components/Card';
import DataGrid from './components/DataGrid';
import { fetchKPIs, submitQuery, uploadCSV, fetchData } from './utils/api';
import { Send, Upload, Trash2, KeyRound, Plus, MessageSquare, History } from 'lucide-react';
import './App.css';

const exampleQueries = [
    "Revenue by campaign type",
    "Monthly conversion trend",
    "Best ROI by channel",
    "Top 5 campaigns by revenue",
    "Language revenue split",
    "Compare ROI vs acquisition cost",
    "Quarterly impressions trend",
    "Hindi campaign performance"
];

function SkeletonCard() {
    return (
        <div className="skeleton-card">
            <div className="skeleton-line" style={{ width: '40%' }} />
            <div className="skeleton-line" style={{ width: '70%', height: 16 }} />
            <div className="skeleton-line" style={{ width: '30%' }} />
            <div style={{ height: 200, background: 'var(--bg-3)', borderRadius: 8, marginTop: 16 }} />
        </div>
    );
}

const STORAGE_KEY = 'nykaa_bi_sessions';

export default function App() {
    const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('geminiApiKey') || 'backend-managed-key');
    const [kpis, setKpis] = useState(null);

    // Multi-session state
    const [sessions, setSessions] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    });
    const [currentSessionId, setCurrentSessionId] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            return (Array.isArray(parsed) && parsed.length > 0) ? parsed[0].id : null;
        } catch (e) {
            return null;
        }
    });

    // Derived current session data
    const activeSession = sessions.find(s => s.id === currentSessionId) || {
        charts: [],
        history: [],
        datasetKey: 'nykaa',
        datasetLabel: 'Nykaa Campaigns'
    };

    const charts = activeSession.charts;
    const history = activeSession.history;
    const datasetKey = activeSession.datasetKey;
    const datasetLabel = activeSession.datasetLabel;

    const [inputVal, setInputVal] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [viewMode, setViewMode] = useState('insights'); // 'insights' or 'data'
    const [rawData, setRawData] = useState([]);
    const fileInputRef = useRef(null);

    // Sync to localStorage
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }, [sessions]);

    useEffect(() => {
        if (apiKey) {
            sessionStorage.setItem('geminiApiKey', apiKey);
            loadKPIs();
        }
    }, [apiKey]);

    useEffect(() => {
        if (viewMode === 'data') {
            loadData();
        }
    }, [viewMode, currentSessionId, datasetKey]);

    const loadKPIs = async () => {
        try {
            const data = await fetchKPIs();
            setKpis(data);
        } catch (err) {
            console.warn('Could not load KPIs:', err);
        }
    };

    const loadData = async () => {
        setLoading(true);
        try {
            const data = await fetchData(datasetKey);
            setRawData(data);
        } catch (err) {
            setError('Failed to fetch dataset records.');
        } finally {
            setLoading(false);
        }
    };

    const updateCurrentSession = (updatedFields) => {
        setSessions(prev => prev.map(s =>
            s.id === currentSessionId ? { ...s, ...updatedFields } : s
        ));
    };

    const startNewChat = () => {
        const newSession = {
            id: Date.now(),
            title: 'New Chat',
            charts: [],
            history: [],
            datasetKey: 'nykaa',
            datasetLabel: 'Nykaa Campaigns',
            createdAt: new Date().toISOString()
        };
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        setViewMode('insights');
        setError('');
        setInputVal('');
    };

    const deleteSession = (id, e) => {
        e.stopPropagation();
        const filtered = sessions.filter(s => s.id !== id);
        setSessions(filtered);
        if (currentSessionId === id) {
            setCurrentSessionId(filtered.length > 0 ? filtered[0].id : null);
        }
    };

    const handleSubmit = async (e, queryOverride = null) => {
        if (e) e.preventDefault();
        const query = queryOverride || inputVal;
        if (!query.trim()) return;

        let sessionId = currentSessionId;

        // If no sessions exist, start one
        if (!sessionId) {
            const newSess = {
                id: Date.now(),
                title: query.slice(0, 30) + (query.length > 30 ? '...' : ''),
                charts: [],
                history: [],
                datasetKey: 'nykaa',
                datasetLabel: 'Nykaa Campaigns',
                createdAt: new Date().toISOString()
            };
            setSessions([newSess]);
            setCurrentSessionId(newSess.id);
            sessionId = newSess.id;
        }

        setLoading(true);
        setError('');
        const currentInput = query;
        if (!queryOverride) setInputVal('');

        try {
            const response = await submitQuery(currentInput, history, apiKey, datasetKey);

            if (!response.canAnswer) {
                setError(response.reason || 'Cannot answer this question based on the dataset.');
            } else {
                const newItem = {
                    id: Date.now(),
                    recipe: response.recipe,
                    chartData: response.chartData,
                    userQuery: currentInput,
                    rowsAnalyzed: response.rowsAnalyzed
                };

                setSessions(prev => prev.map(s => {
                    if (s.id === sessionId) {
                        const isNew = s.charts.length === 0;
                        return {
                            ...s,
                            title: isNew ? currentInput.slice(0, 30) + (currentInput.length > 30 ? '...' : '') : s.title,
                            charts: [newItem, ...s.charts],
                            history: [...s.history, { question: currentInput, recipe: response.recipe }]
                        };
                    }
                    return s;
                }));
            }
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        if (!currentSessionId) startNewChat();

        setLoading(true);
        setError('');
        try {
            const response = await uploadCSV(file);
            updateCurrentSession({
                datasetKey: response.key,
                datasetLabel: file.name,
                charts: [],
                history: []
            });
        } catch (err) {
            setError(`Upload failed: ${err.message}`);
        } finally {
            setLoading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleClear = () => {
        updateCurrentSession({ charts: [], history: [] });
    };

    // Setup screen bypassed (using backend .env)
    // if (!apiKey) {
    //     return <Setup onSubmit={setApiKey} />;
    // }

    return (
        <div className="app-container">
            <aside className="sidebar">
                <div className="sidebar-header">
                    <button className="new-chat-btn" onClick={startNewChat}>
                        <Plus size={18} /> New Chat
                    </button>

                    <div className="sidebar-nav">
                        <button
                            className={`nav-item ${viewMode === 'insights' ? 'active' : ''}`}
                            onClick={() => setViewMode('insights')}
                        >
                            <span className="dot" /> Insights
                        </button>
                        <button
                            className={`nav-item ${viewMode === 'data' ? 'active' : ''}`}
                            onClick={() => setViewMode('data')}
                        >
                            <span className="dot" /> Data View
                        </button>
                    </div>
                </div>

                <div className="history-section">
                    <div className="history-label">
                        <History size={12} /> Recent Analytics
                    </div>
                    {sessions.map(s => (
                        <div
                            key={s.id}
                            className={`history-item ${currentSessionId === s.id ? 'active' : ''}`}
                            onClick={() => { setCurrentSessionId(s.id); setError(''); }}
                        >
                            <MessageSquare size={14} />
                            <span className="history-title">{s.title}</span>
                            <button className="del-session" onClick={(e) => deleteSession(s.id, e)}>
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                    {sessions.length === 0 && (
                        <p className="history-empty">No charts yet</p>
                    )}
                </div>

                <div className="sidebar-footer">
                    <div style={{ opacity: 0.5, fontSize: 11 }}>TalktoData</div>
                </div>
            </aside>

            <main className="chat-container">
                <header className="app-header">
                    <div className="header-brand">
                        <span style={{ fontSize: 24 }}>✨</span>
                        <div>
                            <h1 className="header-brand-name">TalktoData</h1>
                            <div className="header-brand-sub">Marketing Intelligence</div>
                        </div>
                    </div>
                    <div className="header-actions">
                        <div className="data-badge">
                            <span style={{ fontSize: 10 }}>💿</span>
                            {datasetLabel}
                            {kpis && datasetKey === 'nykaa' && ` • ${kpis.totalCampaigns?.toLocaleString() || 0} rows`}
                        </div>

                        <input
                            type="file"
                            accept=".csv"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            style={{ display: 'none' }}
                            id="csv-upload"
                        />
                        <label htmlFor="csv-upload" className="upload-btn">
                            <Upload size={14} /> Upload CSV
                        </label>

                        <button onClick={() => { setApiKey(''); sessionStorage.removeItem('geminiApiKey'); }} className="btn-ghost" style={{ padding: '6px' }} title="Change API Key">
                            <KeyRound size={14} />
                        </button>
                    </div>
                </header>

                <div className={`scroll-area ${viewMode === 'data' ? 'data-view' : ''}`}>
                    {viewMode === 'insights' ? (
                        <>
                            {kpis && datasetKey === 'nykaa' && charts.length === 0 && (
                                <div className="kpi-bar">
                                    <div className="kpi-grid">
                                        <div className="kpi-card">
                                            <div className="kpi-label">Total Revenue</div>
                                            <div className="kpi-value">
                                                {kpis.totalRevenue >= 10000000 ? `₹${(kpis.totalRevenue / 10000000).toFixed(1)}Cr` :
                                                    kpis.totalRevenue >= 100000 ? `₹${(kpis.totalRevenue / 100000).toFixed(1)}L` :
                                                        `₹${(kpis.totalRevenue || 0).toLocaleString()}`}
                                            </div>
                                            <div className="kpi-desc">Generated INR</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">Avg ROI</div>
                                            <div className="kpi-value">{kpis.avgROI || 0}x</div>
                                            <div className="kpi-desc">Across campaigns</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">Top Language</div>
                                            <div className="kpi-value">{kpis.topLanguage || '-'}</div>
                                            <div className="kpi-desc">By ROI</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">Top Channel</div>
                                            <div className="kpi-value">{kpis.topChannel || '-'}</div>
                                            <div className="kpi-desc">By Revenue</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">TOTAL CAMPAIGNS</div>
                                            <div className="kpi-value">{(kpis.totalCampaigns || 0).toLocaleString()}</div>
                                            <div className="kpi-desc">Campaigns analyzed</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">AVG ENGAGEMENT</div>
                                            <div className="kpi-value">{kpis.avgEngagement || 0}</div>
                                            <div className="kpi-desc">Engagement score</div>
                                        </div>
                                        <div className="kpi-card">
                                            <div className="kpi-label">BEST CAMPAIGN</div>
                                            <div className="kpi-value">{kpis.bestCampaignId || '-'}</div>
                                            <div className="kpi-desc">Highest revenue</div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="main-content">
                                {error && (
                                    <div className="error-box">
                                        <span>⚠️</span> {error}
                                    </div>
                                )}

                                {charts.length === 0 && !loading && (
                                    <div className="empty-state">
                                        <div className="empty-icon">✨</div>
                                        <h2 className="empty-title">How can I help you today?</h2>
                                        <p className="empty-subtitle">
                                            Ask me to analyze your marketing performance, compare channels, or visualize campaign ROI.
                                        </p>
                                    </div>
                                )}

                                {charts.length > 0 && (
                                    <div className="charts-grid">
                                        {[...charts].reverse().map((item, i) => (
                                            <Card key={item.id} item={item} index={i} />
                                        ))}
                                    </div>
                                )}

                                {loading && <SkeletonCard />}
                            </div>
                        </>
                    ) : (
                        <DataGrid data={rawData} />
                    )}
                </div>

                {viewMode === 'insights' && (
                    <div className="chat-section">
                        <div className="chat-box">
                            <form onSubmit={(e) => handleSubmit(e)} className="chat-input-row">
                                <textarea
                                    className="chat-textarea"
                                    rows={1}
                                    style={{ minHeight: '52px', overflowY: 'hidden' }}
                                    placeholder="Chat with TalktoData..."
                                    value={inputVal}
                                    onChange={(e) => {
                                        setInputVal(e.target.value);
                                        e.target.style.height = 'auto';
                                        e.target.style.height = (e.target.scrollHeight) + 'px';
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && !e.shiftKey) {
                                            e.preventDefault();
                                            handleSubmit(e);
                                        }
                                    }}
                                />
                                <button type="submit" className="chat-submit-btn" disabled={!inputVal.trim() || loading} style={{ borderRadius: '50%', width: '42px', height: '42px', padding: 0, justifyContent: 'center' }}>
                                    {loading ? <div className="spinner" /> : <Send size={18} />}
                                </button>
                            </form>

                            {!currentSessionId || (history.length === 0) ? (
                                <div className="chips-row" style={{ marginTop: '8px', justifyContent: 'center' }}>
                                    {exampleQueries.slice(0, 4).map((q) => (
                                        <div key={q} className="chip" onClick={() => handleSubmit(null, q)}>
                                            {q}
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
