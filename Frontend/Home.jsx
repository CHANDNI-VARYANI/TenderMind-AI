import { useNavigate } from 'react-router-dom'
import { FileText, Users, BarChart2, Zap } from 'lucide-react'

export default function Home() {
  const nav = useNavigate()
  return (
    <div>
      <div className="page-header">
        <h1>TenderMind AI</h1>
        <p>AI-powered tender evaluation for CRPF procurement. 30 days of work in 30 minutes.</p>
      </div>
      <div className="grid-3" style={{marginBottom: 24}}>
        {[
          { label: 'Evaluation Time', value: '~2 min', sub: 'vs 30–45 days' },
          { label: 'Accuracy', value: '95%+', sub: 'explainable decisions' },
          { label: 'Fraud Detection', value: 'Auto', sub: 'flagged instantly' },
        ].map(s => (
          <div className="card stat-card" key={s.label}>
            <div className="label">{s.label}</div>
            <div className="value" style={{color:'#1a4a8a'}}>{s.value}</div>
            <div style={{fontSize:12, color:'#6b7280', marginTop:4}}>{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="grid-2">
        {[
          { icon: <FileText size={20}/>, title: 'Upload Tender', desc: 'Upload your tender PDF or DOCX. AI automatically extracts all eligibility criteria.', path: '/tender' },
          { icon: <Users size={20}/>, title: 'Evaluate Bidders', desc: 'Upload bidder documents and get instant Pass/Fail/Review verdicts with explanations.', path: '/evaluate' },
          { icon: <BarChart2 size={20}/>, title: 'Dashboard', desc: 'See all bidders ranked by score with detailed evaluation breakdowns.', path: '/dashboard' },
          { icon: <Zap size={20}/>, title: 'Audit Log', desc: 'Tamper-proof blockchain-style audit trail of every action in the system.', path: '/audit' },
        ].map(c => (
          <div className="card" key={c.title} style={{cursor:'pointer'}} onClick={() => nav(c.path)}>
            <div style={{display:'flex', alignItems:'center', gap:10, marginBottom:10, color:'#1a4a8a'}}>
              {c.icon}
              <span style={{fontWeight:700, fontSize:16}}>{c.title}</span>
            </div>
            <p style={{fontSize:14, color:'#6b7280'}}>{c.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
