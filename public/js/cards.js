// cards.js — 卡片元件：圖表卡（可切換類型，記憶在 localStorage）與表格卡
(function () {
  const charts = {};   // id → Chart instance

  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_LABEL = { line: '折線', smooth: '曲線', bar: '長條', pie: '圓餅' };

  function prefKey(id) { return `traf_chart_type_${id}`; }

  // ── 匯出機制 ─────────────────────────────────────
  let _exportPost = null;
  function configureExport({ post }) { _exportPost = post; }

  function downloadBlob(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function csvOf(headers, rows) {
    const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.map(q).join(','), ...rows.map(r => r.map(q).join(','))];
    return new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  }

  function openExportModal({ exp, canvas }) {
    const modal = document.querySelector('#export-modal');
    const fmts = document.querySelector('#export-formats');
    const flds = document.querySelector('#export-fields');
    const formats = [['xlsx', 'Excel (.xlsx)'], ['csv', 'CSV'], ...(canvas ? [['png', 'PNG 圖片']] : [])];
    fmts.innerHTML = formats.map(([v, t], i) =>
      `<label><input type="radio" name="exp-fmt" value="${v}" ${i === 0 ? 'checked' : ''}> ${t}</label>`).join('');
    flds.innerHTML = exp.fields.map(f =>
      `<label><input type="checkbox" class="exp-field" value="${esc(f.key)}" checked> ${esc(f.label)}</label>`).join('');
    modal.hidden = false;
    document.querySelector('#export-cancel').onclick = () => { modal.hidden = true; };
    document.querySelector('#export-go').onclick = async () => {
      const fmt = document.querySelector('input[name="exp-fmt"]:checked').value;
      const picked = [...document.querySelectorAll('.exp-field:checked')].map(i => i.value);
      const fields = exp.fields.filter(f => picked.includes(f.key));
      if (!fields.length && fmt !== 'png') return alert('至少勾選一個欄位');
      try {
        if (fmt === 'png') {
          const url = charts[exp.chartId]?.toBase64Image() || canvas.toDataURL('image/png');
          const a = document.createElement('a'); a.href = url; a.download = `${exp.filename}.png`; a.click();
        } else {
          const headers = fields.map(f => f.label);
          const rows = exp.rows.map(r => fields.map(f => r[f.key] ?? ''));
          if (fmt === 'csv') downloadBlob(csvOf(headers, rows), `${exp.filename}.csv`);
          else downloadBlob(await _exportPost({ filename: exp.filename, headers, rows }), `${exp.filename}.xlsx`);
        }
        modal.hidden = true;
      } catch (err) { alert(`匯出失敗：${err.message}`); }
    };
  }

  // datasets: { labels: [...], series: [{ label, data, color }] }
  // cmp（選用）: { labels, series } 同形狀，非 pie 時以虛線疊圖
  function render(id, canvas, type, ds, cmp) {
    if (charts[id]) charts[id].destroy();
    const isPie = type === 'pie';
    const chartType = isPie ? 'pie' : (type === 'bar' ? 'bar' : 'line');
    charts[id] = new Chart(canvas, {
      type: chartType,
      data: {
        labels: ds.labels,
        datasets: isPie
          ? [{ data: ds.series[0].data,
               backgroundColor: ['#1565c0','#26a69a','#ef6c00','#8e24aa','#c62828',
                                 '#5c6bc0','#00897b','#f9a825','#6d4c41','#78909c'] }]
          : [
              ...ds.series.map(s => ({
                label: s.label, data: s.data,
                borderColor: s.color, backgroundColor: s.color + '55',
                tension: type === 'smooth' ? 0.35 : 0,
                fill: false,
              })),
              // 比較資料以索引對齊主區間 labels（第 n 天對第 n 天）；cmp.labels 僅供匯出用
              ...(cmp && !isPie ? cmp.series.map(s => ({
                label: `${s.label}（比較）`, data: s.data.slice(0, ds.labels.length),
                borderColor: s.color + '88', backgroundColor: s.color + '22',
                borderDash: [6, 4], tension: type === 'smooth' ? 0.35 : 0, fill: false,
                ...(chartType === 'bar' ? {} : { pointRadius: 0 }),
              })) : []),
            ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: isPie || ds.series.length > 1 || Boolean(cmp) } },
        scales: isPie ? {} : { y: { beginAtZero: true } },
      },
    });
  }

  // 圖表卡：types 是這張卡允許的類型，使用者選擇存 localStorage
  // compare（選用）: { labels, series } 同 datasets，非 pie 疊虛線比較圖
  // exp（選用）: { filename, fields: [{key,label}], rows: [{...}] } — 提供時卡頭顯示匯出鈕
  function chartCard({ id, title, el, types, defaultType, datasets, wide, compare, exp }) {
    const card = document.createElement('div');
    card.className = 'card' + (wide ? ' wide' : '');
    const saved = localStorage.getItem(prefKey(id));
    let current = types.includes(saved) ? saved : defaultType;

    const head = document.createElement('div');
    head.className = 'card-head';
    head.innerHTML = `<h2>${esc(title)}</h2>`;
    const sw = document.createElement('div');
    sw.className = 'type-switch';
    for (const t of types) {
      const btn = document.createElement('button');
      btn.textContent = TYPE_LABEL[t];
      btn.className = t === current ? 'active' : '';
      btn.onclick = () => {
        current = t;
        localStorage.setItem(prefKey(id), t);
        sw.querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        render(id, canvas, current, datasets, compare);
      };
      sw.appendChild(btn);
    }
    head.appendChild(sw);
    if (exp) {
      const eb = document.createElement('button');
      eb.className = 'export-btn';
      eb.textContent = '匯出';
      eb.onclick = () => openExportModal({ exp: { ...exp, chartId: id }, canvas });
      head.appendChild(eb);
    }
    card.appendChild(head);

    const wrap = document.createElement('div');
    wrap.style.height = '260px';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    card.appendChild(wrap);
    el.appendChild(card);
    render(id, canvas, current, datasets, compare);
  }

  function kpiCard({ el, label, value, delta }) {
    const card = document.createElement('div');
    card.className = 'card kpi';
    const d = delta ? `<div class="kpi-delta ${esc(delta.cls)}">${esc(delta.text)}</div>` : '';
    card.innerHTML = `<div class="kpi-value">${esc(value)}</div><div class="kpi-label">${esc(label)}</div>${d}`;
    el.appendChild(card);
  }

  // columns: [{key, label, num?, format?, clsKey?}]
  // exp（選用）: { filename, fields: [{key,label}], rows: [{...}] } — 提供時卡頭顯示匯出鈕（無 PNG 選項）
  function tableCard({ title, el, columns, rows, wide, exp }) {
    const card = document.createElement('div');
    card.className = 'card' + (wide ? ' wide' : '');
    const ths = columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const trs = rows.map(r =>
      `<tr>${columns.map(c => {
        const v = c.format ? c.format(r[c.key]) : r[c.key];
        const cls = `${c.num ? 'num' : ''} ${c.clsKey ? esc(r[c.clsKey] || '') : ''}`;
        return `<td class="${cls}">${esc(v)}</td>`;
      }).join('')}</tr>`).join('');
    const expBtn = exp ? `<button class="export-btn">匯出</button>` : '';
    card.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2>${expBtn}</div>
      <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    if (exp) {
      card.querySelector('.export-btn').onclick = () => openExportModal({ exp });
    }
    el.appendChild(card);
  }

  window.Cards = { chartCard, kpiCard, tableCard, configureExport };
})();
