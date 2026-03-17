import React, { useState, useEffect, useRef } from 'react';
import Card from './components/Card';
import DataGrid from './components/DataGrid';
import Setup from './components/Setup';
import { fetchKPIs, submitQuery, uploadCSV, fetchData } from './utils/api';
import { Send, Upload, Trash2, KeyRound, Plus, MessageSquare, History, LogOut, User, UploadCloud, CheckCircle, Sparkles, BarChart2, Table } from 'lucide-react';
import { Pie } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { auth, googleProvider } from './firebase.js';

ChartJS.register(ArcElement, Tooltip, Legend);
import {
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from 'firebase/auth';
import './App.css';

const NYKAA_QUERIES = [
    "Revenue by campaign type",
    "Monthly conversion trend",
    "Best ROI by channel",
    "Top 5 campaigns by revenue",
];

function generateExampleQueries(session) {
    if (!session || !session.datasetKey || session.datasetKey === 'nykaa') {
        return NYKAA_QUERIES;
    }
    // For custom datasets, generate column-aware suggestions
    const cols = session.columns || [];
    const numericCols = cols.filter(c =>
        /price|amount|spend|revenue|cost|total|value|score|rate|count|quantity|sales/i.test(c)
    );
    const categoryCols = cols.filter(c =>
        /type|category|status|channel|segment|region|brand|method|source|platform/i.test(c)
    );
    const timeCols = cols.filter(c => /date|month|year|time|day|period/i.test(c));

    const suggestions = [];
    if (numericCols[0] && categoryCols[0]) {
        suggestions.push(`${numericCols[0].replace(/_/g, ' ')} by ${categoryCols[0].replace(/_/g, ' ')}`);
        suggestions.push(`Distribution of ${numericCols[0].replace(/_/g, ' ')} by ${categoryCols[0].replace(/_/g, ' ')}`);
    }
    if (timeCols[0] && numericCols[0]) {
        suggestions.push(`${numericCols[0].replace(/_/g, ' ')} trend over time`);
    } else if (numericCols[1]) {
        suggestions.push(`Top 5 by ${numericCols[1].replace(/_/g, ' ')}`);
    }

    if (suggestions.length < 4 && numericCols[0] && categoryCols[1]) {
        suggestions.push(`Compare ${numericCols[0].replace(/_/g, ' ')} across ${categoryCols[1].replace(/_/g, ' ')}`);
    }

    if (suggestions.length === 0) {
        return ["Revenue by campaign type", "Monthly performance trend", "Category-wise distribution", "Top 5 campaigns by ROI"];
    }
    return suggestions.slice(0, 4);
}

const STORAGE_KEY = 'talktodata_bi_sessions';

const TECH_STACK_DATA = {
    labels: ['React.js (UI)', 'FastAPI (Backend)', 'Gemini AI', 'Pandas (Data)', 'Chart.js (Vis)'],
    datasets: [
        {
            data: [35, 25, 20, 10, 10],
            backgroundColor: [
                'rgba(59, 130, 246, 0.8)', // blue
                'rgba(16, 185, 129, 0.8)', // teal
                'rgba(236, 72, 153, 0.8)', // pink
                'rgba(245, 158, 11, 0.8)', // gold
                'rgba(168, 85, 247, 0.8)', // purple
            ],
            borderColor: 'rgba(9, 9, 11, 1)',
            borderWidth: 2,
            hoverOffset: 10
        }
    ]
};

const TECH_CHART_OPTIONS = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
        legend: {
            position: 'right',
            labels: { color: '#a1a1aa', font: { size: 13, family: 'Inter' }, padding: 20 }
        },
        tooltip: {
            backgroundColor: 'rgba(24, 24, 27, 0.9)',
            titleColor: '#ec4899',
            bodyColor: '#fafafa',
            borderColor: 'rgba(236, 72, 153, 0.3)',
            borderWidth: 1,
            padding: 12,
            callbacks: {
                label: (context) => ` ${context.label}: ${context.raw}%`
            }
        }
    }
};

