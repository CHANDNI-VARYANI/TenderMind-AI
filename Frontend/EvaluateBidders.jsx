import { useState, useRef } from 'react'
import axios from 'axios'
import { Upload, AlertTriangle } from 'lucide-react'

const API = '/api'

function VerdictBadge({ v }) {
  const cls = v === 'Eligible' ? 'badge-eligible' : v === 'Not Eligible' ? 'badge-not-eligible' : 'badge-review'
  return <span className={`badge ${cls}`}>{v}</span>
}

function ResultCard({ r }) {
  const cls = r.overall_verdict === 'Eligible' ? 'result-eligible' : r.overall_verdict === 'Not Eligible' ? 'result-not-eligible' : 'result-review'
  return (
    <div className={`card result-card ${cls}`} style={{marginBottom:16}}>
      <div className="result-header">
        <div>
          <div className="result-company">{r.company_name}</div>
          <div style={{fontSize:13, color:'#6b7280', marginTop:2}}>Score: {r.overall_score}/100 · Confidence: {r.confidence}%</div>
        </div>
        <VerdictBadge v={r.overall_verdict} />
      </div>
      <p style={{fontSize:14, color:'#374151', marginBottom:12}}>{r.summary}</p>
      <div style={{marginBottom:4, fontSize:12, fontWeight:600, color:'#6b7280', textTransform:'uppercase', letterSpacing:'.05em'}}>Criteria Breakdown</div>
      <div className="criteria-results">
        {r.criteria_results?.map(cr => (
          <div className="cr-row" key={cr.criterion_id}>
            <div>
              <div style={{fontWeight:600}}>{cr.criterion_id}</div>
              <div className={`cr-status-${cr.status.toLowerCase()}`}>{cr.status}</div>
            </div>
            <div>
              <div style={{fontWeight:500}}>{cr.criterion_name}</div>
              <div className="cr-expl">{cr.explanation}</div>
            </div>
            <div>
              <div style={{fontSize:12}}>Found: <strong>{cr.extracted_value || '—'}</strong></div>
              <div style={{fontSize:12, color:'#6b7280'}}>Required: {cr.required_value || '—'}</div>
            </div>
          </div>
        ))}
      </div>
      {r.fraud_flags?.length > 0 && r.fraud_flags.map((f,i) => (
        <div className="fraud-flag" key={i}>
          <AlertTriangle size={13} style={{marginRight:6, display:'inline'}}/>{f}
        </div>
      ))}
      <div style={{marginTop:12, padding:'10px 14px', background:'#f8fafc', borderRadius:6, fontSize:13}}>
        <strong>Recommended Action:</strong> {r.recommended_action}
      </div>
    </div>
  )
}

export default function EvaluateBidders() {
  const [tenderId, setTenderId] = useState(localStorage.getItem('tender_id') || '')
  const [company, setCompany] = useState('')
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const ref = useRef()

  const handleEvaluate = async () => {
    if (!tenderId || !company || !file) return
    setLoading(true); setError('')
    const fd = new FormData()
    fd.append('tender_id', tenderId)
    fd.append('company_name', company)
    fd.append('file', file)
    try {
      const res = await axios.post(`${API}/bidder/evaluate`, fd)
      setResults(prev => [res.data.result, ...prev])
      setCompany(''); setFile(null)
    } catch(e) {
      setError(e.response?.data?.detail || 'Evaluation failed.')
    }
    setLoading(false)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Evaluate Bidders</h1>
        <p>Upload each bidder's documents. AI will evaluate and verdict them instantly.</p>
      </div>
      <div className="grid-2" style={{alignItems:'start'}}>
        <div className="card" style={{position:'sticky', top:20}}>
          <h2 style={{fontSize:16, fontWeight:700, marginBottom:16}}>New Bidder Evaluation</h2>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:13, fontWeight:500, display:'block', marginBottom:4}}>Tender ID</label>
            <input style={{width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6, fontSize:14}}
              value={tenderId} onChange={e => setTenderId(e.target.value)} placeholder="e.g. 1" />
          </div>
          <div style={{marginBottom:12}}>
            <label style={{fontSize:13, fontWeight:500, display:'block', marginBottom:4}}>Company Name</label>
            <input style={{width:'100%', padding:'8px 12px', border:'1px solid #d1d5db', borderRadius:6, fontSize:14}}
              value={company} onChange={e => setCompany(e.target.value)} placeholder="e.g. Apex Defence Pvt Ltd" />
          </div>
          <div style={{marginBottom:16}}>
            <label style={{fontSize:13, fontWeight:500, display:'block', marginBottom:4}}>Bidder Document</label>
            <div className="upload-zone" style={{padding:20}} onClick={() => ref.current.click()}>
              <Upload size={24} color="#9ca3af" />
              <p style={{color:'#374151', fontWeight:500, fontSize:13, marginTop:6}}>
                {file ? file.name : 'Upload bid document'}
              </p>
              <input ref={ref} type="file" accept=".pdf,.docx,.txt" style={{display:'none'}}
                onChange={e => setFile(e.target.files[0])} />
            </div>
          </div>
          {error && <p style={{color:'#b91c1c', fontSize:14, marginBottom:10}}>{error}</p>}
          <button className="btn btn-primary" style={{width:'100%'}}
            onClick={handleEvaluate} disabled={!tenderId||!company||!file||loading}>
            {loading ? <><span className="spinner"/> AI Evaluating...</> : 'Evaluate Bidder'}
          </button>
        </div>
        <div>
          {results.length === 0 ? (
            <div className="card" style={{textAlign:'center', color:'#9ca3af', padding:48}}>
              <p style={{marginTop:12}}>No evaluations yet. Submit a bidder to see results.</p>
            </div>
          ) : results.map((r, i) => <ResultCard key={i} r={r} />)}
        </div>
      </div>
    </div>
  )
}
