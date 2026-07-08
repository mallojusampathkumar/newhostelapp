import React, { useState } from 'react';
import { post } from '../api.js';
import { useLang } from '../i18n.jsx';
import { Modal, Field } from '../components/ui.jsx';
import { downloadCsv } from '../util.js';
import { useToast } from '../App.jsx';

/* Smart Import — bring an existing register in one shot.
   Sources: Excel/CSV (SheetJS) or a photo of the paper register (Tesseract
   OCR). Headers are auto-mapped, rows are shown in an editable preview, and
   one tap saves everything: floors, rooms, beds, tenants, rent, advance and
   old dues. Both parsers are dynamic imports so the main bundle stays lean. */

const FIELDS = ['floor', 'room', 'bed', 'name', 'phone', 'rent', 'advance', 'due', 'joinDate'];

// header synonyms → canonical field
const HEADER_MAP = [
  [/^floor|manzil|antastu/i, 'floor'],
  [/room|rm\b|kamra/i, 'room'],
  [/^bed|cot/i, 'bed'],
  [/name|tenant|person|guest/i, 'name'],
  [/phone|mobile|contact|cell|whatsapp/i, 'phone'],
  [/maint/i, 'maintenance'],
  [/rent|amount/i, 'rent'],
  [/advance|deposit|security/i, 'advance'],
  [/due|balance|pending|arrear|baki|old/i, 'due'],
  [/join|start|from|since|doj/i, 'joinDate'],
  [/aadhaa?r|id.?no/i, 'aadhaar'],
  [/occupation|work|job/i, 'occupation']
];

function mapHeader(h) {
  const s = String(h || '').trim();
  for (const [re, field] of HEADER_MAP) if (re.test(s)) return field;
  return null;
}

// "05/03/2025", "5-3-25", "2025-03-05" → ISO; anything else → ''
function toIsoDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  const d = new Date(s);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

const num = (v) => String(v ?? '').replace(/[^\d.]/g, '');