export default function App() {
    const [apiKey, setApiKey] = useState(() => sessionStorage.getItem('geminiApiKey') || 'backend-managed-key');
    const [kpis, setKpis] = useState(null);
    const [showApiKeySetup, setShowApiKeySetup] = useState(false);

    // Auth States
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [authError, setAuthError] = useState('');
    const [authTab, setAuthTab] = useState('signin');

    // App Flow States
    const [showIntro, setShowIntro] = useState(true);
    const [showWelcome, setShowWelcome] = useState(true);
    const [uploadedDataset, setUploadedDataset] = useState(false);
    const [processingUpload, setProcessingUpload] = useState(false);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [uploadFileInfo, setUploadFileInfo] = useState(null);

    const [inputVal, setInputVal] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [viewMode, setViewMode] = useState('chat'); // 'chat', 'insights', or 'data'
    const [rawData, setRawData] = useState([]);
    const fileInputRef = useRef(null);
    const scrollRef = useRef(null);

    // Sessions handling
    const [sessions, setSessions] = useState(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch (e) { return []; }
    });
    const [currentSessionId, setCurrentSessionId] = useState(null);

    const activeSession = sessions.find(s => s.id === currentSessionId) || null;

    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
        });
        return () => unsubscribe();
    }, []);

    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    }, [sessions]);

    useEffect(() => {
        if (activeSession) {
            loadKPIs(activeSession.datasetKey);
            if (viewMode === 'data') loadData(activeSession.datasetKey);
        }
    }, [currentSessionId, viewMode]);

    const loadKPIs = async (dsKey) => {
        try {
            const data = await fetchKPIs(dsKey);
            setKpis(data);
        } catch (err) { console.warn('KPI error:', err); }
    };

    const loadData = async (dsKey) => {
        setLoading(true);
        try {
            const data = await fetchData(dsKey);
            setRawData(data);
        } catch (err) { setError('Failed to fetch data'); }
        finally { setLoading(false); }
    };

    const startNewChat = (dsKey = 'nykaa', dsLabel = 'Nykaa Campaigns', columns = []) => {
        const newSession = {
            id: Date.now(),
            title: 'New Analysis',
            messages: [],
            datasetKey: dsKey,
            datasetLabel: dsLabel,
            columns,
            createdAt: new Date().toISOString()
        };
        setSessions(prev => [newSession, ...prev]);
        setCurrentSessionId(newSession.id);
        setUploadedDataset(true);
        setShowWelcome(false);
        setViewMode('chat');
    };

    const deleteSession = (id, e) => {
        e.stopPropagation();
        const filtered = sessions.filter(s => s.id !== id);
        setSessions(filtered);
        if (currentSessionId === id) setCurrentSessionId(null);
    };

    const handleSubmit = async (e, queryOverride = null) => {
        if (e) e.preventDefault();
        const query = queryOverride || inputVal;
        if (!query.trim() || !activeSession) return;

        setInputVal('');
        setLoading(true);
        setError('');

        // Add user message immediately
        const userMsg = { id: Date.now(), type: 'user', content: query };
        const updatedMessages = [...activeSession.messages, userMsg];

        setSessions(prev => prev.map(s =>
            s.id === currentSessionId ? { ...s, messages: updatedMessages } : s
        ));

        try {
            const response = await submitQuery(query, activeSession.messages, apiKey, activeSession.datasetKey);

            let aiMsg;
            if (response.isGeneral) {
                aiMsg = {
                    id: Date.now() + 1,
                    type: 'ai',
                    content: response.response || "I'm here to help!",
                    isGeneral: true
                };
            } else if (response.canAnswer && response.recipe && response.chartData) {
                aiMsg = {
                    id: Date.now() + 1,
                    type: 'ai',
                    recipe: response.recipe,
                    chartData: response.chartData,
                    rowsAnalyzed: response.rowsAnalyzed,
                    isGeneral: false,
                    isError: false
                };
            } else {
                const reason = response.reason || response.cannotAnswerReason || response.detail || 'I cannot answer that based on the available data.';
                aiMsg = {
                    id: Date.now() + 1,
                    type: 'ai',
                    content: typeof reason === 'string' ? reason : JSON.stringify(reason),
                    isError: true
                };
            }

            setSessions(prev => prev.map(s => {
                if (s.id === currentSessionId) {
                    const isNew = s.messages.length <= 1;
                    return {
                        ...s,
                        title: isNew ? query.slice(0, 30) : s.title,
                        messages: [...updatedMessages, aiMsg]
                    };
                }
                return s;
            }));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
            setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }), 100);
        }
    };

    const saveApiKey = (key) => {
        sessionStorage.setItem('geminiApiKey', key);
        setApiKey(key);
        setShowApiKeySetup(false);
        setError('');
    };

    const handleFileUpload = async (e) => {
        const file = e.target.files?.[0] || e;
        if (!file || !(file instanceof File)) return;
        setProcessingUpload(true);
        try {
            const response = await uploadCSV(file);
            setUploadSuccess(true);
            setUploadFileInfo({ name: file.name, rows: response.rowCount });
            const cols = response.columns || [];
            setTimeout(() => {
                startNewChat(response.key, file.name, cols);
                setProcessingUpload(false);
                setUploadSuccess(false);
            }, 800);
        } catch (err) {
            setError(`Upload failed: ${err.message}`);
            setProcessingUpload(false);
        }
    };

    const handleSignOut = () => {
        signOut(auth);
        setCurrentSessionId(null);
        setShowWelcome(true);
    };

    if (authLoading) return <div className="auth-loading-screen"><div className="spinner" /></div>;

    if (!user && showIntro) {
        return (
            <div className="login-screen split-layout">
                <div className="split-left">
                    <div className="split-left-content">
                        <Sparkles size={48} color="var(--accent-pink)" style={{ marginBottom: 24 }}/>
                        <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 16, color: '#fff' }}>Powering the Future of Data</h1>
                        <p style={{ fontSize: 18, color: 'var(--text-secondary)', marginBottom: 40, lineHeight: 1.6 }}>TalktoData is built on a cutting-edge modern tech stack, combining powerful AI with high-speed analytical processing.</p>
                        
                        <div style={{ height: 320, width: '100%', maxWidth: 500, margin: '0 auto' }}>
                            <Pie data={TECH_STACK_DATA} options={TECH_CHART_OPTIONS} />
                        </div>
                    </div>
                </div>
                <div className="split-right">
                    <div className="split-right-content">
                        <div style={{ marginBottom: 40, textAlign: 'center' }}>
                            <h2 style={{ fontSize: 36, fontWeight: 800, marginBottom: 16, background: 'linear-gradient(135deg, #fff, #a1a1aa)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>TalktoData</h2>
                            <p style={{ fontSize: 16, color: 'var(--text-muted)' }}>Sign in to start talking to your data.</p>
                        </div>
                        
                        <button 
                            onClick={() => setShowIntro(false)}
                            style={{ 
                                background: 'var(--accent-pink)', 
                                color: '#fff', 
                                border: 'none', 
                                padding: '16px 48px', 
                                fontSize: 18, 
                                fontWeight: 600, 
                                borderRadius: 100, 
                                cursor: 'pointer',
                                width: '100%',
                                boxShadow: '0 4px 20px rgba(236, 72, 153, 0.3)',
                                transition: 'transform 0.2s, box-shadow 0.2s'
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(236, 72, 153, 0.4)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(236, 72, 153, 0.3)'; }}
                        >
                            Get Started
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    if (!user && !showIntro) {
        return (
            <div className="login-screen split-layout">
                <div className="split-left">
                    <div className="split-left-content">
                        <Sparkles size={48} color="var(--accent-pink)" style={{ marginBottom: 24 }}/>
                        <h1 style={{ fontSize: 48, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 16, color: '#fff' }}>Powering the Future of Data</h1>
                        <p style={{ fontSize: 18, color: 'var(--text-secondary)', marginBottom: 40, lineHeight: 1.6 }}>TalktoData is built on a cutting-edge modern tech stack, combining powerful AI with high-speed analytical processing.</p>
                        
                        <div style={{ height: 320, width: '100%', maxWidth: 500, margin: '0 auto' }}>
                            <Pie data={TECH_STACK_DATA} options={TECH_CHART_OPTIONS} />
                        </div>
                    </div>
                </div>
                <div className="split-right">
                    <div className="login-card full-width">
                        <div className="login-logo">
                            <Sparkles size={40} color="var(--accent-pink)" />
                            <h2 className="login-title" style={{ fontSize: 28 }}>Welcome Back</h2>
                        </div>
                        <div className="auth-tabs">
                            <button className={`auth-tab ${authTab === 'signin' ? 'active' : ''}`} onClick={() => setAuthTab('signin')}>Sign In</button>
                            <button className={`auth-tab ${authTab === 'signup' ? 'active' : ''}`} onClick={() => setAuthTab('signup')}>Sign Up</button>
                        </div>
                        <form onSubmit={(e) => {
                            e.preventDefault();
                            const email = e.target.email.value;
                            const pass = e.target.password.value;
                            if (authTab === 'signin') {
                                signInWithEmailAndPassword(auth, email, pass).catch(err => setAuthError(err.message));
                            } else {
                                createUserWithEmailAndPassword(auth, email, pass).catch(err => setAuthError(err.message));
                            }
                        }}>
                            <input name="email" type="email" placeholder="Email" className="auth-input" required />
                            <input name="password" type="password" placeholder="Password" className="auth-input" required />
                            <button type="submit" className="auth-submit-btn">{authTab === 'signin' ? 'Sign In' : 'Create Account'}</button>
                        </form>
                        <div className="auth-divider">or</div>
                        <button className="google-btn" onClick={() => signInWithPopup(auth, googleProvider)}><User size={18} /> Continue with Google</button>
                        {authError && <div className="auth-error">{authError}</div>}
                    </div>
                </div>
            </div>
        );
    }

    if (showWelcome) {
        return (
            <div className="login-screen">
                <div className="login-card" style={{ maxWidth: 600 }}>
                    <h1 className="login-title">Welcome, {user.displayName || user.email.split('@')[0]}</h1>
                    <p className="login-subtitle">Ready to unlock insights from your data?</p>

                    <div className="welcome-options" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 40 }}>
                        <div className="welcome-card" onClick={() => startNewChat()} style={{ cursor: 'pointer', padding: 24, background: 'var(--bg-1)', border: '1px solid var(--border-subtle)', borderRadius: 16, textAlign: 'center' }}>
                            <div style={{ fontSize: 32, marginBottom: 16 }}>📊</div>
                            <h3 style={{ marginBottom: 8 }}>Nykaa Sample</h3>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Explore 55k+ marketing campaign records.</p>
                        </div>
                        <div className="welcome-card" onClick={() => fileInputRef.current?.click()} style={{ cursor: 'pointer', padding: 24, background: 'var(--bg-1)', border: '1px solid var(--border-subtle)', borderRadius: 16, textAlign: 'center' }}>
                            <div style={{ fontSize: 32, marginBottom: 16 }}>📁</div>
                            <h3 style={{ marginBottom: 8 }}>Upload CSV</h3>
                            <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analyze your own dataset instantly.</p>
                        </div>
                    </div>

                    {sessions.length > 0 && (
                        <div style={{ marginTop: 40, textAlign: 'left' }}>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginBottom: 12 }}>Continue analyzing:</p>
                            <div className="recent-list" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {sessions.slice(0, 3).map(s => (
                                    <div key={s.id} onClick={() => { setCurrentSessionId(s.id); setShowWelcome(false); }} style={{ cursor: 'pointer', padding: '12px 16px', background: 'var(--bg-1)', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12, border: '1px solid var(--border-subtle)' }}>
                                        <MessageSquare size={16} color="var(--accent-blue)" />
                                        <span style={{ fontSize: 14 }}>{s.title}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".csv" onChange={handleFileUpload} />
                    <button onClick={handleSignOut} className="btn-ghost" style={{ marginTop: 40, width: '100%' }}>Sign Out</button>
                    {processingUpload && <div className="upload-overlay"><div className="spinner" /> Analyzing...</div>}
                </div>
            </div>
        );
    }

    return (
        <div className="app-container">
            {showApiKeySetup && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)' }}>
                    <div style={{ position: 'absolute', top: 16, right: 16 }}>
                        <button className="btn-ghost" onClick={() => setShowApiKeySetup(false)}>Close</button>
                    </div>
                    <Setup onSubmit={saveApiKey} />
                </div>
            )}
            <aside className="sidebar">
                <div className="sidebar-header">
                    <button className="new-chat-btn" onClick={() => setShowWelcome(true)}>
                        <Plus size={16} /> New Chat
                    </button>
                    <div className="sidebar-nav">
                        <button className={`nav-item ${viewMode === 'chat' ? 'active' : ''}`} onClick={() => setViewMode('chat')}>
                            <MessageSquare size={16} /> Chat
                        </button>
                        <button className={`nav-item ${viewMode === 'insights' ? 'active' : ''}`} onClick={() => setViewMode('insights')}>
                            <BarChart2 size={16} /> Insights
                        </button>
                        <button className={`nav-item ${viewMode === 'data' ? 'active' : ''}`} onClick={() => setViewMode('data')}>
                            <Table size={16} /> Data View
                        </button>
                    </div>
                </div>
                <div className="history-section">
                    <div className="history-label"><History size={12} /> RECENT ANALYTICS</div>
                    {sessions.map(s => (
                        <div key={s.id} className={`history-item ${currentSessionId === s.id ? 'active' : ''}`} onClick={() => { setCurrentSessionId(s.id); setShowWelcome(false); setViewMode('chat'); }}>
                            <MessageSquare size={14} />
                            <span className="history-title">{s.title}</span>
                            <button className="del-session" onClick={(e) => deleteSession(s.id, e)}><Trash2 size={12} /></button>
                        </div>
                    ))}
                </div>
                <div className="sidebar-footer">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div className="user-avatar">
                            {user.photoURL ? (
                                <img src={user.photoURL} alt="User" />
                            ) : (
                                (user.displayName ? user.displayName[0] : user.email[0]).toUpperCase()
                            )}
                        </div>
                        <div style={{ overflow: 'hidden', flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                {user.displayName || user.email.split('@')[0]}
                            </div>
                            <button onClick={handleSignOut} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', padding: 0, marginTop: 2, display: 'block' }}>Sign Out</button>
                        </div>
                    </div>
                </div>
            </aside>

            <main className="chat-container">
                <header className="app-header">
                    <div className="header-brand">
                        <Sparkles size={24} color="var(--accent-pink)" />
                        <div>
                            <h1 className="header-brand-name">TalktoData</h1>
                            <div className="header-brand-sub">MARKETING INTELLIGENCE</div>
                        </div>
                    </div>
                    {activeSession && (
                        <div className="header-actions">
                            <div className="data-badge">
                                <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent-teal)', display: 'inline-block' }} />
                                {activeSession.datasetLabel}
                                {kpis?.totalRows && <span style={{ color: 'var(--text-muted)' }}>• {kpis.totalRows.toLocaleString()} rows</span>}
                            </div>
                            <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
                                <UploadCloud size={14} /> Upload CSV
                            </button>
                            <button
                                className="btn-ghost"
                                onClick={() => setShowApiKeySetup(true)}
                                title="Set Gemini API key"
                            >
                                <KeyRound size={14} /> API Key
                            </button>
                            <input type="file" ref={fileInputRef} style={{ display: 'none' }} accept=".csv" onChange={handleFileUpload} />
                        </div>
                    )}
                </header>

                {/* Main Content Area */}
                <div className="scroll-area" ref={scrollRef}>
                    <div className="main-content">
                        {viewMode === 'chat' && (
                            <div className="messages-list">
                                {(!activeSession || activeSession.messages.length === 0) && (
                                    <div className="empty-state">
                                        <div className="empty-icon"><Sparkles size={64} color="var(--accent-gold)" /></div>
                                        <h2 className="empty-title">How can I help you today?</h2>
                                        <p className="empty-subtitle">Ask me to analyze your marketing performance, compare channels, or visualize campaign ROI.</p>
                                    </div>
                                )}
                                {activeSession?.messages.map((msg) => (
                                    <div key={msg.id} className={`message-item ${msg.type}`}>
                                        <div className={`message-avatar ${msg.type}`}>
                                            {msg.type === 'user' ? (
                                                user.photoURL ? <img src={user.photoURL} alt="User" /> : (user.displayName || user.email)[0].toUpperCase()
                                            ) : (
                                                <Sparkles size={16} color="white" />
                                            )}
                                        </div>
                                        <div className="message-content">
                                            {msg.type === 'ai' && !msg.isGeneral && !msg.isError ? (
                                                <div className="message-chart">
                                                    <Card item={msg} index={0} />
                                                </div>
                                            ) : (
                                                <div className="message-text" style={{ color: msg.isError ? '#ef4444' : 'inherit' }}>{msg.content}</div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {loading && (
                                    <div className="message-item ai">
                                        <div className="message-avatar ai"><Sparkles size={16} color="white" /></div>
                                        <div className="message-content">
                                            <div className="spinner" style={{ borderColor: 'var(--accent-teal)', borderTopColor: 'transparent' }} />
                                        </div>
                                    </div>
                                )}
                                {error && <div className="error-box">{error}</div>}
                            </div>
                        )}

                        {viewMode === 'insights' && activeSession && kpis && (
                            <div className="insights-dashboard" style={{ padding: '24px' }}>
                                <h2 style={{ fontSize: 24, fontWeight: 600, marginBottom: 24, color: 'var(--text-primary)' }}>High-Level Metrics</h2>
                                <div className="kpi-grid">
                                    {/* Dataset overview card */}
                                    <div className="kpi-card" style={{ borderTopColor: 'var(--text-muted)' }}>
                                        <div className="kpi-label">DATASET</div>
                                        <div className="kpi-value" style={{ color: 'var(--text-primary)', fontSize: 28 }}>
                                            {kpis.totalRows?.toLocaleString()} × {kpis.totalColumns}
                                        </div>
                                        <div className="kpi-sub">Rows × Columns</div>
                                    </div>
                                    {/* Dynamic KPI cards from backend */}
                                    {kpis.dynamicKpis?.map((kpi, idx) => (
                                        <div key={idx} className="kpi-card" style={{ borderTopColor: kpi.color }}>
                                            <div className="kpi-label">{kpi.label}</div>
                                            <div className="kpi-value" style={{ color: kpi.color, fontSize: 28 }}>{kpi.value}</div>
                                            <div className="kpi-sub">{kpi.sub}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {viewMode === 'data' && (
                            <DataGrid data={rawData} />
                        )}
                    </div>
                </div>

                {viewMode === 'chat' && (
                    <div className="chat-section">
                        <div className="chat-box">
                            <form onSubmit={handleSubmit} className="chat-input-row">
                                <textarea
                                    className="chat-textarea"
                                    rows={1}
                                    placeholder="Chat with TalktoData..."
                                    value={inputVal}
                                    onChange={(e) => setInputVal(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); } }}
                                />
                                <button type="submit" className="chat-submit-btn" disabled={!inputVal.trim() || loading || !activeSession}>
                                    <Send size={18} />
                                </button>
                            </form>
                            <div className="chips-row">
                                {generateExampleQueries(activeSession).map(q => <div key={q} className="chip" onClick={() => handleSubmit(null, q)}>{q}</div>)}
                            </div>
                        </div>
                    </div>
                )}
            </main>
        </div>
    );
}
