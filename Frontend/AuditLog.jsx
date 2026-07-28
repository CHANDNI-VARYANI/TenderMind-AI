import { useState, useEffect } from 'react'
import axios from 'axios'
import { Shield } from 'lucide-react'

const API = '/api'

export default function AuditLog() {
  const [logs, setLogs] = useState([])

  useEffect(() => {
    axios.get(`${API}/report/audit`).then(r => setLogs(r.data))
  }, [])

  return (
    <div>
      <div className="page-header">
        <h1>Blockchain Audit Trail</h1>
        <p>Every action is recorded with a tamper-proof hash chain.</p>
      </div>
      <div className="card">
        <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:16, color:'#1a4a8a'}}>
          <Shield size={18}/>
          <span style={{fontWeight:600}}>{logs.length} entries in audit chain</span>
        </div>
        <table>
          <thead>
            <tr><th>Time</th><th>Action</th><th>Entity</th><th>Details</th><th>Hash</th></tr>
          </thead>
          <tbody>
            {logs.map(l => (
              <tr key={l.id}>
                <td style={{fontSize:12, color:'#6b7280', whiteSpace:'nowrap'}}>
                  {new Date(l.timestamp * 1000).toLocaleString('en-IN')}
                </td>
                <td><span style={{fontWeight:600, fontSize:13}}>{l.action}</span></td>
                <td style={{fontSize:13}}>{l.entity_type} #{l.entity_id}</td>
                <td style={{fontSize:13, color:'#374151'}}>{l.details}</td>
                <td><span className="hash-chip">{l.hash.slice(0,12)}…</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
