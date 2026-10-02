/* tables.js — テーブルアサイン(夕食)。見取り図に予約を割り当てる。配置の編集もここで行う */
(function () {
  const root = document.getElementById('floorApp');
  const { esc, api, toast, modal } = AMT;
  const REFRESH_MS = 30000;
  const SNAP = 4;  // 配置編集の移動の刻み
  const ALIGN_TH = 10;  // 他の卓の端・中心にこの距離まで近づいたら揃える(吸着)
  const SEAT_SIZES = { 2: [56, 58], 4: [70, 58], 6: [96, 58], 8: [122, 58], 10: [148, 58] };  // サーバー(floor.py)と同じ
  const STD_SEATS = Object.keys(SEAT_SIZES).map(Number);  // 卓を追加・席数のプルダウン(2・4・6・8・10名)
  const svgNS = 'http://www.w3.org/2000/svg';

  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const WEEK = '日月火水木金土';
  const dow = s => WEEK[new Date(s + 'T00:00:00').getDay()];
  // 印刷するとき(印刷ボタン・Ctrl+P とも)に、タイトルの下へ印刷した日時を入れる
  window.addEventListener('beforeprint', () => {
    const now = new Date();
    document.getElementById('flPrintTime').textContent =
      `印刷日時: ${fmtDate(now).replace(/-/g, '/')}(${dow(fmtDate(now))}) ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
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
    <rect class="fixture" x="204" y="152" width="332" height="68" rx="4"/>`;

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
    <p class="printTime" id="flPrintTime"></p>
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
  async function load(auto = false) {
    const seq = ++loadSeq;
    const d = await api(`/api/floor?d=${state.date}`, { auto });
    if (seq !== loadSeq) return;
    state.data = d;
    state.groups = AMT.groupInfo(d.reservations);  // 夕食時間管理表と同じ G1, G2…
    // 他の端末で削除・時間変更された予約や、外された卓を選んだままにしない
    const here = d.reservations.filter(r => r.time_slot === state.slot).map(r => r.id);
    if (state.selected && !here.includes(state.selected)) state.selected = null;
    if (state.moveFrom && !d.assignments.some(a => a.time_slot === state.slot && a.table_id === state.moveFrom.table
      && (state.moveFrom.rid == null || a.reservation_id === state.moveFrom.rid))) state.moveFrom = null;
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
  const groupOf = r => state.groups[r.group_id];
  const grpTag = r => {
    const g = groupOf(r);
    return g ? `<span class="grpTag g${AMT.groupColor(g)}" title="グループ: ${esc(g.members.map(m => roomText(m.room)).join('・'))}">G${g.no}</span>` : '';
  };

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
      // 全員が卓に座った予約の数(人数未入力の予約は1卓に置けば済み)
      const done = rs.filter(r => {
        const mine = d.assignments.filter(a => a.time_slot === s && a.reservation_id === r.id);
        const seated = mine.reduce((n, a) => n + (a.counts ? a.counts.adults + a.counts.children + a.counts.infants : 0), 0);
        return mine.length && seated >= r.adults + r.children + r.infants;
      }).length;
      return `<button type="button" role="tab" class="slotTab${s === state.slot ? ' on' : ''}" data-slot="${esc(s)}" aria-selected="${s === state.slot}">
        ${esc(s)}<small>${done}/${rs.length}組</small></button>`;
    }).join('');
    renderList();
    renderMap();
    renderEditBar();
  }

  function resCard(r, assigned) {
    const tbl = tablesOfRes(r.id);
    const rest = seatSummary()[r.id]?.rest ?? 0;
    return `<div class="resCard${assigned ? '' : ' todo'}${state.selected === r.id ? ' sel' : ''}${r.entered_at ? ' entered' : ''}" data-rid="${r.id}" tabindex="0">
      <div class="rcTop"><b title="${esc(r.room)}">${esc(roomText(r.room))}</b>${grpTag(r)}${stayTag(r)}<span class="rcName">${esc(r.guest_name)}</span></div>
      <div class="rcSub">大${r.adults} 幼${r.children} 席${r.infants}
        ${r.allergy ? `<span class="rcAllergy" title="${esc(r.allergy)}"><i class="ti ti-alert-triangle"></i>アレルギー</span>` : ''}
        ${r.entered_at ? '<span class="rcEntered">入場済</span>' : ''}
        ${r.adults ? '' : '<span class="rcNoCount" title="大人が0人です。夕食時間管理表で人数を入力してください">人数未入力</span>'}
        ${tbl.length ? `<span class="rcTables"><i class="ti ti-armchair"></i>${tbl.map(esc).join('・')}</span>` : ''}
        ${tbl.length && rest ? `<span class="rcRemain" title="まだ卓に座っていない人数">残り${rest}名</span>` : ''}</div>
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
    const sum = seatSummary();
    const seated = r => sum[r.id] && !sum[r.id].rest;  // 全員が卓に座った(人数未入力の予約は1卓に置けば済み)
    const todo = inSlot.filter(r => !seated(r));
    const done = inSlot.filter(seated);
    const unset = d.reservations.filter(r => !r.time_slot).length;
    $('flList').innerHTML = `
      <h3>未アサイン <span>${todo.length}組</span></h3>
      ${todo.map(r => resCard(r, false)).join('') || '<p class="muted empty">すべて割り当て済みです</p>'}
      <h3>アサイン済 <span>${done.length}組</span></h3>
      ${done.map(r => resCard(r, true)).join('') || '<p class="muted empty">まだありません</p>'}
      ${unset ? `<p class="muted unsetNote"><i class="ti ti-info-circle"></i>時間未定の予約が${unset}組あります。夕食時間管理表で時間を決めると割り当てられます。</p>` : ''}`;
  }

  // 卓に座っている人数(割り当てごとに大人・幼児・席のみ)
  const COUNT_KEYS = ['adults', 'children', 'infants'];
  const countsOf = a => a.counts || { adults: 0, children: 0, infants: 0 };
  // 予約ごとの座った人数と残り
  function seatSummary() {
    const out = {};
    slotAssign().forEach(a => {
      const o = out[a.reservation_id] || (out[a.reservation_id] = { seated: 0, tables: 0 });
      o.seated += COUNT_KEYS.reduce((n, k) => n + countsOf(a)[k], 0);
      o.tables++;
    });
    Object.entries(out).forEach(([rid, o]) => {
      const r = resById()[rid];
      o.total = r ? r.adults + r.children + r.infants : 0;
      o.rest = Math.max(0, o.total - o.seated);
    });
    return out;
  }
  // 卓ごとの予約と人数
  function tableLoads() {
    const res = resById();
    const out = {};
    slotAssign().forEach(a => {
      const r = res[a.reservation_id];
      if (!r) return;
      const o = out[a.table_id] || (out[a.table_id] = { rs: [], adults: 0, children: 0, infants: 0 });
      o.rs.push(r);
      COUNT_KEYS.forEach(k => { o[k] += countsOf(a)[k]; });
    });
    return out;
  }
  const people = o => o.adults + o.children + o.infants;  // 席を使う人数(席のみも含む)
  const fit = (text, w) => { const max = Math.max(3, Math.floor((w - 8) / 7.5)); return text.length > max ? text.slice(0, max - 1) + '…' : text; };

  // 卓の上に卓メモの冒頭5文字(相席で複数あれば「他」を付ける)。全文はホバー/卓のモーダルで
  function memoTag(t) {
    if (state.edit) return '';
    const memos = slotAssign().filter(a => a.table_id === t.id && a.memo).map(a => a.memo.replace(/\s+/g, ' ').trim());
    if (!memos.length) return '';
    const head = [...memos[0]].slice(0, 5).join('');
    return `<text class="tMemo" x="${t.x + t.w / 2}" y="${t.y - 4}"><title>${esc(memos.join(' / '))}</title>📝${esc(head)}${memos.length > 1 ? ' 他' : ''}</text>`;
  }

  // 卓の左下にグループの札(相席で複数のグループなら横に並べる)
  // 2泊目以降の予約(管理表の泊数バッジと同じ色)
  const stayTag = r => r.night_no >= 2
    ? `<span class="stayTag" title="連泊の${r.night_no}泊目">${r.night_no}泊/${r.nights}泊</span>` : '';

  function groupMark(t, rs) {
    if (state.edit) return '';
    const gs = [...new Set(rs.map(groupOf).filter(Boolean))].sort((a, b) => a.no - b.no);
    let x = t.x - 4;
    return gs.map(g => {
      const w = g.no > 9 ? 26 : 20, y = t.y + t.h - 6;  // 下の枠線にまたがせて、人数の文字と重ならないように
      const out = `<g class="tGrp g${AMT.groupColor(g)}"><rect x="${x}" y="${y}" width="${w}" height="14" rx="3"/>
        <text x="${x + w / 2}" y="${y + 10.5}">G${g.no}</text></g>`;
      x += w + 2;
      return out;
    }).join('') + [...new Set(rs.map(r => r.night_no).filter(n => n >= 2))].sort((a, b) => a - b).map(n => {
      // 2泊目以降の札はグループの札の右に並べる
      const w = n > 9 ? 38 : 32, y = t.y + t.h - 6;
      const out = `<g class="tStay"><rect x="${x}" y="${y}" width="${w}" height="14" rx="3"/>
        <text x="${x + w / 2}" y="${y + 10.5}">${n}泊目</text></g>`;
      x += w + 2;
      return out;
    }).join('');
  }

  function renderMap() {
    const loads = state.edit ? {} : tableLoads();
    const sel = state.edit ? state.edit.sel : new Set();
    map.innerHTML = WALLS + currentTables().map(t => {
      const o = loads[t.id];
      const rs = o ? o.rs : [];
      const noCount = rs.filter(r => !r.adults).length;  // 大人0 = 人数未入力(席数超過を判定できない)
      const allIn = rs.length && rs.every(r => r.entered_at), someIn = rs.some(r => r.entered_at);
      const over = o && people(o) > t.seats;
      const cls = ['tbl', rs.length ? 'busy' : 'free', allIn ? 'entered' : someIn ? 'partEntered' : '', over ? 'full' : '',
        t.parts ? 'merged' : '', sel.has(t.id) ? 'picked' : '', state.moveFrom && state.moveFrom.table === t.id ? 'moving' : '',
        rs.some(r => r.id === state.selected) ? 'mine' : '', noCount ? 'noCount' : ''].filter(Boolean).join(' ');
      const rooms = rs.map(r => roomShort(r.room)).join('・');
      const allergy = rs.some(r => r.allergy);
      const label = `卓${t.name} ${t.seats}名` + (rs.length ? ` ${rs.map(r => r.room).join('、')} 大人${o.adults} 幼児${o.children} 席のみ${o.infants}${allergy ? ' アレルギーあり' : ''}${rs.some(groupOf) ? ` グループ${[...new Set(rs.map(groupOf).filter(Boolean))].map(g => 'G' + g.no).join('・')}` : ''}${rs.some(r => r.night_no >= 2) ? ' 連泊2泊目以降あり' : ''}${allIn ? ' 入場済' : ''}${noCount ? ` 人数未入力${noCount}組` : ''}` : ' 空き');
      return `<g class="${cls}" data-table="${t.id}" tabindex="0" role="button" aria-label="${esc(label)}">
        <title>${esc(label)}</title>
        <rect x="${t.x}" y="${t.y}" width="${t.w}" height="${t.h}" rx="6"/>
        ${memoTag(t)}
        ${groupMark(t, rs)}
        <text class="tName" x="${t.x + 5}" y="${t.y + 14}">${esc(t.name)}${allIn ? '<tspan class="tIn"> ✓</tspan>' : someIn ? '<tspan class="tIn"> (✓)</tspan>' : ''}</text>
        <text class="tSeats" x="${t.x + t.w - 4}" y="${t.y + 14}">${t.seats}名</text>
        ${rs.length ? `<text class="tRoom" x="${t.x + t.w / 2}" y="${t.y + 33}">${esc(fit(rooms, t.w))}</text>
        <text class="tPeople" x="${t.x + t.w / 2}" y="${t.y + 50}">${allergy ? '⚠' : ''}${noCount === rs.length ? '人数未入力'
          : `大${o.adults}幼${o.children}席${o.infants}${noCount ? '+未' : ''}`}</text>` : ''}
      </g>`;
    }).join('') + (state.edit && state.edit.guides ? state.edit.guides.map(g =>
      `<line class="guide" x1="${g.x1}" y1="${g.y1}" x2="${g.x2}" y2="${g.y2}"/>`).join('') : '');
    const hint = state.edit
      ? '卓をタップで選択(複数可)、ドラッグで移動(他の卓と端・中心が揃うと赤い線が出て吸着、Altキーを押しながらで吸着なし)。選んだ卓は矢印キーで微調整、複数選ぶと「揃える」「等間隔」が使えます。'
      : state.moveFrom ? '移動先の卓をタップしてください(もう一度同じ卓で取り消し)。'
      : state.selected ? '割り当てる卓をタップしてください(空席の分だけ座ります。割り当て済みの卓なら相席)。'
      : '予約を選んでから卓をタップ、またはドラッグ&ドロップで割り当てます。割り当て済みの卓をタップすると外す・移動ができます。卓には空席の分だけ座り(大人→幼児→席のみの順)、座りきれない人数は未アサインに「残り○名」として残ります。卓をタップすると卓ごとの人数を変えられます。「人数未入力」「+未」は大人0人の予約です(席数超過を判定できません)。';
    $('flHint').textContent = hint;
  }

  // ---------- 入場済の予約の卓を変えるときの確認 ----------
  const tblName = id => (currentTables().find(t => t.id === id) || {}).name ?? id;
  const tblChip = id => `<span class="ceTbl">卓${esc(tblName(id))}</span>`;
  const whoLine = r => `<span class="ceWho">${esc(roomText(r.room))} ${esc(r.guest_name)}${r.guest_name ? ' 様' : ''} <span class="rcEntered">入場済</span></span>`;
  // rs: 入場済の予約、flow: 変更の図(卓7 → 卓9 など)、question: 赤字で出す確認の文
  function confirmEntered({ title, rs, flow, question, ok, danger, note }) {
    return new Promise(resolve => {
      let yes = false;
      modal({
        title,
        body: `<div class="ceBox"><div class="ceWhos">${rs.map(whoLine).join('')}</div>
          <div class="ceFlow">${flow}</div>
          <p class="ceWarn">すでに入場済です。${question}</p>
          ${note ? `<p class="muted ceNote">${note}</p>` : ''}</div>`,
        buttons: [{ label: 'キャンセル' }, { label: ok, primary: !danger, danger, onClick: () => { yes = true; } }],
        onClose: () => resolve(yes),
      });
    });
  }
  const entered = rs => rs.filter(r => r && r.entered_at);
  const tableIdsOf = rid => slotAssign().filter(a => a.reservation_id === rid).map(a => a.table_id);

  // ---------- 割り当て ----------
  async function assign(rid, tableId) {
    const r = resById()[rid], mine = tableIdsOf(rid);
    // 入場済ですでに卓に座っている予約を、別の卓にも座らせるとき(最初の卓に置くときは確認しない)
    if (r && r.entered_at && mine.length && !mine.includes(tableId) && !(await confirmEntered({
      title: '入場済の予約に卓を追加', rs: [r], flow: `${mine.map(tblChip).join('')}<span class="ceArrow">＋</span>${tblChip(tableId)}`,
      question: '卓を追加してよろしいですか？', ok: '追加する' }))) return;
    const d = await api('/api/floor/assign', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid } });
    state.selected = d.remaining > 0 ? rid : null;  // 残りがいれば続けて次の卓を選べるように
    await load();
    toast(d.remaining > 0 ? `卓${d.table}に${d.taken}名を割り当てました(残り${d.remaining}名。続けて次の卓を選んでください)`
      : `卓${d.table}に割り当てました`);
  }
  async function move(from, toId) {
    const rs = entered(from.rid != null ? [resById()[from.rid]] : resAt(from.table));
    if (rs.length && !(await confirmEntered({
      title: '入場済の予約の移動', rs, flow: `${tblChip(from.table)}<span class="ceArrow">→</span>${tblChip(toId)}`,
      question: '移動してよろしいですか？', ok: '移動する' }))) {
      state.moveFrom = null;
      return render();
    }
    await api('/api/floor/move', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: from.table, reservation_id: from.rid ?? null, to_table_id: toId } });
    state.moveFrom = null;
    await load();
  }
  async function unassign(tableId, rid) {
    await api('/api/floor/unassign', { method: 'POST', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid ?? null } });
    await load();
  }

  // 「この卓の人数」欄(席数と予約の人数を超えられない)
  function countsBox(tableId, r) {
    const a = slotAssign().find(x => x.table_id === tableId && x.reservation_id === r.id);
    if (!a) return '';
    const c = countsOf(a), s = seatSummary()[r.id];
    const inp = (k, label) => `<label>${label}<input type="number" min="0" max="99" step="1" inputmode="numeric" data-cnt="${k}" value="${c[k]}"></label>`;
    return `<div class="tiCounts" data-rid="${r.id}">
      <div class="tcHead"><b>この卓の人数</b></div>
      <div class="tcInputs">${inp('adults', '大人')}${inp('children', '幼児')}${inp('infants', '席のみ')}
        <button type="button" class="btn" data-ti="counts" data-rid="${r.id}"><i class="ti ti-device-floppy"></i>人数を保存</button></div>
      <p class="tcSum${s.rest ? ' ng' : ''}">予約 ${s.total}名のうち ${s.tables}卓に ${s.seated}名${s.rest ? `(未割り当て ${s.rest}名。右の未アサインから次の卓へ)` : '(全員割り当て済み)'}</p>
    </div>`;
  }

  const resAt = tableId => (tableLoads()[tableId] || { rs: [] }).rs;
  const memoOf = (tableId, rid) => (slotAssign().find(a => a.table_id === tableId && a.reservation_id === rid) || {}).memo || '';

  function onTableClick(tableId) {
    if (state.edit) return toggleEditSel(tableId);
    const rs = resAt(tableId);
    if (state.moveFrom) {
      if (state.moveFrom.table === tableId) { state.moveFrom = null; return renderMap(); }
      return move(state.moveFrom, tableId).catch(() => {});
    }
    // 選んだ予約に残りがいれば、この卓に(同じ予約がすでに座っていても)空席の分だけ追加で座らせる
    if (state.selected && (!rs.some(r => r.id === state.selected) || seatSummary()[state.selected]?.rest)) {
      return assign(state.selected, tableId).catch(() => {});
    }
    if (!rs.length) return toast('先に右の一覧から予約を選んでください');
    showTable(tableId);
  }

  // 卓の画面(人数・卓メモ)。keep: 開き直すときに残す、保存していない卓メモの入力 {予約ID: 文字}
  function showTable(tableId, keep = {}) {
    const rs = resAt(tableId);
    if (!rs.length) return;
    const t = currentTables().find(x => x.id === tableId);
    const o = tableLoads()[tableId];
    const m = modal({
      title: `卓 ${t.name}(${t.seats}名)`,
      wide: true,
      noFocus: true,
      body: `<div class="tblInfo">
        ${people(o) > t.seats ? `<p class="overTxt"><i class="ti ti-alert-triangle"></i>人数(${people(o)}名)が席数(${t.seats}名)を超えています</p>` : ''}
        ${rs.map(r => `<div class="tiRow">
          <div class="tiHead">
            <div class="tiWho"><b>${esc(roomText(r.room))}</b>${grpTag(r)}${stayTag(r)}<span>${esc(r.guest_name)}${r.guest_name ? ' 様' : ''}</span>
              ${r.entered_at ? '<span class="rcEntered">入場済</span>' : ''}</div>
            <div class="tiBtns">
              <button type="button" class="btn" data-ti="move" data-rid="${r.id}"><i class="ti ti-arrows-move"></i>別の卓へ移動</button>
              ${seatSummary()[r.id]?.rest ? `<button type="button" class="btn" data-ti="add" data-rid="${r.id}"><i class="ti ti-plus"></i>卓を追加</button>`
                : `<button type="button" class="btn" disabled title="${r.adults ? '全員が卓に座っています。別の卓にも分けるときは、先に「この卓の人数」を減らしてください' : '人数が未入力の予約は1つの卓にしか置けません'}"><i class="ti ti-plus"></i>卓を追加</button>`}
              <button type="button" class="btn danger" data-ti="remove" data-rid="${r.id}"><i class="ti ti-x"></i>外す</button>
            </div>
          </div>
          <div class="tiFacts"><span>大人${r.adults}・幼児${r.children}・席のみ${r.infants}</span><span>卓: ${tablesOfRes(r.id).map(esc).join('・')}</span></div>
          ${r.allergy ? `<p class="allergy"><i class="ti ti-alert-triangle"></i>${esc(r.allergy)}</p>` : ''}
          ${r.note ? `<p class="tiNote">備考: ${esc(r.note)}</p>` : ''}
          ${countsBox(tableId, r)}
          <div class="tiMemo">
            <label for="memo${r.id}">卓メモ<small>このページでのみ表示されます</small></label>
            <textarea id="memo${r.id}" data-memo="${r.id}" maxlength="500" rows="2" placeholder="例: 窓側希望、記念日のケーキ">${esc(memoOf(tableId, r.id))}</textarea>
            <div class="tiMemoFoot"><button type="button" class="btn" data-ti="memo" data-rid="${r.id}"><i class="ti ti-device-floppy"></i>メモを保存</button></div>
          </div></div>`).join('')}</div>`,
      buttons: [{ label: '閉じる' }].concat(rs.length > 1
        ? [{ label: 'この卓の全員を移動', primary: true, onClick: () => { state.moveFrom = { table: tableId }; state.selected = null; render(); } }] : []),
    });
    // 保存していない卓メモの入力(開き直しても消さない。保存済みの内容とは区別したまま入れ直す)
    Object.entries(keep).forEach(([rid, v]) => { const el = m.querySelector(`[data-memo="${rid}"]`); if (el) el.value = v; });
    const unsavedMemos = () => Object.fromEntries([...m.querySelectorAll('[data-memo]')]
      .filter(x => x.value !== x.defaultValue).map(x => [+x.dataset.memo, x.value]));
    async function saveCounts(rid) {
      const box = m.querySelector(`.tiCounts[data-rid="${rid}"]`);
      const counts = {};
      for (const k of COUNT_KEYS) {
        const v = box.querySelector(`[data-cnt="${k}"]`).value.trim(), n = Number(v);
        if (v === '' || !Number.isInteger(n) || n < 0 || n > 99) return toast('人数は0〜99の整数で入力してください', true);
        counts[k] = n;
      }
      const r = resById()[rid], old = countsOf(slotAssign().find(a => a.table_id === tableId && a.reservation_id === rid) || {});
      const cText = c => `大人${c.adults}・幼児${c.children}・席のみ${c.infants}`;
      if (r && r.entered_at && COUNT_KEYS.some(k => counts[k] !== old[k]) && !(await confirmEntered({
        title: '入場済の予約の人数変更', rs: [r],
        flow: `${tblChip(tableId)}<span class="ceCounts">${cText(old)}</span><span class="ceArrow">→</span><span class="ceCounts">${cText(counts)}</span>`,
        question: '人数を変更してよろしいですか？', ok: '変更する' }))) return;
      await api('/api/floor/counts', { method: 'PUT', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid, counts } });
      const keep = unsavedMemos();
      state.selected = null;  // 選んだままだと、開き直したときに減らした人数がこの卓へ自動で戻ってしまう
      await load();
      m.close();
      const s = seatSummary()[rid];
      toast(s && s.rest ? `保存しました(未割り当て ${s.rest}名は未アサインに残ります)` : '保存しました');
      showTable(tableId, keep);  // 新しい人数で開き直す(他の端末で外されていたら開かない)
    }
    async function saveMemo(rid) {
      const el = m.querySelector(`[data-memo="${rid}"]`), memo = el.value;
      await api('/api/floor/memo', { method: 'PUT', body: { date: state.date, time_slot: state.slot, table_id: tableId, reservation_id: rid, memo } });
      el.defaultValue = memo;
      toast(memo.trim() ? 'メモを保存しました' : 'メモを消しました');
      await load();
    }
    m.querySelector('.tblInfo').addEventListener('click', async e => {
      const b = e.target.closest('[data-ti]');
      if (!b) return;
      const rid = +b.dataset.rid;
      if (b.dataset.ti === 'counts' || b.dataset.ti === 'memo') {
        if (b.disabled) return;
        b.disabled = true;  // 二度押しで二重に送ったり、画面が2枚開いたりしないように
        try { await (b.dataset.ti === 'counts' ? saveCounts(rid) : saveMemo(rid)); } catch (err) { /* toast 済み */ }
        b.disabled = false;
        return;
      }
      const r = resById()[rid];
      if (b.dataset.ti === 'remove' && r?.entered_at) {  // 入場済なら卓メモの確認もまとめてこの画面で
        if (!(await confirmEntered({
          title: '入場済の予約を外す', rs: [r], flow: `${tblChip(tableId)}<span class="ceArrow">→</span><span class="ceOut">未アサイン</span>`,
          question: '卓から外してよろしいですか？', ok: memoOf(tableId, rid) ? '外す(メモも削除)' : '外す', danger: true,
          note: memoOf(tableId, rid) ? 'この卓の卓メモも削除されます。' : '' }))) return;
      } else if (b.dataset.ti === 'remove' && memoOf(tableId, rid) && !(await confirmDialog({
        title: '卓メモの削除', message: 'この卓から外すと、入力されている卓メモも削除されます。外しますか？', ok: '外す(メモも削除)', danger: true }))) return;
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
    if (drag) cancelDrag();
    drag = { kind, id, sx: e.clientX, sy: e.clientY, moved: false };
    if (kind === 'layout') {
      const t = state.edit.tables.find(x => x.id === id);
      const p = toCanvas(e.clientX, e.clientY);
      drag.ox = p.x - t.x; drag.oy = p.y - t.y;
      // 選択中の卓をドラッグしたときは、選択中の卓をまとめて動かす
      const ids = state.edit.sel.has(id) ? state.edit.sel : new Set([id]);
      drag.group = state.edit.tables.filter(x => ids.has(x.id)).map(x => ({ t: x, dx: x.x - t.x, dy: x.y - t.y }));
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
      const pos = alignPosition(t, p.x - drag.ox, p.y - drag.oy, !e.altKey);
      // まとめて動かすときは、全体がキャンバスからはみ出さないように動かす量を抑える
      const { w: CW, h: CH } = state.data.canvas;
      let dx = pos.x - t.x, dy = pos.y - t.y;
      drag.group.forEach(({ t: g }) => {
        dx = Math.max(dx, -g.x); dx = Math.min(dx, CW - g.w - g.x);
        dy = Math.max(dy, -g.y); dy = Math.min(dy, CH - g.h - g.y);
      });
      drag.group.forEach(({ t: g }) => { g.x += dx; g.y += dy; });
      state.edit.guides = pos.guides;
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
  // ドラッグ中の卓を、他の卓の左端・中心・右端(横)、上端・中心・下端(高さ)に吸着させる
  function alignPosition(t, x, y, snap) {
    const others = state.edit.tables.filter(o => o !== t && !(drag.group || []).some(g => g.t === o));
    const guides = [];
    const best = (pos, size, key) => {
      let hit = null;
      for (const o of others) {
        const os = key === 'x' ? o.x : o.y, ol = key === 'x' ? o.w : o.h;
        for (const [a, oa] of [[0, 0], [size / 2, ol / 2], [size, ol], [0, ol], [size, 0]]) {
          const d = os + oa - (pos + a);
          if (Math.abs(d) <= ALIGN_TH && (!hit || Math.abs(d) < Math.abs(hit.d))) hit = { d, line: os + oa, o };
        }
      }
      return hit;
    };
    if (!snap) return { x: Math.round(x), y: Math.round(y), guides };
    const hx = best(x, t.w, 'x'), hy = best(y, t.h, 'y');
    const nx = hx ? x + hx.d : Math.round(x / SNAP) * SNAP;
    const ny = hy ? y + hy.d : Math.round(y / SNAP) * SNAP;
    // 揃った線をすべて表示(同じ線に並ぶ卓をまたいで引く)
    const lines = (key, line) => {
      const on = others.filter(o => key === 'x'
        ? [o.x, o.x + o.w / 2, o.x + o.w].some(v => Math.abs(v - line) < 0.5)
        : [o.y, o.y + o.h / 2, o.y + o.h].some(v => Math.abs(v - line) < 0.5));
      const span = on.concat({ x: nx, y: ny, w: t.w, h: t.h });
      if (key === 'x') guides.push({ x1: line, x2: line, y1: Math.min(...span.map(o => o.y)) - 8, y2: Math.max(...span.map(o => o.y + o.h)) + 8 });
      else guides.push({ y1: line, y2: line, x1: Math.min(...span.map(o => o.x)) - 8, x2: Math.max(...span.map(o => o.x + o.w)) + 8 });
    };
    if (hx) lines('x', hx.line);
    if (hy) lines('y', hy.line);
    return { x: Math.round(nx), y: Math.round(ny), guides };
  }

  function cancelDrag() {
    window.removeEventListener('pointermove', onDragMove);
    if (state.edit && state.edit.guides) { state.edit.guides = null; renderMap(); }
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
    if (dg.kind === 'layout') { renderMap(); return renderList(); }
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
    if (target === 'day') await load();
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
      <label class="ebAdd">卓を追加<select id="ebSeats">${STD_SEATS.map(n => `<option value="${n}"${n === 4 ? ' selected' : ''}>${n}名</option>`).join('')}</select></label>
      <button class="btn" data-eb="add"><i class="ti ti-plus"></i>追加</button>
      <button class="btn" data-eb="merge" ${sel.length >= 2 ? '' : 'disabled'}><i class="ti ti-link"></i>連結</button>
      <button class="btn" data-eb="split" ${one && one.parts ? '' : 'disabled'}><i class="ti ti-unlink"></i>連結を解除</button>
      <button class="btn" data-eb="delete" ${sel.length ? '' : 'disabled'}><i class="ti ti-trash"></i>削除</button>
      <span class="ebSep"></span>
      <button class="btn" data-eb="alignRow" ${sel.length >= 2 ? '' : 'disabled'} title="選んだ卓の高さ(中心)を揃える"><i class="ti ti-layout-align-middle"></i>高さを揃える</button>
      <button class="btn" data-eb="alignCol" ${sel.length >= 2 ? '' : 'disabled'} title="選んだ卓の横位置(中心)を揃える"><i class="ti ti-layout-align-center"></i>横位置を揃える</button>
      <button class="btn" data-eb="spaceH" ${sel.length >= 3 ? '' : 'disabled'} title="選んだ卓を左右の卓の間で等間隔に並べる"><i class="ti ti-layout-distribute-vertical"></i>横に等間隔</button>
      <button class="btn" data-eb="spaceV" ${sel.length >= 3 ? '' : 'disabled'} title="選んだ卓を上下の卓の間で等間隔に並べる"><i class="ti ti-layout-distribute-horizontal"></i>縦に等間隔</button>
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
    const std = STD_SEATS.includes(t.seats) && !t.parts;
    return `<h3>卓の設定</h3>
      <form class="form" id="ebForm">
        <label>卓番号<input type="text" name="name" value="${esc(t.name)}" maxlength="16" required></label>
        <label>席数${std
          ? `<select name="seats">${STD_SEATS.map(n => `<option value="${n}"${n === t.seats ? ' selected' : ''}>${n}名</option>`).join('')}</select>`
          : `<input type="number" name="seats" value="${t.seats}" min="1" max="60" required>`}</label>
        ${t.parts ? `<p class="muted small">連結: ${t.parts.map(p => esc(p.name)).join('＋')}</p>` : ''}
      </form>`;
  }

  $('flList').addEventListener('submit', e => e.preventDefault());
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
        t.x = Math.max(0, Math.min(state.data.canvas.w - w, t.x));
        t.y = Math.max(0, Math.min(state.data.canvas.h - h, t.y));
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
      const seats = sel.reduce((n, t) => n + t.seats, 0);
      if (seats > 60) return toast('連結した卓の席数は60名までです', true);
      let name = sel.map(t => t.name).join('+');
      if (name.length > 16) name = `${sel[0].name}ほか${sel.length - 1}卓`.slice(0, 16);
      const others = new Set(e.tables.filter(t => !e.sel.has(t.id)).map(t => t.name));
      for (let i = 2; others.has(name); i++) name = `${name.slice(0, 13)}(${i})`;
      const m = { id: newId(), name, seats, x, y, w: x2 - x, h: y2 - y, parts };
      e.tables = e.tables.filter(t => !e.sel.has(t.id)).concat(m);
      e.sel = new Set([m.id]);
      e.dirty = true;
    } else if (act === 'split') {
      const m = sel[0];
      if (dayAssigned([m.id]).length) return toast('割り当てのある卓は解除できません。先に割り当てを外してください', true);
      const taken = new Set(e.tables.filter(t => t !== m).map(t => t.name));
      const dx = m.x - Math.min(...m.parts.map(p => p.x)), dy = m.y - Math.min(...m.parts.map(p => p.y));
      const { w: CW, h: CH } = state.data.canvas;
      const parts = m.parts.map(p => ({ ...clone(p), id: e.tables.some(t => t.id === p.id) ? newId() : p.id,
        x: Math.max(0, Math.min(CW - p.w, p.x + dx)), y: Math.max(0, Math.min(CH - p.h, p.y + dy)) }));
      parts.forEach(p => {
        if (taken.has(p.name)) { let n = parseInt(nextName(), 10); while (taken.has(String(n))) n++; p.name = String(n); }
        taken.add(p.name);
      });
      e.tables = e.tables.filter(t => t !== m).concat(parts);
      e.sel = new Set(parts.map(p => p.id));
      e.dirty = true;
    } else if (act === 'delete') {
      const gone = dayAssigned(sel.map(t => t.id)), n = gone.length, memos = gone.filter(a => a.memo).length;
      if (n && !(await confirmDialog({ title: '卓の削除', message: `割り当て済みの予約が${n}件あります${memos ? `(うち卓メモあり${memos}件)` : ''}。保存すると割り当て${memos ? 'と卓メモ' : ''}が外れます。削除しますか？`, ok: '削除する', danger: true }))) return;
      e.tables = e.tables.filter(t => !e.sel.has(t.id));
      e.sel = new Set();
      e.dirty = true;
    } else if (act === 'copyPrev') {
      const prev = await api(`/api/floor?d=${addDays(state.date, -1)}`);
      const lost = state.data.assignments.filter(a => !prev.tables.some(t => t.id === a.table_id));
      const gone = lost.length, memos = lost.filter(a => a.memo).length;
      if (gone && !(await confirmDialog({ title: '前日の配置をコピー', message: `前日にない卓の割り当て${gone}件${memos ? `(うち卓メモあり${memos}件)` : ''}は、保存すると外れます${memos ? '(卓メモも削除)' : ''}。コピーしますか？`, ok: 'コピーする' }))) return;
      e.tables = clone(prev.tables);
      e.sel = new Set();
      e.dirty = true;
      toast('前日の配置をコピーしました。保存すると反映されます');
    } else if (act === 'reset') {
      if (!(await confirmDialog({ title: '基本に戻す', message: 'この日の配置を基本レイアウトに戻します。基本にない卓の割り当ては外れ、その卓メモも削除されます。よろしいですか？', ok: '基本に戻す', danger: true }))) return;
      const r = await api(`/api/floor/layout?d=${state.date}`, { method: 'DELETE' });
      toast(r.released ? `基本に戻しました(割り当て${r.released}件を外しました)` : '基本に戻しました');
      state.edit = null;
      return load();
    } else if (['alignRow', 'alignCol', 'spaceH', 'spaceV'].includes(act)) {
      // 揃える: 最初に選んだ卓(選択順の先頭)に合わせる。等間隔: 両端の卓は動かさず間を均等に
      const first = e.tables.find(t => t.id === [...e.sel][0]);
      if (act === 'alignRow') sel.forEach(t => { t.y = Math.round(first.y + first.h / 2 - t.h / 2); });
      else if (act === 'alignCol') sel.forEach(t => { t.x = Math.round(first.x + first.w / 2 - t.w / 2); });
      else {
        const k = act === 'spaceH' ? 'x' : 'y', sz = act === 'spaceH' ? 'w' : 'h';
        const list = [...sel].sort((a, b) => a[k] - b[k]);
        const start = list[0][k], end = list[list.length - 1][k] + list[list.length - 1][sz];
        const gap = (end - start - list.reduce((n, t) => n + t[sz], 0)) / (list.length - 1);
        let pos = start;
        list.forEach(t => { t[k] = Math.round(pos); pos += t[sz] + gap; });
      }
      e.dirty = true;
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
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (state.edit && state.edit.sel.size && arrows[e.key] && !AMT.isModalOpen() && !e.target.closest?.('input,select,textarea')) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;  // Shift で10ずつ
      const [ax, ay] = arrows[e.key];
      const { w: CW, h: CH } = state.data.canvas;
      state.edit.tables.filter(t => state.edit.sel.has(t.id)).forEach(t => {
        t.x = Math.max(0, Math.min(CW - t.w, t.x + ax * step));
        t.y = Math.max(0, Math.min(CH - t.h, t.y + ay * step));
      });
      state.edit.dirty = true;
      return renderMap();
    }
    if (e.key === 'Escape' && !AMT.isModalOpen() && (state.selected || state.moveFrom)) {
      state.selected = state.moveFrom = null;
      render();
    }
  });

  // 30秒ごとに更新(編集中・操作中・モーダル表示中・タブ非表示のときは止める)
  const idle = () => !state.edit && !drag && !AMT.isModalOpen() && !document.hidden;
  setInterval(() => { if (idle()) load(true).catch(() => {}); }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (idle()) load(true).catch(() => {}); });

  setDate(state.date);
})();