export default function SmartImport({ properties, defaultProp, onDone, onClose }) {
  const { t } = useLang();
  const toast = useToast();
  const [propId, setPropId] = useState(defaultProp || properties[0]?.id || '');
  const [rows, setRows] = useState(null); // normalized editable rows
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('pick'); // pick | preview | done
  const [progress, setProgress] = useState('');
  const [summary, setSummary] = useState(null);

  const template = () => downloadCsv('staysathi-import-template.csv', [
    ['floor', 'room', 'bed', 'name', 'phone', 'rent', 'advance', 'due', 'joinDate'],
    ['1', '101', '1', 'Ravi Kumar', '9876500001', '6500', '6500', '0', '2025-01-05'],
    ['1', '101', '2', 'Anil Reddy', '9876500002', '6500', '6500', '3000', '2025-03-10'],
    ['2', '201', '', '', '', '7000', '', '', '']
  ]);

  /* ---------- Excel / CSV ---------- */
  const pickSheet = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setProgress('📄 …');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      const parsed = gridToRows(grid);
      if (!parsed.length) { toast(t('noRowsFound'), 'err'); }
      else { setRows(parsed); setPhase('preview'); }
    } catch (err) { toast(err.message, 'err'); }
    setBusy(false); setProgress('');
  };

  function gridToRows(grid) {
    if (!grid.length) return [];
    // find the header row (first row where ≥2 cells map to known fields)
    let headerIdx = -1, mapping = [];
    for (let i = 0; i < Math.min(grid.length, 10); i++) {
      const m = grid[i].map(mapHeader);
      if (m.filter(Boolean).length >= 2) { headerIdx = i; mapping = m; break; }
    }
    if (headerIdx === -1) return [];
    const out = [];
    for (const line of grid.slice(headerIdx + 1)) {
      const row = {};
      line.forEach((cell, ci) => { if (mapping[ci]) row[mapping[ci]] = String(cell ?? '').trim(); });
      if (!row.room && !row.name) continue;
      out.push(normalizeRow(row));
    }
    return out;
  }

  function normalizeRow(r) {
    return {
      floor: r.floor || '', room: r.room || '', bed: r.bed || '',
      name: r.name || '', phone: num(r.phone).slice(-10),
      rent: num(r.rent), advance: num(r.advance), due: num(r.due),
      joinDate: toIsoDate(r.joinDate),
      aadhaar: r.aadhaar || '', occupation: r.occupation || '', maintenance: num(r.maintenance)
    };
  }

  /* ---------- photo OCR ---------- */
  const pickPhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setProgress(t('scanning'));
    try {
      const Tesseract = (await import('tesseract.js')).default;
      const { data } = await Tesseract.recognize(file, 'eng', {
        logger: (m) => { if (m.status === 'recognizing text') setProgress(`${t('scanning')} ${Math.round(m.progress * 100)}%`); }
      });
      const parsed = textToRows(data.text || '');
      if (!parsed.length) toast(t('noRowsFound'), 'err');
      else { setRows(parsed); setPhase('preview'); }
    } catch (err) { toast(`OCR: ${err.message}`, 'err'); }
    setBusy(false); setProgress('');
  };

  // one register line → row: room number, name, 10-digit phone, ₹ amounts
  function textToRows(text) {
    const out = [];
    for (const line of text.split('\n')) {
      const s = line.trim();
      if (s.length < 4) continue;
      const phone = (s.match(/[6-9]\d{9}/) || [])[0] || '';
      const room = (s.match(/\b([A-Z]?\d{2,3})\b/) || [])[1] || '';
      const amounts = (s.replace(phone, '').match(/\b\d{3,6}\b/g) || []).filter(a => a !== room).map(Number);
      const name = s.replace(phone, '').replace(/[^A-Za-z .]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!room && !phone) continue;
      out.push(normalizeRow({
        room, name: name.slice(0, 40), phone,
        rent: amounts[0] ? String(amounts[0]) : '',
        advance: amounts[1] ? String(amounts[1]) : '',
        due: amounts[2] ? String(amounts[2]) : ''
      }));
    }
    return out;
  }

  /* ---------- import ---------- */
  const runImport = async () => {
    const valid = rows.filter(r => r.room);
    if (!valid.length) return toast(t('noRowsFound'), 'err');
    setBusy(true);
    try {
      const { summary: s } = await post(`/properties/${propId}/import`, { rows: valid });
      setSummary(s);
      setPhase('done');
    } catch (e) { toast(e.message, 'err'); }
    setBusy(false);
  };

  const setCell = (i, k, v) => setRows(rs => rs.map((r, ri) => ri === i ? { ...r, [k]: v } : r));
  const dropRow = (i) => setRows(rs => rs.filter((_, ri) => ri !== i));

  return (
    <Modal title={t('smartImport')} icon="📥" onClose={onClose}>
      {phase === 'pick' && (
        <>
          <p className="muted small mb16">{t('smartImportSub')}</p>
          <Field label={`🏠 ${t('properties')}`}>
            <select className="input" value={propId} onChange={e => setPropId(e.target.value)}>
              {properties.map(p => <option key={p.id} value={p.id}>{p.icon} {p.name}</option>)}
            </select>
          </Field>
          <label className="btn btn-primary btn-block">
            📊 {t('chooseFile')}
            <input type="file" accept=".xlsx,.xls,.csv" hidden onChange={pickSheet} />
          </label>
          <label className="btn btn-block mt8">
            📷 {t('choosePhoto')}
            <input type="file" accept="image/*" hidden onChange={pickPhoto} />
          </label>
          {busy && <p className="center mt16">⏳ {progress}</p>}
          <p className="muted small mt16">💡 {t('importHint')}</p>
          <button className="btn btn-sm btn-block mt8" onClick={template}>⬇️ {t('downloadTemplate')}</button>
        </>
      )}

      {phase === 'preview' && rows && (
        <>
          <div className="row spread mb16">
            <span className="chip green">✅ {rows.length} {t('importRows')}</span>
            <span className="muted small">{t('importPreview')}</span>
          </div>
          <div className="import-grid">
            <div className="import-row import-head">
              {['🚪', '🛏️', '🙍', '📱', '💰', '🏦', '⚠️', '📅', ''].map((h, i) => <span key={i}>{h}</span>)}
            </div>
            {rows.map((r, i) => (
              <div key={i} className="import-row">
                <input value={r.room} placeholder="101" onChange={e => setCell(i, 'room', e.target.value)} />
                <input value={r.bed} placeholder="1" onChange={e => setCell(i, 'bed', e.target.value)} />
                <input value={r.name} placeholder={t('tenantName')} onChange={e => setCell(i, 'name', e.target.value)} />
                <input value={r.phone} onChange={e => setCell(i, 'phone', e.target.value)} />
                <input value={r.rent} onChange={e => setCell(i, 'rent', e.target.value)} />
                <input value={r.advance} onChange={e => setCell(i, 'advance', e.target.value)} />
                <input value={r.due} onChange={e => setCell(i, 'due', e.target.value)} />
                <input value={r.joinDate} placeholder="YYYY-MM-DD" onChange={e => setCell(i, 'joinDate', e.target.value)} />
                <button className="btn btn-sm btn-ghost" onClick={() => dropRow(i)}>🗑️</button>
              </div>
            ))}
          </div>
          <div className="row mt16">
            <button className="btn grow" onClick={() => { setRows(null); setPhase('pick'); }}>← {t('back')}</button>
            <button className="btn btn-green grow" disabled={busy} onClick={runImport}>📥 {t('importNow')}</button>
          </div>
        </>
      )}

      {phase === 'done' && summary && (
        <div className="center">
          <div style={{ fontSize: 52 }}>🎉</div>
          <h3>{t('importDone')}</h3>
          <div className="row wrap mt16" style={{ justifyContent: 'center' }}>
            <span className="chip green">🧑 {summary.tenantsCreated}</span>
            <span className="chip">🚪 {summary.roomsCreated}</span>
            <span className="chip">🛏️ {summary.bedsCreated}</span>
            <span className="chip">🪜 {summary.floorsCreated}</span>
            {summary.skipped > 0 && <span className="chip orange">⏭️ {summary.skipped}</span>}
          </div>
          <button className="btn btn-primary btn-block mt16" onClick={onDone}>👍 {t('done')}</button>
        </div>
      )}
    </Modal>
  );
}
