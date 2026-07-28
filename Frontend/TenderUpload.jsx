import { useState, useRef } from 'react'
import axios from 'axios'
import { Upload, CheckCircle } from 'lucide-react'

const API = '/api'

export default function TenderUpload() {
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const ref = useRef()

  const handleUpload = async () => {
    if (!file) return
    setLoading(true)
    setError('')
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await axios.post(`${API}/tender/upload`, fd)
      setResult(res.data)
      localStorage.setItem('tender_id', res.data.tender_id)
    } catch (e) {
      setError('Upload failed. Check backend is running.')
    }
    setLoading(false)
  }

  const typeBadge = (t) => {
    const map = { mandatory: 'type-mandatory', scored: 'type-scored', optional: 'type-optional' }
    return map[t] || 'type-optional'
  }

  return (
    <div>
      <div className="page-header">
        <h1>Upload Tender Document</h1>
        <p>Upload the tender PDF or DOCX. AI will extract all eligibility criteria automatically.</p>
      </div>

      {!result ? (
        <div className="card" style={{ maxWidth: 600 }}>
          <div
            className={`upload-zone ${drag ? 'drag' : ''}`}
            onClick={() => ref.current.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true) }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); setFile(e.dataTransfer.files[0]) }}
          >
            <Upload size={36} color="#9ca3af" />
            <p style={{ fontWeight: 600, color: '#374151', marginTop: 8 }}>
              {file ? file.name : 'Click or drag tender document here'}
            </p>
            <p>PDF, DOCX, or TXT supported</p>
            <input
              ref={ref}
              type="file"
              accept=".pdf,.docx,.txt"
              style={{ display: 'none' }}
              onChange={e => setFile(e.target.files[0])}
            />
          </div>

          {error && <p style={{ color: '#b91c1c', marginTop: 12, fontSize: 14 }}>{error}</p>}

          <button
            className="btn btn-primary"
            style={{ marginTop: 16, width: '100%' }}
            onClick={handleUpload}
            disabled={!file || loading}
          >
            {loading ? <><span className="spinner" /> Analyzing with AI...</> : <><Upload size={15} /> Extract Criteria</>}
          </button>
        </div>
      ) : (
        <div>
          <div className="card" style={{ marginBottom: 20, borderLeft: '4px solid #1a7a3f' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <CheckCircle color="#1a7a3f" size={20} />
              <div>
                <div style={{ fontWeight: 700 }}>{result.criteria.tender_title}</div>
                <div style={{ fontSize: 13, color: '#6b7280' }}>Tender ID: {result.tender_id}</div>
              </div>
            </div>
            <p style={{ marginTop: 12, fontSize: 14, color: '#374151' }}>{result.criteria.summary}</p>
          </div>

          <div className="card">
            <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 4 }}>Extracted Eligibility Criteria</h2>
            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 4 }}>
              {result.criteria.criteria?.length} criteria found
            </p>
            <div className="criteria-list">
              {result.criteria.criteria?.map(c => (
                <div className="criterion-item" key={c.id}>
                  <span className="criterion-id">{c.id}</span>
                  <div>
                    <div className="criterion-name">{c.name}</div>
                    <div className="criterion-desc">{c.description}</div>
                    {c.threshold && (
                      <div style={{ fontSize: 12, color: '#1a4a8a', marginTop: 3 }}>
                        Threshold: {c.threshold}
                      </div>
                    )}
                    {c.clause_reference && (
                      <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 2 }}>
                        Clause: {c.clause_reference}
                      </div>
                    )}
                  </div>
                  <span className={`type-badge ${typeBadge(c.type)}`}>{c.type}</span>
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              style={{ marginTop: 20 }}
              onClick={() => window.location.href = '/evaluate'}
            >
              Proceed to Evaluate Bidders →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
