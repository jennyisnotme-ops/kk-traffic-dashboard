// cards.js — 卡片元件：圖表卡（可切換類型，記憶在 localStorage）與表格卡
(function () {
  const charts = {};   // id → Chart instance

  const esc = v => String(v ?? '').replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const TYPE_LABEL = { line: '折線', smooth: '曲線', bar: '長條', pie: '圓餅' };

  function prefKey(id) { return `traf_chart_type_${id}`; }

  // datasets: { labels: [...], series: [{ label, data, color }] }
  function render(id, canvas, type, ds) {
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
          : ds.series.map(s => ({
              label: s.label, data: s.data,
              borderColor: s.color, backgroundColor: s.color + '55',
              tension: type === 'smooth' ? 0.35 : 0,
              fill: false,
            })),
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: isPie || ds.series.length > 1 } },
        scales: isPie ? {} : { y: { beginAtZero: true } },
      },
    });
  }

  // 圖表卡：types 是這張卡允許的類型，使用者選擇存 localStorage
  function chartCard({ id, title, el, types, defaultType, datasets, wide }) {
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
        render(id, canvas, current, datasets);
      };
      sw.appendChild(btn);
    }
    head.appendChild(sw);
    card.appendChild(head);

    const wrap = document.createElement('div');
    wrap.style.height = '260px';
    const canvas = document.createElement('canvas');
    wrap.appendChild(canvas);
    card.appendChild(wrap);
    el.appendChild(card);
    render(id, canvas, current, datasets);
  }

  function kpiCard({ el, label, value }) {
    const card = document.createElement('div');
    card.className = 'card kpi';
    card.innerHTML = `<div class="kpi-value">${esc(value)}</div><div class="kpi-label">${esc(label)}</div>`;
    el.appendChild(card);
  }

  // columns: [{key, label, num?, format?}]
  function tableCard({ title, el, columns, rows, wide }) {
    const card = document.createElement('div');
    card.className = 'card' + (wide ? ' wide' : '');
    const ths = columns.map(c => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('');
    const trs = rows.map(r =>
      `<tr>${columns.map(c => {
        const v = c.format ? c.format(r[c.key]) : r[c.key];
        return `<td class="${c.num ? 'num' : ''}">${esc(v)}</td>`;
      }).join('')}</tr>`).join('');
    card.innerHTML = `<div class="card-head"><h2>${esc(title)}</h2></div>
      <table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table>`;
    el.appendChild(card);
  }

  window.Cards = { chartCard, kpiCard, tableCard };
})();
