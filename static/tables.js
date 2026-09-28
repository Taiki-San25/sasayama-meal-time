/* tables.js — テーブルアサイン(夕食)。見取り図に予約を割り当てる。配置の編集もここで行う */
(function () {
  const root = document.getElementById('floorApp');
  const { esc, api, toast, modal } = AMT;
  const REFRESH_MS = 30000;
  const SNAP = 4;  // 配置編集の移動の刻み
  const SEAT_SIZES = { 2: [56, 58], 4: [70, 58], 6: [96, 58] };  // サーバー(floor.py)と同じ
  const svgNS = 'http://www.w3.org/2000/svg';

  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const WEEK = '日月火水木金土';
  const dow = s => WEEK[new Date(s + 'T00:00:00').getDay()];
  const splitRooms = room => room.split(/\s*,\s*/).filter(Boolean);
  const roomText = room => { const rs = splitRooms(room); return rs.length > 1 ? `${rs[0]} 他${rs.length - 1}室` : room; };
  const roomShort = room => { const rs = splitRooms(room); return rs.length > 1 ? `${rs[0]}他` : room; };

  const params = new URLSearchParams(location.search);
  const state = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : fmtDate(new Date()),
    slot: params.get('t') || '',
    data: null,
    selected: null,     // 割り当て用に選んだ予約ID
    moveFrom: null,     // 「別の卓へ移動」中: { table, rid }(rid なしは卓の全予約)
    edit: null,         // 配置編集中: { target: 'day'|'base', tables: [...], sel: Set }
  };

  // 見取り図の壁・設備(添付の見取り図を簡易的に再現)。座標は 1000×460(サーバーの floor.py と同じ)
  const WALLS = `
    <path class="wall" d="M42 30 H640 V430 H42 Z"/>
    <path class="wall" d="M662 30 H998 V270 H662 Z"/>
    <path class="fixture" d="M168 34 H578 V114 H548 V64 H198 V114 H168 Z"/>
    <rect class="fixture" x="204" y="152" width="332" height="68" rx="4"/>
    <text class="label" x="370" y="188">四季の蔵</text>
    <text class="label small" x="373" y="54">カウンター</text>
    <text class="label small" x="975" y="20">ENT</text>`;

  root.innerHTML = `
    <div class="flBar noPrint">
      <div class="dateNav">
        <button class="iconBtn" data-act="prev" aria-label="前日"><i class="ti ti-chevron-left"></i></button>
        <input type="date" id="flDate" aria-label="日付">
        <span class="dow" id="flDow"></span>
        <button class="iconBtn" data-act="next" aria-label="翌日"><i class="ti ti-chevron-right"></i></button>
        <button class="btn" data-act="today">今日</button>
      </div>
      <div class="slotTabs" id="flSlots" role="tablist" aria-label="時間枠"></div>
      <div class="barRight">
        <button class="btn" data-act="print"><i class="ti ti-printer"></i>印刷</button>
        <button class="btn" data-act="edit" id="flEditBtn" hidden><i class="ti ti-layout-grid"></i>配置を編集</button>
      </div>
    </div>
    <div class="editBar noPrint" id="flEditBar" hidden></div>
    <h2 class="printTitle" id="flPrintTitle"></h2>
    <div class="flBody">
      <div class="flMapWrap">
        <p class="flHint noPrint" id="flHint"></p>
        <svg id="flMap" class="flMap" viewBox="0 0 1000 460" role="img" aria-label="テーブル配置図"></svg>
      </div>
      <aside class="flList noPrint" id="flList"></aside>
    </div>`;

  const $ = id => document.getElementById(id);
  const map = $('flMap');

  // ---------- データ ----------
  let loadSeq = 0;
  async function load() {
    const seq = ++loadSeq;
    const d = await api(`/api/floor?d=${state.date}`);
    if (seq !== loadSeq) return;
    state.data = d;
    map.setAttribute('viewBox', `0 0 ${d.canvas.w} ${d.canvas.h}`);
    if (!d.slots.includes(state.slot)) state.slot = d.slots[0] || '';
    render();
  }

  function setDate(d) {
    state.date = d;
    state.selected = state.moveFrom = null;
    const today = fmtDate(new Date());
    document.body.classList.toggle('dayPast', d < today);
    document.body.classList.toggle('dayFuture', d > today);
    syncUrl();
    load().catch(() => {});
  }
  function syncUrl() {
    const u = new URL(location.href);
    u.searchParams.set('d', state.date);
    if (state.slot) u.searchParams.set('t', state.slot);
    history.replaceState(null, '', u);
  }

  // ---------- 集計 ----------
  const resById = () => Object.fromEntries(state.data.reservations.map(r => [r.id, r]));
  const slotAssign = () => state.data.assignments.filter(a => a.time_slot === state.slot);
  const tablesOfRes = (rid, slot = state.slot) => {
    const names = Object.fromEntries(currentTables().map(t => [t.id, t.name]));
    return state.data.assignments.filter(a => a.time_slot === slot && a.reservation_id === rid)
      .map(a => names[a.table_id]).filter(Boolean);
  };
  const currentTables = () => state.edit ? state.edit.tables : state.data.tables;

  // ---------- 描画 ----------
  function render() {
    const d = state.data;
    $('flDate').value = state.date;
    $('flDow').textContent = `(${dow(state.date)})`;
    $('flPrintTitle').textContent = `テーブルアサイン ${state.date.replace(/-/g, '/')}(${dow(state.date)}) ${state.slot}`;
    $('flEditBtn').hidden = !d.can_edit_layout || !!state.edit;
    // 時間枠タブ: 割り当て済み/予約数
    $('flSlots').innerHTML = d.slots.map(s => {
      const rs = d.reservations.filter(r => r.time_slot === s);
      const done = rs.filter(r => d.assignments.some(a => a.time_slot === s && a.reservation_id === r.id)).length;
      return `<button type="button" role="tab" class="slotTab${s === state.slot ? ' on' : ''}" data-slot="${s}" aria-selected="${s === state.slot}">
        ${s}<small>${done}/${rs.length}組</small></button>`;
    }).join('');
    renderList();
    renderMap();
    renderEditBar();
  }

  function resCard(r, assigned) {
    const tbl = assigned ? tablesOfRes(r.id) : [];
    return `<div class="resCard${state.selected === r.id ? ' sel' : ''}${r.entered_at ? ' entered' : ''}" data-rid="${r.id}" tabindex="0">
      <div class="rcTop"><b title="${esc(r.room)}">${esc(roomText(r.room))}</b><span class="rcName">${esc(r.guest_name)}</span></div>
      <div class="rcSub">大${r.adults} 幼${r.children} 席${r.infants}
        ${r.allergy ? `<span class="rcAllergy" title="${esc(r.allergy)}"><i class="ti ti-alert-triangle"></i>アレルギー</span>` : ''}
        ${r.entered_at ? '<span class="rcEntered">入場済</span>' : ''}
        ${tbl.length ? `<span class="rcTables"><i class="ti ti-armchair"></i>${tbl.map(esc).join('・')}</span>` : ''}</div>
    </div>`;
  }

  function renderList() {
    if (state.edit) {
      $('flList').innerHTML = renderEditPanel();
      return;
    }
    const d = state.data;
    const inSlot = d.reservations.filter(r => r.time_slot === state.slot)
      .sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }));
    const assignedIds = new Set(slotAssign().map(a => a.reservation_id));
    const todo = inSlot.filter(r => !assignedIds.has(r.id));
    const done = inSlot.filter(r => assignedIds.has(r.id));
    const unset = d.reservations.filter(r => !r.time_slot).length;
    $('flList').innerHTML = `
      <h3>未アサイン <span>${todo.length}組</span></h3>
      ${todo.map(r => resCard(r, false)).join('') || '<p class="muted empty">すべて割り当て済みです</p>'}
      <h3>アサイン済 <span>${done.length}組</span></h3>
      ${done.map(r => resCard(r, true)).join('') || '<p class="muted empty">まだありません</p>'}
      ${unset ? `<p class="muted unsetNote"><i class="ti ti-info-circle"></i>時間未定の予約が${unset}組あります。夕食時間管理表で時間を決めると割り当てられます。</p>` : ''}`;
  }

  // 卓ごとの予約。複数卓にまたがる予約の人数は卓数で割って(切り上げ)数える
  function tableLoads() {
    const res = resById();
    const perRes = {};
    slotAssign().forEach(a => { perRes[a.reservation_id] = (perRes[a.reservation_id] || 0) + 1; });
    const out = {};
    slotAssign().forEach(a => {
      const r = res[a.reservation_id];
      if (!r) return;
      const n = perRes[r.id];
      const o = out[a.table_id] || (out[a.table_id] = { rs: [], adults: 0, children: 0, infants: 0 });
      o.rs.push(r);
      o.adults += Math.ceil(r.adults / n); o.children += Math.ceil(r.children / n); o.infants += Math.ceil(r.infants / n);
    });
    return out;
  }
  const people = o => o.adults + o.children + o.infants;  // 席を使う人数(席のみも含む)
  const fit = (text, w) => { const max = Math.max(3, Math.floor((w - 8) / 7.5)); return text.length > max ? text.slice(0, max - 1) + '…' : text; };

  function renderMap() {
    const loads = state.edit ? {} : tableLoads();
    const sel = state.edit ? state.edit.sel : new Set();
    map.innerHTML = WALLS + currentTables().map(t => {
      const o = loads[t.id];
      const rs = o ? o.rs : [];
      const allIn = rs.length && rs.every(r => r.entered_at), someIn = rs.some(r => r.entered_at);
      const over = o && people(o) > t.seats;
      const cls = ['tbl', rs.length ? 'busy' : 'free', allIn ? 'entered' : someIn ? 'partEntered' : '', over ? 'full' : '',
        t.parts ? 'merged' : '', sel.has(t.id) ? 'picked' : '', state.moveFrom && state.moveFrom.table === t.id ? 'moving' : '',
        rs.some(r => r.id === state.selected) ? 'mine' : ''].filter(Boolean).join(' ');
      const rooms = rs.map(r => roomShort(r.room)).join('・');
      const allergy = rs.some(r => r.allergy);
      const label = `卓${t.name} ${t.seats}名` + (rs.length ? ` ${rs.map(r => r.room).join('、')} 大人${o.adults} 幼児${o.children} 席のみ${o.infants}${allergy ? ' アレルギーあり' : ''}${allIn ? ' 入場済' : ''}` : ' 空き');
      return `<g class="${cls}" data-table="${t.id}" tabindex="0" role="button" aria-label="${esc(label)}">
        <title>${esc(label)}</title>
        <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="6"/>
        <text class="tName" x="${t.x + 5}" y="${t.y + 14}">${esc(t.name)}${allIn ? '<tspan class="tIn"> ✓</tspan>' : someIn ? '<tspan class="tIn"> (✓)</tspan>' : ''}</text>
        <text class="tSeats" x="${t.x + t.w - 4}" y="${t.y + 14}">${t.seats}名</text>
        ${rs.length ? `<text class="tRoom" x="${t.x + t.w / 2}" y="${t.y + 33}">${esc(fit(rooms, t.w))}</text>
        <text class="tPeople" x="${t.x + t.w / 2}" y="${t.y + 50}">${allergy ? '⚠' : ''}大${o.adults}幼${o.children}席${o.infants}</text>` : ''}
      </g>`;
    }).join('');
    const hint = state.edit
      ? '卓をタップで選択(複数可)、ドラッグで移動。選んだ卓は右で番号・席数を変更できます。'
      : state.moveFrom ? '移動先の卓をタップしてください(もう一度同じ卓で取り消し)。'
      : state.selected ? '割り当てる卓をタップしてください(割り当て済みの卓なら相席になります)。'
      : '予約を選んでから卓をタップ、またはドラッグ&ドロップで割り当てます。割り当て済みの卓をタップすると外す・移動ができます。人数(大人+幼児+席のみ)が席数を超えると赤字になります。';
    $('flHint').textContent = hint;
  }

  // ---------- 割り当て ----------
  async function assign(rid, tableId) {
    await api('/api/floor/assign', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid } });
    state.selected = null;
    await load();
  }
  async function move(from, toId) {
    await api('/api/floor/move', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: from.table, reservation_id: from.rid ?? null, to_table_id: toId } });
    state.moveFrom = null;
    await load();
  }
  async function unassign(tableId, rid) {
    await api('/api/floor/unassign', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid ?? null } });
    await load();
  }

  const resAt = tableId => (tableLoads()[tableId] || { rs: [] }).rs;

  function onTableClick(tableId) {
    if (state.edit) return toggleEditSel(tableId);
    const rs = resAt(tableId);
    if (state.moveFrom) {
      if (state.moveFrom.table === tableId) { state.moveFrom = null; return renderMap(); }
      return move(state.moveFrom, tableId).catch(() => {});
    }
    if (state.selected && !rs.some(r => r.id === state.selected)) return assign(state.selected, tableId).catch(() => {});
    if (!rs.length) return toast('先に右の一覧から予約を選んでください');
    const t = currentTables().find(x => x.id === tableId);
    const o = tableLoads()[tableId];
    const m = modal({
      title: `卓 ${t.name}(${t.seats}名)`,
      wide: rs.length > 1,
      body: `<div class="tblInfo">
        ${people(o) > t.seats ? `<p class="overTxt"><i class="ti ti-alert-triangle"></i>人数(${people(o)}名)が席数(${t.seats}名)を超えています</p>` : ''}
        ${rs.map(r => `<div class="tiRow">
          <div class="tiMain"><p><b>${esc(roomText(r.room))}</b> ${esc(r.guest_name)}${r.guest_name ? ' 様' : ''}
            ${r.entered_at ? '<span class="rcEntered">入場済</span>' : ''}</p>
          <p class="muted">大人${r.adults} 幼児${r.children} 席のみ${r.infants}　卓: ${tablesOfRes(r.id).map(esc).join('・')}</p>
          ${r.allergy ? `<p class="allergy"><i class="ti ti-alert-triangle"></i>${esc(r.allergy)}</p>` : ''}
          ${r.note ? `<p class="muted">備考: ${esc(r.note)}</p>` : ''}</div>
          <div class="tiBtns">
            <button type="button" class="btn" data-ti="move" data-rid="${r.id}">別の卓へ移動</button>
            <button type="button" class="btn" data-ti="add" data-rid="${r.id}">卓を追加</button>
            <button type="button" class="btn danger" data-ti="remove" data-rid="${r.id}">外す</button>
          </div></div>`).join('')}</div>`,
      buttons: [{ label: '閉じる' }].concat(rs.length > 1
        ? [{ label: 'この卓の全員を移動', primary: true, onClick: () => { state.moveFrom = { table: tableId }; state.selected = null; render(); } }] : []),
    });
    m.querySelector('.tblInfo').addEventListener('click', e => {
      const b = e.target.closest('[data-ti]');
      if (!b) return;
      const rid = +b.dataset.rid;
      m.close();
      if (b.dataset.ti === 'remove') unassign(tableId, rid).catch(() => {});
      else if (b.dataset.ti === 'move') { state.moveFrom = { table: tableId, rid }; state.selected = null; render(); }
      else { state.selected = rid; state.moveFrom = null; render(); }
    });
  }

  // ---------- ドラッグ(マウス・タッチ共通) ----------
  const toCanvas = (x, y) => {
    const pt = map.createSVGPoint(); pt.x = x; pt.y = y;
    return pt.matrixTransform(map.getScreenCTM().inverse());
  };
  let drag = null;  // { kind: 'res'|'table'|'layout', id, sx, sy, moved, ghost, ox, oy }
  function startDrag(e, kind, id) {
    if (e.button !== undefined && e.button !== 0) return;
    drag = { kind, id, sx: e.clientX, sy: e.clientY, moved: false };
    if (kind === 'layout') {
      const t = state.edit.tables.find(x => x.id === id);
      const p = toCanvas(e.clientX, e.clientY);
      drag.ox = p.x - t.x; drag.oy = p.y - t.y;
    }
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragEnd, { once: true });
    window.addEventListener('pointercancel', cancelDrag, { once: true });
  }
  function onDragMove(e) {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (!drag.moved) {
      drag.moved = true;
      document.body.classList.add('dragging');
      const rs = drag.kind === 'res' ? [resById()[drag.id]] : drag.kind === 'table' ? resAt(drag.id) : [];
      if (rs.length) {
        drag.ghost = document.createElement('div');
        drag.ghost.className = 'dragGhost';
        drag.ghost.textContent = rs.length > 1 ? `${rs.length}組を移動` : `${roomText(rs[0].room)} ${rs[0].guest_name}`;
        document.body.appendChild(drag.ghost);
      }
    }
    e.preventDefault();
    if (drag.kind === 'layout') {
      const t = state.edit.tables.find(x => x.id === drag.id);
      const p = toCanvas(e.clientX, e.clientY);
      t.x = Math.max(0, Math.min(state.data.canvas.w - t.w, Math.round((p.x - drag.ox) / SNAP) * SNAP));
      t.y = Math.max(0, Math.min(state.data.canvas.h - t.h, Math.round((p.y - drag.oy) / SNAP) * SNAP));
      state.edit.dirty = true;
      renderMap();
      return;
    }
    if (!drag.ghost) return;
    drag.ghost.style.left = e.clientX + 12 + 'px';
    drag.ghost.style.top = e.clientY + 12 + 'px';
    map.querySelectorAll('.tbl.over').forEach(g => g.classList.remove('over'));
    const over = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-table]');
    if (over) over.classList.add('over');
  }
  function cancelDrag() {
    window.removeEventListener('pointermove', onDragMove);
    if (drag && drag.ghost) drag.ghost.remove();
    document.body.classList.remove('dragging');
    map.querySelectorAll('.tbl.over').forEach(g => g.classList.remove('over'));
    drag = null;
  }
  function onDragEnd(e) {
    const dg = drag;
    const target = dg && dg.moved ? document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-table]') : null;
    cancelDrag();
    if (!dg) return;
    if (!dg.moved) {  // クリック扱い
      if (dg.kind === 'res') { state.selected = state.selected === dg.id ? null : dg.id; state.moveFrom = null; render(); }
      else onTableClick(dg.id);
      return;
    }
    if (dg.kind === 'layout') return renderList();
    if (!target) return;
    const to = target.dataset.table;
    if (dg.kind === 'res') assign(dg.id, to).catch(() => {});
    else if (dg.kind === 'table' && to !== dg.id) move({ table: dg.id }, to).catch(() => {});
  }

  $('flList').addEventListener('pointerdown', e => {
    const card = e.target.closest('.resCard');
    if (card && !state.edit) startDrag(e, 'res', +card.dataset.rid);
  });
  $('flList').addEventListener('keydown', e => {
    const card = e.target.closest('.resCard');
    if (card && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      const id = +card.dataset.rid;
      state.selected = state.selected === id ? null : id;
      render();
    }
  });
  map.addEventListener('pointerdown', e => {
    const g = e.target.closest('[data-table]');
    if (!g) return;
    const id = g.dataset.table;
    if (state.edit) return startDrag(e, 'layout', id);
    startDrag(e, resAt(id).length ? 'table' : 'free', id);
  });
  map.addEventListener('keydown', e => {
    const g = e.target.closest('[data-table]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onTableClick(g.dataset.table); }
  });
  // 卓の選択(配置編集中)は pointerup のクリック扱いで toggleEditSel を呼ぶ

  // ---------- 配置の編集 ----------
  const clone = v => JSON.parse(JSON.stringify(v));
  const newId = () => 't' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  async function enterEdit(target) {
    const tables = target === 'base' ? (await api('/api/floor/base')).tables : state.data.tables;
    state.edit = { target, tables: clone(tables), sel: new Set(), dirty: false };
    state.selected = state.moveFrom = null;
    render();
  }
  function exitEdit() {
    state.edit = null;
    render();
  }
  function toggleEditSel(id) {
    const s = state.edit.sel;
    s.has(id) ? s.delete(id) : s.add(id);
    renderMap();
    renderList();
    renderEditBar();
  }
  const dayAssigned = ids => state.edit.target === 'day'
    ? state.data.assignments.filter(a => ids.includes(a.table_id)) : [];

  function renderEditBar() {
    const bar = $('flEditBar');
    if (!state.edit) { bar.hidden = true; document.body.classList.remove('floorEditing'); return; }
    document.body.classList.add('floorEditing');
    const e = state.edit;
    const sel = [...e.sel];
    const one = sel.length === 1 ? e.tables.find(t => t.id === sel[0]) : null;
    bar.hidden = false;
    bar.innerHTML = `
      <div class="ebTarget" role="radiogroup" aria-label="編集する配置">
        <label><input type="radio" name="ebTarget" value="day" ${e.target === 'day' ? 'checked' : ''}>この日(${state.date.slice(5).replace('-', '/')})の配置</label>
        <label><input type="radio" name="ebTarget" value="base" ${e.target === 'base' ? 'checked' : ''}>基本レイアウト</label>
      </div>
      <span class="ebSep"></span>
      <label class="ebAdd">卓を追加<select id="ebSeats"><option value="2">2名</option><option value="4" selected>4名</option><option value="6">6名</option></select></label>
      <button class="btn" data-eb="add"><i class="ti ti-plus"></i>追加</button>
      <button class="btn" data-eb="merge" ${sel.length >= 2 ? '' : 'disabled'}><i class="ti ti-link"></i>連結</button>
      <button class="btn" data-eb="split" ${one && one.parts ? '' : 'disabled'}><i class="ti ti-unlink"></i>連結を解除</button>
      <button class="btn" data-eb="delete" ${sel.length ? '' : 'disabled'}><i class="ti ti-trash"></i>削除</button>
      ${e.target === 'day' ? `<button class="btn" data-eb="copyPrev"><i class="ti ti-copy"></i>前日の配置をコピー</button>
        <button class="btn" data-eb="reset"><i class="ti ti-restore"></i>基本に戻す</button>` : ''}
      <span class="ebSpacer"></span>
      <button class="btn" data-eb="cancel">キャンセル</button>
      <button class="btn primary" data-eb="save"><i class="ti ti-device-floppy"></i>保存</button>`;
  }

  function renderEditPanel() {
    const e = state.edit;
    const sel = e.tables.filter(t => e.sel.has(t.id));
    if (sel.length !== 1) {
      return `<h3>配置の編集</h3>
        <p class="muted">${sel.length ? `${sel.length}卓を選択中。「連結」で1つの卓にできます。` : '卓をタップして選択してください。'}</p>
        <p class="muted small">${e.target === 'base' ? '基本レイアウトは、配置を変えていない日と、これから割り当てる日に使われます。' : 'この日だけの配置です。基本レイアウトは変わりません。'}</p>`;
    }
    const t = sel[0];
    const std = [2, 4, 6].includes(t.seats) && !t.parts;
    return `<h3>卓の設定</h3>
      <form class="form" id="ebForm">
        <label>卓番号<input type="text" name="name" value="${esc(t.name)}" maxlength="16" required></label>
        <label>席数${std
          ? `<select name="seats">${[2, 4, 6].map(n => `<option value="${n}"${n === t.seats ? ' selected' : ''}>${n}名</option>`).join('')}</select>`
          : `<input type="number" name="seats" value="${t.seats}" min="1" max="60" required>`}</label>
        ${t.parts ? `<p class="muted small">連結: ${t.parts.map(p => esc(p.name)).join('＋')}</p>` : ''}
      </form>`;
  }

  $('flList').addEventListener('change', e => {
    if (!state.edit || !e.target.closest('#ebForm')) return;
    const t = state.edit.tables.find(x => state.edit.sel.has(x.id));
    const f = e.target.form;
    if (e.target.name === 'name') {
      const v = f.name.value.trim();
      if (!v) return toast('卓番号を入力してください', true);
      if (state.edit.tables.some(x => x !== t && x.name === v)) { f.name.value = t.name; return toast(`卓番号「${v}」は使われています`, true); }
      t.name = v;
    } else if (e.target.name === 'seats') {
      const n = +f.seats.value;
      if (!(n >= 1 && n <= 60)) return toast('席数は1〜60で入力してください', true);
      t.seats = n;
      if (!t.parts && SEAT_SIZES[n]) {  // 標準の卓は席数に合わせて大きさも変える
        const [w, h] = SEAT_SIZES[n];
        t.x += Math.round((t.w - w) / 2); t.w = w; t.h = h;
      }
    }
    state.edit.dirty = true;
    renderMap();
  });

  function nextName() {
    const nums = state.edit.tables.map(t => parseInt(t.name, 10)).filter(n => !isNaN(n));
    let n = (nums.length ? Math.max(...nums) : 0) + 1;
    while (state.edit.tables.some(t => t.name === String(n))) n++;
    return String(n);
  }

  async function onEditAction(act) {
    const e = state.edit;
    const sel = e.tables.filter(t => e.sel.has(t.id));
    if (act === 'add') {
      const seats = +$('ebSeats').value;
      const [w, h] = SEAT_SIZES[seats];
      const t = { id: newId(), name: nextName(), seats, x: 480 - w / 2, y: 226, w, h };
      e.tables.push(t);
      e.sel = new Set([t.id]);
      e.dirty = true;
      toast(`卓${t.name}を追加しました。ドラッグで配置してください`);
    } else if (act === 'merge') {
      if (dayAssigned(sel.map(t => t.id)).length) return toast('割り当てのある卓は連結できません。先に割り当てを外してください', true);
      const parts = sel.flatMap(t => t.parts || [t]).map(p => clone(p));
      const x = Math.min(...sel.map(t => t.x)), y = Math.min(...sel.map(t => t.y));
      const x2 = Math.max(...sel.map(t => t.x + t.w)), y2 = Math.max(...sel.map(t => t.y + t.h));
      const m = { id: newId(), name: sel.map(t => t.name).join('+').slice(0, 16), seats: sel.reduce((s, t) => s + t.seats, 0),
        x, y, w: x2 - x, h: y2 - y, parts };
      e.tables = e.tables.filter(t => !e.sel.has(t.id)).concat(m);
      e.sel = new Set([m.id]);
      e.dirty = true;
    } else if (act === 'split') {
      const m = sel[0];
      if (dayAssigned([m.id]).length) return toast('割り当てのある卓は解除できません。先に割り当てを外してください', true);
      const taken = new Set(e.tables.filter(t => t !== m).map(t => t.name));
      const parts = m.parts.map(p => ({ ...clone(p), id: e.tables.some(t => t.id === p.id) ? newId() : p.id }));
      parts.forEach(p => { if (taken.has(p.name)) p.name = nextName(); taken.add(p.name); });
      e.tables = e.tables.filter(t => t !== m).concat(parts);
      e.sel = new Set(parts.map(p => p.id));
      e.dirty = true;
    } else if (act === 'delete') {
      const n = dayAssigned(sel.map(t => t.id)).length;
      if (n && !(await confirmDialog({ title: '卓の削除', message: `割り当て済みの予約が${n}件あります。保存すると割り当てが外れます。削除しますか？`, ok: '削除する', danger: true }))) return;
      e.tables = e.tables.filter(t => !e.sel.has(t.id));
      e.sel = new Set();
      e.dirty = true;
    } else if (act === 'copyPrev') {
      const prev = await api(`/api/floor?d=${addDays(state.date, -1)}`);
      const gone = state.data.assignments.filter(a => !prev.tables.some(t => t.id === a.table_id)).length;
      if (gone && !(await confirmDialog({ title: '前日の配置をコピー', message: `前日にない卓の割り当て${gone}件は、保存すると外れます。コピーしますか？`, ok: 'コピーする' }))) return;
      e.tables = clone(prev.tables);
      e.sel = new Set();
      e.dirty = true;
      toast('前日の配置をコピーしました。保存すると反映されます');
    } else if (act === 'reset') {
      if (!(await confirmDialog({ title: '基本に戻す', message: 'この日の配置を基本レイアウトに戻します。基本にない卓の割り当ては外れます。よろしいですか？', ok: '基本に戻す', danger: true }))) return;
      const r = await api(`/api/floor/layout?d=${state.date}`, { method: 'DELETE' });
      toast(r.released ? `基本に戻しました(割り当て${r.released}件を外しました)` : '基本に戻しました');
      state.edit = null;
      return load();
    } else if (act === 'cancel') {
      if (e.dirty && !(await confirmDialog({ title: '編集をやめる', message: '保存していない変更は失われます。よろしいですか？', ok: '変更を破棄' }))) return;
      return exitEdit();
    } else if (act === 'save') {
      const body = { tables: e.tables };
      if (e.target === 'base') {
        await api('/api/floor/base', { method: 'PUT', body });
        toast('基本レイアウトを保存しました');
      } else {
        const r = await api(`/api/floor/layout?d=${state.date}`, { method: 'PUT', body });
        toast(r.released ? `保存しました(割り当て${r.released}件を外しました)` : '保存しました');
      }
      state.edit = null;
      return load();
    }
    renderMap();
    renderList();
    renderEditBar();
  }

  $('flEditBar').addEventListener('click', e => {
    const b = e.target.closest('[data-eb]');
    if (b) onEditAction(b.dataset.eb).catch(() => {});
  });
  $('flEditBar').addEventListener('change', async e => {
    if (e.target.name !== 'ebTarget') return;
    if (state.edit.dirty && !(await confirmDialog({ title: '編集対象の切り替え', message: '保存していない変更は失われます。切り替えますか？', ok: '切り替える' }))) {
      e.target.checked = false;
      root.querySelector(`input[name=ebTarget][value=${state.edit.target}]`).checked = true;
      return;
    }
    enterEdit(e.target.value).catch(() => {});
  });

  function confirmDialog({ title, message, ok, cancel = 'キャンセル', danger }) {
    return new Promise(resolve => {
      let yes = false;
      modal({
        title,
        body: `<p style="margin:0">${message}</p>`,
        buttons: [{ label: cancel }, { label: ok, primary: !danger, danger, onClick: () => { yes = true; } }],
        onClose: () => resolve(yes),
      });
    });
  }

  // ---------- 上部バー ----------
  root.querySelector('.flBar').addEventListener('click', e => {
    const tab = e.target.closest('[data-slot]');
    if (tab) {
      state.slot = tab.dataset.slot;
      state.selected = state.moveFrom = null;
      syncUrl();
      return render();
    }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (state.edit && ['prev', 'next', 'today'].includes(act)) return toast('配置の編集中は日付を変えられません', true);
    if (act === 'prev') setDate(addDays(state.date, -1));
    else if (act === 'next') setDate(addDays(state.date, 1));
    else if (act === 'today') setDate(fmtDate(new Date()));
    else if (act === 'print') window.print();
    else if (act === 'edit') enterEdit('day').catch(() => {});
  });
  $('flDate').addEventListener('change', e => {
    if (state.edit) { e.target.value = state.date; return toast('配置の編集中は日付を変えられません', true); }
    if (e.target.value) setDate(e.target.value);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && !AMT.isModalOpen() && (state.selected || state.moveFrom)) {
      state.selected = state.moveFrom = null;
      render();
    }
  });

  // 30秒ごとに更新(編集中・操作中・モーダル表示中・タブ非表示のときは止める)
  const idle = () => !state.edit && !drag && !AMT.isModalOpen() && !document.hidden;
  setInterval(() => { if (idle()) load().catch(() => {}); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (idle()) load().catch(() => {}); });

  setDate(state.date);
})();
