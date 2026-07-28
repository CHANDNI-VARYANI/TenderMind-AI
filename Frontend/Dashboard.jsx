import { useState, useEffect } from 'react'
import axios from 'axios'

const API = '/api'

function ScoreBar({ score, verdict }) {
  const color = verdict === 'Eligible' ? '#1a7a3f' : verdict === 'Not Eligible' ? '#b91c1c' : '#b45309'
  return (
    <div className="progress-bar-wrap" style={{width:120}}>
      <div className="progress-bar" style={{width:`${score}%`, background: color}} />
    </div>
  )
}

export default function Dashboard() {
  const [tenders, setTenders] = useState([])
  const [selected, setSelected] = useState(localStorage.getItem('tender_id') || '')
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    axios.get(`${API}/tender/`).then(r => setTenders(r.data))
  }, [])

  useEffect(() => {
    if (!selected) return
    setLoading(true)
    axios.get(`${API}/report/summary/${selected}`)
      .then(r => { setSummary(r.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [selected])

  const verdictBadge = (v) => {
    const cls = v === 'Eligible' ? 'badge-eligible' : v === 'Not Eligible' ? 'badge-not-eligible' : 'badge-review'
    return <span className={`badge ${cls}`}>{v}</span>
  }

  return (
    <div>
      <div className="page-header">
        <h1>Evaluation Dashboard</h1>
        <p>Overview of all bidder evaluations for a tender.</p>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{fontSize:13, fontWeight:500, marginRight:10}}>Select Tender:</label>
        <select style={{padding:'7px 12px', border:'1px solid #d1d5db', borderRadius:6, fontSize:14}}
          value={selected} onChange={e => setSelected(e.target.value)}>
          <option value="">-- Choose a tender --</option>
          {tenders.map(t => <option key={t.id} value={t.id}>#{t.id} — {t.filename}</option>)}
        </select>
      </div>
      {loading && <div style={{textAlign:'center', padding:40}}><span className="spinner" style={{width:30,height:30}}/></div>}
      {summary && !loading && (
        <>
          <div className="grid-3" style={{marginBottom:24}}>
            {[
              {label:'Total Bidders', value: summary.stats.total, color:'#1a4a8a'},
              {label:'Eligible', value: summary.stats.eligible, color:'#1a7a3f'},
              {label:'Not Eligible', value: summary.stats.not_eligible, color:'#b91c1c'},
            ].map(s => (
              <div className="card stat-card" key={s.label}>
                <div className="label">{s.label}</div>
                <div className="value" style={{color:s.color}}>{s.value}</div>
              </div>
            ))}
          </div>
          <div className="card">
            <h2 style={{fontSize:16, fontWeight:700, marginBottom:16}}>Bidder Rankings</h2>
            <table>
              <thead>
                <tr><th>Rank</th><th>Company</th><th>Score</th><th>Verdict</th><th>Action</th></tr>
              </thead>
              <tbody>
                {summary.bidders.sort((a,b) => b.score - a.score).map((b,i) => (
                  <tr key={b.id}>
                    <td style={{fontWeight:700, color:'#6b7280'}}>#{i+1}</td>
                    <td style={{fontWeight:600}}>{b.company_name}</td>
                    <td>
                      <div style={{display:'flex', alignItems:'center', gap:8}}>
                        <ScoreBar score={b.score} verdict={b.verdict}/>
                        <span style={{fontSize:13, fontWeight:600}}>{b.score}</span>
                      </div>
                    </td>
                    <td>{verdictBadge(b.verdict)}</td>
                    <td style={{fontSize:13, color:'#6b7280'}}>{b.evaluation?.recommended_action?.slice(0,50)}…</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
