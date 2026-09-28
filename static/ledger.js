/* ledger.js — 喫食時間管理表(夕食・朝食共通)。#ledger[data-meal] に描画する */
(function () {
  const root = document.getElementById('ledger');
  const MEAL = root.dataset.meal;
  const { esc, api, toast, modal, normSearch } = AMT;
  const REFRESH_MS = 30000;
  const UNSET = '';  // 時間未定
  const MAX_COUNT = 99;  // 人数の上限(サーバー側と同じ)
  const ENTRY_ROLES = ['restaurant', 'developer'];  // 入場済を操作できるロール(サーバー側と同じ)

  const pad = n => String(n).padStart(2, '0');
  const fmtDate = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const addDays = (s, n) => { const d = new Date(s + 'T00:00:00'); d.setDate(d.getDate() + n); return fmtDate(d); };
  const WEEK = '日月火水木金土';
  const dow = s => WEEK[new Date(s + 'T00:00:00').getDay()];

  // 一覧の列。見出しクリックで並び替え(もう一度押すと逆順)
  const byText = f => r => r[f] || '';
  const COLUMNS = [
    { key: 'time', label: '時間', val: r => r.time_slot || '' },
    { key: 'status', label: 'ステータス', val: r => (r.entered_at ? 1 : 0) },
    { key: 'resv_no', label: '予約番号', val: byText('resv_no') },
    { key: 'room', label: '部屋', val: byText('room') },
    ...(MEAL === 'dinner' ? [{ key: 'tables', label: 'テーブル', val: r => (r.tables || []).join('・') }] : []),
    { key: 'guest_name', label: '代表者名', val: byText('guest_name') },
    { key: 'nights', label: '泊数', val: r => r.nights * 100 + r.night_no },
    { key: 'adults', label: '大人', num: true, val: r => r.adults },
    { key: 'children', label: '幼児', num: true, val: r => r.children },
    { key: 'infants', label: '席のみ', num: true, val: r => r.infants },
    { key: 'total', label: '計', num: true, val: r => total(r) },
    { key: 'allergy', label: 'アレルギー', val: byText('allergy') },
    { key: 'note', label: '備考', val: byText('note') },
    { key: 'updated', label: '更新', cls: 'noPrint', firstDir: -1, val: r => (r.deleted ? r.deleted_at : r.updated_at) || '' },
  ];

  const params = new URLSearchParams(location.search);
  const state = {
    date: /^\d{4}-\d{2}-\d{2}$/.test(params.get('d') || '') ? params.get('d') : fmtDate(new Date()),
    slots: [],
    rows: [],
    q: '',
    sort: { key: 'time', dir: 1 },  // dir: 1=昇順 -1=降順
    showDeleted: false,
    role: null,  // ログイン中のロール(入場済の操作はレストランのみ)
    slotFilter: params.has('t') ? params.get('t') : null,  // 時間枠カードで絞り込み中の時間('' は未定、null は絞り込みなし)
  };

  root.innerHTML = `
    <div class="ledgerBar noPrint">
      <div class="dateNav">
        <button class="iconBtn" data-act="prev" aria-label="前日"><i class="ti ti-chevron-left"></i></button>
        <input type="date" id="ldDate" aria-label="日付">
        <span class="dow" id="ldDow"></span>
        <button class="iconBtn" data-act="next" aria-label="翌日"><i class="ti ti-chevron-right"></i></button>
        <button class="btn" data-act="today">今日</button>
      </div>
      <input type="search" id="ldSearch" placeholder="予約番号・部屋・名前・備考で検索" aria-label="検索">
      <label class="delToggle"><input type="checkbox" id="ldShowDeleted">削除済みも表示</label>
      <div class="barRight">
        <button class="btn" data-act="slots" title="時間枠の追加・削除"><i class="ti ti-clock-edit"></i>時間枠</button>
        <button class="btn" data-act="print"><i class="ti ti-printer"></i>印刷</button>
        <button class="btn primary" data-act="add"><i class="ti ti-plus"></i>追加</button>
      </div>
    </div>
    <h2 class="printTitle" id="ldPrintTitle"></h2>
    <div class="summary" id="ldSummary"></div>
    <div class="filterNote noPrint" id="ldFilterNote" hidden></div>
    <div class="tableWrap"><table class="grid ledgerTable">
      <thead><tr>${COLUMNS.map(c => `<th class="sortable${c.num ? ' num' : ''}${c.cls ? ' ' + c.cls : ''}" data-sort="${c.key}">
        <button type="button">${c.label}<i class="ti"></i></button></th>`).join('')}</tr></thead>
      <tbody id="ldBody"></tbody>
    </table></div>`;

  const $ = id => document.getElementById(id);
  const dateInput = $('ldDate');

  // ---------- データ ----------
  async function loadSlots() {
    state.slots = await api(`/api/slots/${MEAL}`);
  }

  // 日付を素早く切り替えたとき、後から返ってきた古い日付の結果で上書きしないよう最新の要求だけ反映する
  let loadSeq = 0;
  async function loadRows() {
    const seq = ++loadSeq;
    const rows = await api(`/api/${MEAL}/reservations?d=${state.date}${state.showDeleted ? '&include_deleted=true' : ''}`);
    if (seq !== loadSeq) return;
    state.rows = rows;
    render();
  }

  // 背景色: 表示中の日付が今日(0:00区切り)より前=グレー、後=ブルー、今日=白
  function applyDayTone() {
    const today = fmtDate(new Date());
    document.body.classList.toggle('dayPast', state.date < today);
    document.body.classList.toggle('dayFuture', state.date > today);
  }

  function setDate(d) {
    state.date = d;
    applyDayTone();
    const u = new URL(location.href);
    u.searchParams.set('d', d);
    history.replaceState(null, '', u);
    loadRows().catch(() => {});
  }

  // ---------- 描画 ----------
  const total = r => r.adults + r.children;  // 席のみは計に含めない
  const COUNT_KEYS = ['adults', 'children', 'infants'];  // 一覧から直接入力できる人数(大人・幼児・席のみ)
  const active = () => state.rows.filter(r => !r.deleted);
  // "2026-09-24T18:05:12" → "9/24 18:05"(今年以外は年も表示)
  const fmtTs = ts => {
    if (!ts) return '';
    const [d, t] = ts.split('T');
    const [y, mo, da] = d.split('-');
    return `${y === String(new Date().getFullYear()) ? '' : y + '/'}${+mo}/${+da} ${t.slice(0, 5)}`;
  };
  const FIELD_LABELS = { date: '日付', time_slot: '時間', room: '部屋', guest_name: '代表者名', adults: '大人',
    children: '幼児', infants: '席のみ', tables: 'テーブル', nights: '泊数', night_no: '何泊目', group_id: 'グループ', entered_at: 'ステータス', allergy: 'アレルギー', note: '備考' };
  const nightsLabel = r => `${r.night_no}泊/${r.nights}泊`;
  const ACTION_LABELS = { create: '登録', update: '変更', delete: '削除', restore: '復元', import: 'CSV取込', import_update: 'CSV取込(更新)', table_memo: '卓メモを変更', table_counts: '卓の人数を変更' };
  // 複数部屋(「, 」区切り)は「115 他14室」と表示し、ホバーで全室
  const splitRooms = room => room.split(/\s*,\s*/).filter(Boolean);
  const roomText = room => { const rs = splitRooms(room); return rs.length > 1 ? `${rs[0]} 他${rs.length - 1}室` : room; };
  const roomLabel = room => {
    const rooms = splitRooms(room);
    return rooms.length > 1
      ? `<span class="multiRoom" title="${esc(rooms.join(', '))}">${esc(rooms[0])} <small>他${rooms.length - 1}室</small></span>`
      : esc(room);
  };
  // テーブル列: 2卓までは全部、3卓以上は「1 他9卓」(部屋の列と同じ形)。ホバーで全卓
  const TABLES_SHOWN = 2;
  const tableLabel = r => {
    const ts = r.tables || [];
    if (!ts.length) return '';
    const text = ts.length > TABLES_SHOWN ? `${esc(ts[0])} <small>他${ts.length - 1}卓</small>` : esc(ts.join('・'));
    return `<span title="テーブル: ${esc(ts.join('・'))}">${text}</span>`;
  };
  const fmtVal = (f, v) => f === 'time_slot' ? (v || '未定')
    : f === 'group_id' ? (v ? 'あり' : 'なし')
    : f === 'entered_at' ? (v ? `入場済(${fmtTs(v)})` : '空白')
    : Array.isArray(v) ? (v.length ? v.join('・') : 'なし')
    : (v === '' || v === null ? '(空欄)' : String(v));

  // グループ: この日の有効な予約のグループ(単体を含む)に G1, G2… を振る(時間→部屋順)
  function groupInfo() {
    const members = {};
    active().filter(r => r.group_id).forEach(r => (members[r.group_id] = members[r.group_id] || []).push(r));
    const order = r => (r.time_slot || '99:99') + '|' + r.room.padStart(8, '0');
    const groups = Object.entries(members)
      .map(([id, ms]) => [id, ms.sort((a, b) => order(a).localeCompare(order(b)))])
      .sort(([, a], [, b]) => order(a[0]).localeCompare(order(b[0])));
    return Object.fromEntries(groups.map(([id, ms], i) => [id, { no: i + 1, members: ms }]));
  }
  const GROUP_COLORS = 10;  // グループ色の数(ledger.css の .grpTag.g0〜g9)。超えると同じ色を繰り返す
  const groupTag = (g, extra = '') => g
    ? `<span class="grpTag g${(g.no - 1) % GROUP_COLORS}" title="グループ: ${esc(g.members.map(m => roomText(m.room)).join('・'))}">G${g.no}</span>${extra}`
    : '';

  function visibleRows() {
    const q = normSearch(state.q);
    let rows = state.rows;
    if (state.slotFilter !== null) rows = rows.filter(r => (r.time_slot || UNSET) === state.slotFilter);
    if (q) rows = rows.filter(r => [r.resv_no, r.room, r.guest_name, r.allergy, r.note].some(v => normSearch(v).includes(q)));
    const col = COLUMNS.find(c => c.key === state.sort.key);
    const { dir } = state.sort;
    const cmp = (x, y) => typeof x === 'number' ? x - y : x.localeCompare(y, 'ja', { numeric: true });
    const byRoom = (a, b) => cmp(a.room, b.room);
    return [...rows].sort((a, b) => {
      const x = col.val(a), y = col.val(b);
      // 空欄(時間未定など)は並び順に関わらず末尾
      if ((x === '') !== (y === '')) return x === '' ? 1 : -1;
      return cmp(x, y) * dir || (col.key === 'room' ? 0 : byRoom(a, b));
    });
  }

  function renderSortHeads() {
    root.querySelectorAll('th[data-sort]').forEach(th => {
      const on = th.dataset.sort === state.sort.key;
      th.classList.toggle('sorted', on);
      th.setAttribute('aria-sort', on ? (state.sort.dir > 0 ? 'ascending' : 'descending') : 'none');
      th.querySelector('i').className = 'ti ' + (on ? (state.sort.dir > 0 ? 'ti-arrow-up' : 'ti-arrow-down') : 'ti-arrows-sort');
    });
  }

  // 登録済みの時刻が枠設定に無い場合も選択肢に残す
  function slotOptions(current) {
    const list = [...state.slots];
    if (current && !list.includes(current)) list.push(current);
    list.sort();
    return `<option value="${UNSET}">未定</option>` +
      list.map(s => `<option value="${s}"${s === current ? ' selected' : ''}>${s}</option>`).join('');
  }

  function renderSummary() {
    const agg = {};
    const add = (k, r) => {
      const a = agg[k] || (agg[k] = { n: 0, adults: 0, children: 0, infants: 0, entered: 0 });
      a.n++; a.adults += r.adults; a.children += r.children; a.infants += r.infants;
      if (r.entered_at) a.entered++;
    };
    active().forEach(r => { add(r.time_slot || UNSET, r); add('*', r); });
    const keys = [...new Set([...state.slots, ...Object.keys(agg).filter(k => k !== '*' && k !== UNSET)])].sort();
    if (agg[UNSET]) keys.push(UNSET);
    const card = (label, a, cls = '', slot = '*') => {
      a = a || { n: 0, adults: 0, children: 0, infants: 0, entered: 0 };
      const t = total(a);
      const pct = a.n ? Math.round(a.entered / a.n * 100) : 0;
      const allIn = a.n > 0 && a.entered === a.n;  // 入場済みが100%
      const on = slot === '*' ? state.slotFilter === null : state.slotFilter === slot;
      const tip = slot === '*' ? 'クリックで全部の時間を表示' : `クリックで ${label} の予約だけを表示`;
      return `<div class="sumCard ${cls}${a.n ? '' : ' zero'}${allIn ? ' allIn' : ''}${on && state.slotFilter !== null ? ' on' : ''}" data-slot="${esc(slot)}" role="button" tabindex="0" title="${tip}" aria-pressed="${on}">
        <div class="sumLabel">${esc(label)}${allIn ? '<span class="allInMark"> ✓全員入場</span>' : ''}</div>
        <div class="sumMain"><b>${t}</b>名 <span>${a.n}組</span></div>
        <div class="sumSub">大${a.adults} 幼${a.children} 席${a.infants}</div>
        <div class="entBar" role="progressbar" aria-label="入場" aria-valuemin="0" aria-valuemax="${a.n}" aria-valuenow="${a.entered}"><i style="width:${pct}%"></i></div>
        <div class="entTxt">入場 ${a.entered}/${a.n}組</div></div>`;
    };
    $('ldSummary').innerHTML =
      keys.map(k => card(k || '未定', agg[k], k ? '' : 'unset', k)).join('') + card('合計', agg['*'], 'total');
    const note = $('ldFilterNote');
    note.hidden = state.slotFilter === null;
    note.innerHTML = state.slotFilter === null ? '' : `<i class="ti ti-filter"></i><b>${esc(state.slotFilter || '未定')}</b> の予約だけを表示中(印刷もこの表示になります)
      <button type="button" class="btn" data-slot="*"><i class="ti ti-x"></i>絞り込みを解除</button>`;
  }

  function render() {
    const ed = [...document.querySelectorAll('#ldBody .cntInput')].find(i => !i.dataset.closing);
    const keep = ed && { id: +ed.closest('tr').dataset.id, key: ed.closest('td').dataset.cnt, value: ed.value };
    if (ed) ed.dataset.closing = '1';  // 消える入力欄の blur で保存しない
    renderNow();
    if (keep) {
      const td = $('ldBody').querySelector(`tr[data-id="${keep.id}"] td.cnt[data-cnt="${keep.key}"]`);
      if (td) editCount(td, keep.value);
    }
  }

  function renderNow() {
    applyDayTone();
    dateInput.value = state.date;
    $('ldDow').textContent = `(${dow(state.date)})`;
    $('ldDow').className = 'dow' + ({ 日: ' sun', 土: ' sat' }[dow(state.date)] || '');
    $('ldPrintTitle').textContent = `${MEAL === 'dinner' ? '夕食' : '朝食'}時間管理表　${state.date.replace(/-/g, '/')}(${dow(state.date)})`
      + (state.slotFilter === null ? '' : `　${state.slotFilter || '時間未定'}のみ`);
    document.body.classList.toggle('slotFiltered', state.slotFilter !== null);
    renderSummary();
    renderSortHeads();

    const rows = visibleRows();
    const tbody = $('ldBody');
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="${COLUMNS.length}" class="empty">${state.rows.length ? '該当する予約はありません' : 'この日の予約はまだありません。「追加」から登録してください。'}</td></tr>`;
      return;
    }
    let prevSlot = null;
    const groups = groupInfo();
    tbody.innerHTML = rows.map(r => {
      const brk = state.sort.key === 'time' && prevSlot !== null && prevSlot !== (r.time_slot || UNSET);
      prevSlot = r.time_slot || UNSET;
      const cls = [brk && 'slotBreak', !r.time_slot && !r.deleted && 'noSlot', r.deleted && 'deleted', !r.deleted && !r.adults && 'noAdult'].filter(Boolean).join(' ');
      return `<tr data-id="${r.id}" class="${cls}">
        <td>${r.deleted
          ? `<span class="delBadge">削除済</span> ${r.time_slot || '未定'}`
          : `<select class="slotSel" aria-label="時間">${slotOptions(r.time_slot)}</select>
          <span class="printOnly">${r.time_slot || '未定'}</span>`}</td>
        <td class="status">${statusCell(r)}</td>
        <td class="resvNo">${esc(r.resv_no || '')}</td>
        <td class="room">${roomLabel(r.room)}${groupTag(groups[r.group_id])}</td>
        ${MEAL === 'dinner' ? `<td class="tblNo">${tableLabel(r)}</td>` : ''}
        <td class="guest">${esc(r.guest_name)}</td>
        <td class="nights">${r.night_no >= 2 ? `<span class="stayBadge" title="連泊の${r.night_no}泊目">${nightsLabel(r)}</span>` : nightsLabel(r)}</td>
        ${COUNT_KEYS.map(k => r.deleted ? `<td class="num">${r[k]}</td>`
          : `<td class="num cnt" data-cnt="${k}" title="クリックして人数を入力">${r[k]}</td>`).join('')}
        <td class="num"><b>${total(r)}</b></td>
        <td class="allergyCell">${r.allergy ? `<span class="allergy"><i class="ti ti-alert-triangle"></i>${esc(r.allergy)}</span>` : ''}</td>
        <td class="note">${esc(r.note)}</td>
        <td class="noPrint upd">${r.deleted
          ? `削除 ${fmtTs(r.deleted_at)}<br>${esc(r.deleted_by)}`
          : `${fmtTs(r.updated_at)}<br>${esc(r.updated_by)}`}</td>
      </tr>`;
    }).join('');
  }

  // ステータス: レストランは(削除済み以外)チェックボックス、他ロールは表示のみ
  function statusCell(r) {
    const title = r.entered_at ? ` title="${fmtTs(r.entered_at)} ${esc(r.entered_by)}"` : '';
    if (ENTRY_ROLES.includes(state.role) && !r.deleted) {
      return `<label class="entChk"${title}><input type="checkbox" class="entSel" ${r.entered_at ? 'checked' : ''}>入場済</label>`;
    }
    return r.entered_at ? `<span class="entBadge"${title}><i class="ti ti-check"></i>入場済</span>` : '';
  }

  // ---------- 編集 ----------
  function openForm(r) {
    const isNew = !r;
    if (r && r.deleted) return openDeleted(r);
    r = r || { date: state.date, nights: 1, room: '', guest_name: '', adults: 2, children: 0, infants: 0, time_slot: null, allergy: '', note: '' };
    const dateLabel = d => `${d.replace(/-/g, '/')}(${dow(d)})`;
    // 人数は 0〜MAX_COUNT の整数を自由入力
    const countInput = (name, v) =>
      `<input type="number" name="${name}" value="${v}" min="0" max="${MAX_COUNT}" step="1" required inputmode="numeric">`;
    const groups = groupInfo();
    const myGroup = groups[r.group_id];
    const candidates = active().filter(x => x.id !== r.id)
      .sort((a, b) => a.room.localeCompare(b.room, 'ja', { numeric: true }));
    const mate = myGroup && myGroup.members.find(x => x.id !== r.id);
    const groupHtml = `
        <div class="groupBox">
          <label class="check"><input type="checkbox" name="grouped" ${myGroup ? 'checked' : ''}>
            グループ登録(単体、または他の予約と紐づける)</label>
          <div class="groupPick" ${myGroup ? '' : 'hidden'}>
            <label>紐づける予約<select name="group_with">
              <option value="">なし(この予約だけでグループ)</option>
              ${candidates.map(x => `<option value="${x.id}"${mate && x.id === mate.id ? ' selected' : ''}>${esc(roomText(x.room))}　${esc(x.guest_name)}(${x.time_slot || '未定'})${groups[x.group_id] ? `　[G${groups[x.group_id].no}]` : ''}</option>`).join('')}
            </select></label>
            ${myGroup ? `<p class="muted groupNote">現在のグループ: ${myGroup.members.map(x => esc(roomText(x.room) + ' ' + x.guest_name)).join('、')}</p>` : ''}
            <p class="muted groupNote">選んだ予約がグループ登録済みの場合は、そのグループに加わります。</p>
          </div>
        </div>`;
    const m = modal({
      title: isNew ? '予約を追加' : `予約を編集(${roomText(r.room)})`,
      wide: true,
      body: `<form class="form">
        <p class="formDate"><i class="ti ti-calendar"></i>${dateLabel(r.date)}${isNew
          ? '<span class="muted">から登録</span>'
          : `<span class="muted">${r.nights > 1 ? `${r.nights}泊の${r.night_no}泊目` : '1泊'}</span>`}${r.resv_no ? `<span class="muted">　予約番号 ${esc(r.resv_no)}</span>` : ''}</p>
        <div class="row">
          <label>時間<select name="time_slot">${slotOptions(r.time_slot)}</select></label>
          ${isNew ? '<label>泊数<input type="number" name="nights" value="1" min="1" max="30" required></label>' : ''}
        </div>
        ${isNew ? '<p class="muted nightsHint" style="margin:-4px 0 0;font-size:12px"></p>' : ''}
        <div class="row">
          <label>部屋番号<input type="text" name="room" value="${esc(r.room)}" required maxlength="255"></label>
          <label>代表者名<input type="text" name="guest_name" value="${esc(r.guest_name)}" maxlength="128"></label>
        </div>
        <div class="row">
          <label>大人${countInput('adults', r.adults)}</label>
          <label>幼児${countInput('children', r.children)}</label>
          <label>席のみ${countInput('infants', r.infants)}</label>
        </div>
        <label>アレルギー<textarea name="allergy" maxlength="2000">${esc(r.allergy)}</textarea></label>
        <label>備考<textarea name="note" maxlength="2000">${esc(r.note)}</textarea></label>
        ${groupHtml}
      </form>
      ${isNew ? '' : auditHtml(r)}`,
      buttons: [
        ...(isNew ? [] : [{ label: '削除', danger: true, left: true, onClick: () => confirmDelete(r, m) }]),
        { label: 'キャンセル' },
        {
          label: isNew ? '追加する' : '保存する', primary: true, onClick: async () => {
            const f = m.querySelector('form');
            if (!f.reportValidity()) return false;
            const grouped = f.grouped.checked;
            if (isNew && !f.time_slot.value && !(await confirmDialog({
              title: '時間が未定です',
              message: '時間が「未定」のまま登録しようとしています。このまま登録しますか？',
              ok: '未定のまま登録', cancel: '戻って時間を選ぶ',
            }))) { f.time_slot.focus(); return false; }
            if (!isNew && r.has_table_memo && (f.time_slot.value || null) !== r.time_slot
              && !(await confirmMemoLoss('時間を変更すると'))) return false;
            const body = {
              time_slot: f.time_slot.value || null,
              room: f.room.value, guest_name: f.guest_name.value,
              adults: +f.adults.value, children: +f.children.value, infants: +f.infants.value,
              allergy: f.allergy.value, note: f.note.value,
              grouped, group_with: grouped && f.group_with.value ? +f.group_with.value : null,
            };
            if (isNew) {
              Object.assign(body, { date: state.date, nights: +f.nights.value });
              await api(`/api/${MEAL}/reservations`, { method: 'POST', body });
              toast(body.nights > 1 ? `${body.nights}泊分(${body.nights}日)を登録しました` : '追加しました');
            } else {
              await api(`/api/${MEAL}/reservations/${r.id}`, { method: 'PUT', body });
              toast('保存しました');
            }
            await loadRows();
          }
        }
      ]
    });
    const form = m.querySelector('form');
    form.grouped.addEventListener('change', () => {
      const pick = m.querySelector('.groupPick');
      if (pick) pick.hidden = !form.grouped.checked;
    });
    if (isNew) {
      // 連泊時に登録される日付を表示
      const f = form;
      const hint = m.querySelector('.nightsHint');
      const upd = () => {
        const n = Math.min(Math.max(+f.nights.value || 1, 1), 30);
        hint.textContent = n > 1 ? `${dateLabel(state.date)} 〜 ${dateLabel(addDays(state.date, n - 1))} の${n}日分を登録します` : '';
      };
      f.nights.addEventListener('input', upd);
    } else {
      loadHistory(r, m);
    }
  }

  // 登録・更新・削除の記録と変更履歴
  function auditHtml(r) {
    const line = (label, ts, by) => ts ? `<div><span>${label}</span>${fmtTs(ts)}　${esc(by) || '-'}</div>` : '';
    return `<div class="audit">
      ${line('登録', r.created_at, r.created_by)}
      ${line('最終更新', r.updated_at, r.updated_by)}
      ${line('削除', r.deleted_at, r.deleted_by)}
    </div>
    <details class="history"><summary>変更履歴</summary><div class="historyList">読み込み中…</div></details>`;
  }

  async function loadHistory(r, m) {
    const box = m.querySelector('.historyList');
    try {
      const hist = await api(`/api/${MEAL}/reservations/${r.id}/history`);
      box.innerHTML = hist.map(h => {
        // 登録時は入力された項目だけ表示
        // 卓メモは中身を出さず、どの卓かだけ
        const entries = ['table_memo', 'table_counts'].includes(h.action) ? [] : Object.entries(h.changes || {})
          .filter(([, [, v]]) => !['create', 'import'].includes(h.action) || (v !== '' && v !== null && v !== 0));
        const detail = entries.map(([f, [a, b]]) => `<li><b>${FIELD_LABELS[f] || esc(f)}</b>: ${['create', 'import'].includes(h.action)
          ? esc(fmtVal(f, b))
          : `${esc(fmtVal(f, a))} → ${esc(fmtVal(f, b))}`}</li>`).join('');
        return `<div class="hItem hi-${h.action}">
          <div class="hHead"><span class="hAct">${ACTION_LABELS[h.action] || esc(h.action)}</span>${fmtTs(h.changed_at)}　${esc(h.changed_by) || '-'}</div>
          ${detail ? `<ul>${detail}</ul>` : ''}${h.action === 'table_memo' ? `<ul><li>卓 ${esc(h.changes?.table || '')}(内容はテーブルアサインで確認)</li></ul>` : ''}${h.action === 'table_counts' ? `<ul><li>卓 ${esc(h.changes?.table || '')}: ${esc(h.changes?.before || '')} → ${esc(h.changes?.after || '')}</li></ul>` : ''}</div>`;
      }).join('') || '<p class="muted">履歴はありません</p>';
    } catch (e) { box.textContent = '履歴を読み込めませんでした'; }
  }

  // 削除済み予約: 閲覧のみ(復元可)
  function openDeleted(r) {
    const item = (label, v) => `<div class="roItem"><span>${label}</span><div>${esc(v) || '<span class="muted">-</span>'}</div></div>`;
    const m = modal({
      title: `削除済みの予約(${roomText(r.room)})`,
      wide: true,
      body: `<div class="readonly">
        ${item('日付', r.date.replace(/-/g, '/'))}${item('時間', r.time_slot || '未定')}
        ${item('予約番号', r.resv_no)}${item('部屋番号', r.room)}${item('代表者名', r.guest_name)}
        ${item('泊数', r.nights > 1 ? `${r.nights}泊(${r.night_no}泊目)` : '1泊')}
        ${item('人数', `大人${r.adults} 幼児${r.children} 席のみ${r.infants}(計${total(r)})`)}
        ${item('アレルギー', r.allergy)}${item('備考', r.note)}
      </div>${auditHtml(r)}`,
      buttons: [
        { label: '復元する', left: true, onClick: async () => {
          await api(`/api/${MEAL}/reservations/${r.id}/restore`, { method: 'POST' });
          toast('復元しました');
          await loadRows();
        } },
        { label: '閉じる', primary: true },
      ]
    });
    loadHistory(r, m);
  }

  // はい/いいえの確認。閉じ方に関わらず結果を返す
  // テーブルアサインの卓メモ(中身はこの画面では見せない)が消えるときの確認
  const confirmMemoLoss = what => confirmDialog({
    title: '卓メモの削除', message: `${what}テーブルの割り当てが外れ、テーブルアサインで入力された卓メモも削除されます。よろしいですか？`,
    ok: '続ける(メモも削除)', danger: true });

  function confirmDialog({ title, message, note, ok, cancel = 'キャンセル', danger }) {
    return new Promise(resolve => {
      let yes = false;
      modal({
        title,
        body: `<p style="margin:0">${message}</p>${note ? `<p class="muted" style="margin:8px 0 0;font-size:12px">${note}</p>` : ''}`,
        buttons: [{ label: cancel }, { label: ok, primary: !danger, danger, onClick: () => { yes = true; } }],
        onClose: () => resolve(yes),
      });
    });
  }

  async function confirmDelete(r, parent) {
    const ok = await confirmDialog({
      title: '予約を削除',
      message: `${esc(roomText(r.room))} ${esc(r.guest_name)} 様の予約を削除します。よろしいですか？`,
      note: '削除した予約は「削除済みも表示」から閲覧・復元できます。'
        + (r.has_table_memo ? ' テーブルの割り当てと卓メモは削除され、復元しても戻りません。' : ''),
      ok: '削除する', danger: true,
    });
    if (!ok) return false;
    await api(`/api/${MEAL}/reservations/${r.id}`, { method: 'DELETE' });
    toast('削除しました');
    parent.close();
    await loadRows();
    return false;
  }

  // ---------- イベント ----------
  root.addEventListener('click', e => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'prev') setDate(addDays(state.date, -1));
    else if (act === 'next') setDate(addDays(state.date, 1));
    else if (act === 'today') setDate(fmtDate(new Date()));
    else if (act === 'print') window.print();
    else if (act === 'add') openForm(null);
    else if (act === 'slots') openSlots().catch(() => {});
  });

  // 時間枠の追加・削除(全ロール可。固定の枠は鍵付きで削除不可)
  async function openSlots() {
    const [latest, fixed] = await Promise.all([api(`/api/slots/${MEAL}`), api(`/api/slots/${MEAL}/fixed`)]);
    state.slots = latest;
    let slots = [...latest];
    const m = modal({
      title: `${MEAL === 'dinner' ? '夕食' : '朝食'}の時間枠`,
      body: `<div class="slotEdit"><div class="slotChips"></div>
        <div class="slotAdd"><input type="time" step="300" aria-label="追加する時刻"><button type="button" class="btn" data-sadd><i class="ti ti-plus"></i>追加</button></div>
        <p class="muted" style="margin:8px 0 0;font-size:12px">鍵の付いた時間枠は削除できません。すでに予約が入っている時間枠を削除しても、予約の時間はそのまま残ります。</p></div>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '保存する', primary: true, onClick: async () => {
          state.slots = await api(`/api/slots/${MEAL}`, { method: 'PUT', body: { slots } });
          toast('時間枠を保存しました');
          render();
        }
      }],
    });
    const chips = m.querySelector('.slotChips');
    const input = m.querySelector('input[type=time]');
    const draw = () => {
      chips.innerHTML = slots.map(s => fixed.includes(s)
        ? `<span class="slotChip fixed" title="固定の時間枠のため削除できません">${s}<i class="ti ti-lock" aria-label="削除不可"></i></span>`
        : `<span class="slotChip">${s}<button type="button" data-sdel="${s}" aria-label="${s} を削除"><i class="ti ti-x"></i></button></span>`).join('')
        || '<span class="muted">時間枠がありません</span>';
    };
    const add = () => {
      if (input.value && !slots.includes(input.value)) slots = [...slots, input.value].sort();
      input.value = '';
      draw();
    };
    m.querySelector('[data-sadd]').addEventListener('click', add);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    chips.addEventListener('click', e => {
      const s = e.target.closest('[data-sdel]')?.dataset.sdel;
      if (s && !fixed.includes(s)) { slots = slots.filter(x => x !== s); draw(); }
    });
    draw();
  }
  dateInput.addEventListener('change', () => { if (dateInput.value) setDate(dateInput.value); });
  $('ldSearch').addEventListener('input', e => { state.q = e.target.value; render(); });
  root.querySelector('thead').addEventListener('click', e => {
    const key = e.target.closest('th[data-sort]')?.dataset.sort;
    if (!key) return;
    const col = COLUMNS.find(c => c.key === key);
    state.sort = state.sort.key === key ? { key, dir: -state.sort.dir } : { key, dir: col.firstDir || 1 };
    render();
  });
  // 時間枠カード: クリックでその時間だけ表示(同じカード・合計・解除ボタンで解除)
  function setSlotFilter(slot) {
    state.slotFilter = slot === '*' || slot === state.slotFilter ? null : slot;
    const u = new URL(location.href);
    if (state.slotFilter === null) u.searchParams.delete('t'); else u.searchParams.set('t', state.slotFilter);
    history.replaceState(null, '', u);
    render();
  }
  root.addEventListener('click', e => {
    const c = e.target.closest('#ldSummary [data-slot], #ldFilterNote [data-slot]');
    if (c) setSlotFilter(c.dataset.slot);
  });
  $('ldSummary').addEventListener('keydown', e => {
    const c = e.target.closest('[data-slot]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSlotFilter(c.dataset.slot); }
  });
  $('ldShowDeleted').addEventListener('change', e => { state.showDeleted = e.target.checked; loadRows().catch(() => {}); });

  const tbody = $('ldBody');
  tbody.addEventListener('change', async e => {
    if (!e.target.classList.contains('slotSel')) return;
    const id = +e.target.closest('tr').dataset.id;
    const cur = state.rows.find(r => r.id === id);
    if (cur && cur.has_table_memo && !(await confirmMemoLoss('時間を変更すると'))) return render();
    try {
      const updated = await api(`/api/${MEAL}/reservations/${id}/time`, { method: 'PATCH', body: { time_slot: e.target.value || null } });
      state.rows = state.rows.map(r => r.id === id ? updated : r);
      toast(`${roomText(updated.room)} を ${updated.time_slot || '未定'} に変更しました`);
    } catch (err) { /* toast 済み */ }
    render();
  });
  tbody.addEventListener('change', async e => {
    if (!e.target.classList.contains('entSel')) return;
    const cb = e.target;
    const entered = cb.checked;
    cb.checked = !entered;  // 確認で「はい」を押すまで戻しておく
    const r = state.rows.find(x => x.id === +cb.closest('tr').dataset.id);
    const who = `${esc(roomText(r.room))} ${esc(r.guest_name)}${r.guest_name ? ' 様' : ''}`;
    const ok = await confirmDialog(entered
      ? { title: '入場済にする', message: `${who}を入場済にしますか？`, ok: 'はい', cancel: 'いいえ' }
      : { title: '入場済を取り消す', message: `${who}の入場済を取り消しますか？`, ok: 'はい', cancel: 'いいえ' });
    if (!ok) return;
    try {
      const updated = await api(`/api/${MEAL}/reservations/${r.id}/entered`, { method: 'PATCH', body: { entered } });
      state.rows = state.rows.map(x => x.id === r.id ? updated : x);
      toast(entered ? `${roomText(r.room)} を入場済にしました` : `${roomText(r.room)} の入場済を取り消しました`);
    } catch (err) { /* toast 済み */ }
    render();
  });
  tbody.addEventListener('click', e => {
    if (e.target.closest('select, .entChk, .cntInput')) return;
    const cell = e.target.closest('td.cnt');
    if (cell) return editCount(cell);
    const tr = e.target.closest('tr[data-id]');
    if (tr) openForm(state.rows.find(r => r.id === +tr.dataset.id));
  });

  // ---------- 人数の直接入力 ----------
  // 人数のセルをクリックすると入力欄になる。Enter で保存して次の行の同じ欄へ、Tab で右の欄へ、Esc で取り消し
  function editCount(td, initial) {
    const id = +td.closest('tr').dataset.id, key = td.dataset.cnt;
    const r = state.rows.find(x => x.id === id);
    td.innerHTML = `<input type="number" class="cntInput" min="0" max="${MAX_COUNT}" step="1" inputmode="numeric" value="${esc(initial ?? r[key])}" aria-label="人数">`;
    const input = td.firstChild;
    input.focus();
    input.select();
    let done = false;
    const finish = async move => {
      if (done || input.dataset.closing) return;
      done = true;
      input.dataset.closing = '1';
      // 移動先は保存前の並びで決める(人数で並べ替えていると保存後に行の位置が変わるため)
      const target = move ? neighborCount(id, key, move) : null;
      const v = input.value.trim();
      const n = Number(v);
      if (v === '' || !Number.isInteger(n) || n < 0 || n > MAX_COUNT) {
        toast(`人数は0〜${MAX_COUNT}の整数で入力してください`, true);
        render();
        return;
      }
      if (n !== r[key]) {
        try {
          const body = Object.fromEntries(COUNT_KEYS.map(k => [k, k === key ? n : r[k]]));
          const updated = await api(`/api/${MEAL}/reservations/${id}/counts`, { method: 'PATCH', body });
          state.rows = state.rows.map(x => x.id === id ? updated : x);
        } catch (err) { /* toast 済み */ }
      }
      render();
      if (target) {
        const td = tbody.querySelector(`tr[data-id="${target.id}"] td.cnt[data-cnt="${target.key}"]`);
        if (td) editCount(td);
      }
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); finish(e.shiftKey ? 'up' : 'down'); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? 'left' : 'right'); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done = true; input.dataset.closing = '1'; render(); }
    });
    // 他のセルをクリックしたときは、そのクリックが済んでから保存・描き直す
    input.addEventListener('blur', () => setTimeout(() => finish(null), 0));
  }
  function neighborCount(id, key, dir) {
    const trs = [...tbody.querySelectorAll('tr[data-id]')].filter(tr => tr.querySelector('td.cnt'));
    let i = trs.findIndex(tr => +tr.dataset.id === id), k = COUNT_KEYS.indexOf(key);
    if (dir === 'down') i++;
    else if (dir === 'up') i--;
    else if (dir === 'right') { k++; if (k >= COUNT_KEYS.length) { k = 0; i++; } }
    else if (dir === 'left') { k--; if (k < 0) { k = COUNT_KEYS.length - 1; i--; } }
    return trs[i] ? { id: +trs[i].dataset.id, key: COUNT_KEYS[k] } : null;
  }

  // 他端末の更新を反映(編集中・入力中は止める)
  setInterval(() => {
    const el = document.activeElement;
    if (document.hidden || AMT.isModalOpen() || el?.classList.contains('slotSel') || el?.classList.contains('cntInput')) return;
    loadSlots().then(loadRows).catch(() => {});
  }, REFRESH_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !AMT.isModalOpen()) loadRows().catch(() => {}); });
  window.addEventListener('amt:imported', () => loadRows().catch(() => {}));

  // チャットの予約カードから来た場合(?hl=予約ID)は該当行を強調
  async function highlight(id) {
    if (!id) return;
    let row = tbody.querySelector(`tr[data-id="${id}"]`);
    if (!row && !state.showDeleted) {  // 削除済みなら削除済みも表示して探す
      $('ldShowDeleted').checked = state.showDeleted = true;
      await loadRows();
      row = tbody.querySelector(`tr[data-id="${id}"]`);
    }
    if (!row) return toast('予約が見つかりません', true);
    row.scrollIntoView({ block: 'center' });
    row.classList.add('flash');
    setTimeout(() => row.classList.remove('flash'), 2600);
  }

  AMT.me.then(me => { state.role = me.role; render(); }).catch(() => {});
  loadSlots().then(loadRows).then(() => highlight(params.get('hl'))).catch(() => {});
})();
