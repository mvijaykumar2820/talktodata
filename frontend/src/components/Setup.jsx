import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound } from 'lucide-react';

/**
 * Setup screen for entering the Gemini API key
 * @param {Object} props
 * @param {Function} props.onSubmit - Function called with valid API key
 */
export default function Setup({ onSubmit }) {
    const [key, setKey] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!key.startsWith('AIza')) {
            setError('Key must start with AIza. Get yours at aistudio.google.com');
            return;
        }
        setError('');
        onSubmit(key);
    };

    return (
        <div className="setup-screen">
            <div className="setup-card">
                <div className="setup-logo">
                    <div className="setup-emoji">✨</div>
                    <h1 className="setup-title">TalktoData</h1>
                    <p className="setup-tagline">Conversational Marketing Intelligence</p>
                </div>

                <form onSubmit={handleSubmit}>
                    <label className="setup-label">Gemini API Key</label>
                    <div className="setup-input-wrap">
                        <input
                            type={showKey ? 'text' : 'password'}
                            className="setup-input"
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            placeholder="AIzaSy..."
                        />
                        <button
                            type="button"
                            className="setup-eye-btn"
                            onClick={() => setShowKey(!showKey)}
                        >
                            {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>

                    <p className="setup-hint">
                        Get your free key at{' '}
                        <a
                            href="https://aistudio.google.com/app/apikey"
                            target="_blank"
                            rel="noreferrer"
                            className="setup-link"
                        >
                            aistudio.google.com
                        </a>
                    </p>

                    {error && <div className="error-box">{error}</div>}

                    <button
                        type="submit"
                        className="setup-submit-btn"
                        disabled={!key}
                    >
                        Launch Dashboard &rarr;
                    </button>
                </form>

                <div className="setup-examples">
                    <h3 className="setup-examples-title">Try asking things like:</h3>
                    <p className="setup-example-item">"Show me revenue by campaign type"</p>
                    <p className="setup-example-item">"What is the monthly conversion trend?"</p>
                    <p className="setup-example-item">"Compare ROI and acquisition cost by audience"</p>
                    <p className="setup-example-item">"Which language has the best ROI?"</p>
                </div>
            </div>
        </div>
    );
}
