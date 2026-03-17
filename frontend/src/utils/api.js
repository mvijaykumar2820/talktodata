const API_BASE = import.meta.env.VITE_API_URL || '';

/**
 * Fetches KPIs from the backend
 * @returns {Promise<Object>} KPI data object
 */
export async function fetchKPIs(dataset = 'nykaa') {
    const res = await fetch(`${API_BASE}/api/kpis?dataset=${dataset}`)
    if (!res.ok) throw new Error('Failed to load KPIs')
    return res.json()
}

/**
 * Fetches raw dataset records
 * @param {string} datasetKey - Key of the dataset
 * @returns {Promise<Array>} Data rows
 */
export async function fetchData(datasetKey = 'nykaa') {
    const res = await fetch(`${API_BASE}/api/data?dataset=${datasetKey}`)
    if (!res.ok) throw new Error('Failed to fetch data')
    return res.json()
}

/**
 * Submits a natural language query to the backend logic
 * @param {string} question - The user's typed question
 * @param {Array} history - Previous conversation history
 * @param {string} apiKey - Gemini API Key
 * @param {string} dataset - Dataset identifier ('nykaa' or string key)
 * @returns {Promise<Object>} The API response and chart data
 */
export async function submitQuery(question, history, apiKey, dataset = 'nykaa') {
    const res = await fetch(`${API_BASE}/api/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, history, api_key: apiKey, dataset })
    })
    if (!res.ok) {
        let err
        try {
            err = await res.json()
        } catch (e) {
            throw new Error('Query failed due to network or server error')
        }
        throw new Error(err.detail || err.reason || 'Query failed')
    }
    return res.json()
}

/**
 * Uploads a custom CSV
 * @param {File} file - CSV File object
 * @returns {Promise<Object>} Upload stats and reference key
 */
export async function uploadCSV(file) {
    const form = new FormData()
    form.append('file', file)
    const res = await fetch(`${API_BASE}/api/upload`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('Upload failed')
    return res.json()
}
