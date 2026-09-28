/* 共通ヘルパー: API・モーダル・トースト */
window.AMT = (function () {
  const esc = t => String(t ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(url, opts = {}) {
    const init = { method: opts.method || 'GET', headers: {} };
    if (opts.body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    const r = await fetch(url, init);
    if (r.status === 401 && url !== '/api/login') { location.href = '/login'; throw new Error('401'); }
    const data = await r.json().catch(() => null);
    if (!r.ok) {
      let msg = '通信エラーが発生しました';
      if (data && typeof data.detail === 'string') msg = data.detail;
      else if (data && Array.isArray(data.detail)) msg = data.detail.map(d => String(d.msg).replace(/^Value error, /, '')).join(' / ');
      toast(msg, true);
      throw new Error(msg);
    }
    return data;
  }

  let toastTimer;
  function toast(msg, isError) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg;
    el.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.className = ''; }, 3000);
  }

  // buttons: [{label, primary, danger, left, onClick}] — onClick が false を返すか例外なら閉じない
  // onClose: 閉じ方に関わらず閉じたときに1回呼ばれる
  function modal({ title, body, buttons = [], wide, onClose }) {
    const wrap = document.createElement('div');
    wrap.className = 'modalWrap';
    wrap.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog" aria-modal="true">
      <div class="modalHead"><h2>${esc(title)}</h2><button class="iconBtn" data-close aria-label="閉じる"><i class="ti ti-x"></i></button></div>
      <div class="modalBody">${body}</div>
      <div class="modalFoot"></div></div>`;
    const foot = wrap.querySelector('.modalFoot');
    const close = () => {
      if (!wrap.isConnected) return;
      wrap.remove(); document.removeEventListener('keydown', onKey);
      if (onClose) onClose();
    };
    const isTop = () => [...document.querySelectorAll('.modalWrap')].pop() === wrap;
    const onKey = e => { if (e.key === 'Escape' && isTop()) close(); };
    buttons.forEach(b => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn' + (b.primary ? ' primary' : '') + (b.danger ? ' danger' : '');
      if (b.left) btn.style.marginRight = 'auto';
      btn.textContent = b.label;
      btn.addEventListener('click', async () => {
        if (!b.onClick) return close();
        btn.disabled = true;
        try { if ((await b.onClick()) !== false) close(); } catch (e) { /* toast 済み */ }
        btn.disabled = false;
      });
      foot.appendChild(btn);
    });
    wrap.querySelector('[data-close]').addEventListener('click', close);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    document.addEventListener('keydown', onKey);
    const form = wrap.querySelector('form');
    if (form) form.addEventListener('submit', e => { e.preventDefault(); foot.querySelector('.primary')?.click(); });
    document.body.appendChild(wrap);
    wrap.querySelector('input,select,textarea')?.focus();
    wrap.close = close;
    return wrap;
  }

  // 検索用の正規化: 半角カナ→全角(NFKC)、ひらがな→カタカナ、英字は小文字、空白は無視
  // (ﾔﾏﾀﾞ・ヤマダ・やまだ のどれでも同じ名前に当たる)
  const normSearch = v => String(v ?? '').normalize('NFKC')
    .replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))
    .replace(/\s+/g, '').toLowerCase();

  return { esc, api, toast, modal, normSearch, isModalOpen: () => !!document.querySelector('.modalWrap') };
})();

/* common.js — 上部バー・サイドバーを生成し、body直下の要素を #mainContent に移す */
(function () {
  const CONFIG = {
    siteName: 'グランヴィリオホテル丹波篠山　喫食時間管理表',
    favicon: '/static/logo.png',  // 上部バーのロゴ(favicon.ico から余白を除いたもの)
    ticker: '',             // お知らせ(空なら非表示)
    // roles: 表示するロール(省略時は全員)
    topButtons: [
      { label: 'アップロード', icon: 'ti-upload', type: 'normal', href: '#import', roles: ['developer', 'admin', 'front'] },
      { label: 'パスワード変更', icon: 'ti-key', type: 'normal', href: '#password' },
      { label: 'ログアウト', icon: 'ti-logout', type: 'normal', href: '/logout' }
    ],
    mainMenu: [
      { label: '夕食時間管理表', icon: 'ti-moon', href: '/dinner' },
      { label: 'テーブルアサイン', icon: 'ti-armchair', href: '/tables' },
      { label: '夕食集計', icon: 'ti-chart-bar', href: '/dinner-summary' },
      { label: '朝食時間管理表', icon: 'ti-sun', href: '/breakfast' },
      { label: '朝食集計', icon: 'ti-chart-bar', href: '/breakfast-summary' },
      { label: 'チャット', icon: 'ti-messages', href: '/chat', badgeKey: 'chat' },
      { label: '操作ログ', icon: 'ti-list-details', href: '/logs' }
    ],
    adminMenu: {
      heading: '管理者メニュー',
      items: [{ label: '管理者ページ', icon: 'ti-settings', href: '/admin' }]
    }
  };
  const LS_KEY = 'sidebarCollapsed';
  const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
  const esc = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const pageNodes = Array.from(document.body.childNodes)
    .filter(n => !(n.nodeType === 1 && n.tagName === 'SCRIPT'));

  const path = location.pathname.replace(/\/$/, '') || '/';
  const navRow = (it, admin) => {
    const active = path === it.href;
    return `<a class="navRow${admin ? ' adminPage' : ''}${active ? ' navRowActive' : ''}" href="${it.href}">
      <i class="ti ${it.icon}"></i><span class="lbl">${esc(it.label)}</span>
      ${it.badgeKey ? `<span class="badge" data-badge="${it.badgeKey}" hidden></span>` : ''}</a>`;
  };

  // 上部バー
  const topbar = document.createElement('header');
  topbar.id = 'topbar';
  topbar.innerHTML = `
    <div class="tbLeft">
      <button id="hamburger" aria-label="メニューを開く"><i class="ti ti-menu-2"></i></button>
      ${CONFIG.favicon
        ? `<img class="tbFavicon" src="${CONFIG.favicon}" alt="">`
        : `<div class="tbFaviconPh" aria-hidden="true">未定</div>`}
      <div class="tbLogo">${esc(CONFIG.siteName)}</div>
    </div>
    ${CONFIG.ticker ? `<div class="ticker"><i class="ti ti-speakerphone"></i><span>${esc(CONFIG.ticker)}</span></div>` : ''}
    <div class="tbRight">
      ${CONFIG.topButtons.map(b => `<a class="pillBtn ${b.type}" href="${b.href}" title="${esc(b.label)}" style="text-decoration:none"${b.roles ? ` data-roles="${b.roles.join(' ')}" hidden` : ''}><i class="ti ${b.icon}"></i><span class="btnLbl">${esc(b.label)}</span></a>`).join('')}
    </div>`;

  // サイドバー
  const sidebar = document.createElement('nav');
  sidebar.id = 'sidebar';
  sidebar.innerHTML = `
    <div class="sbTop">
      <div id="accountRow">
        <div class="avatar"></div>
        <div class="userName"></div>
        <button id="collapseBtn" aria-label="サイドバーを格納"><i class="ti ti-arrow-left"></i></button>
      </div>
      <div class="navGroup">
        ${CONFIG.mainMenu.map(it => navRow(it, false)).join('')}
        <div class="navHeading" id="adminHeading">${esc(CONFIG.adminMenu.heading)}<i class="ti ti-chevron-down"></i></div>
        <div class="navSection" id="adminSection">${CONFIG.adminMenu.items.map(it => navRow(it, true)).join('')}</div>
      </div>
    </div>`;

  const main = document.createElement('main');
  main.id = 'mainContent';
  pageNodes.forEach(n => main.appendChild(n));

  const backdrop = document.createElement('div');
  backdrop.id = 'drawerBackdrop';

  document.body.prepend(topbar, sidebar, backdrop, main);

  // ユーザー名・管理者メニュー
  const setUser = name => {
    sidebar.querySelector('.avatar').textContent = name.charAt(0);
    sidebar.querySelector('.userName').textContent = name;
  };
  setUser('…');
  const adminEls = [document.getElementById('adminHeading'), document.getElementById('adminSection')];
  adminEls.forEach(el => { el.hidden = true; });
  // チャット未読バッジ(チャットページ自身も AMT.setUnread で更新する)
  AMT.setUnread = n => {
    const b = sidebar.querySelector('[data-badge=chat]');
    b.textContent = n > 99 ? '99+' : n;
    b.hidden = !n;
  };
  const pollUnread = () => {
    if (document.hidden) return;
    AMT.api('/api/chat/unread').then(d => AMT.setUnread(d.unread)).catch(() => {});
  };
  if (path !== '/chat') {
    pollUnread();
    setInterval(pollUnread, 30000);
    document.addEventListener('visibilitychange', pollUnread);
  }

  AMT.me = AMT.api('/api/me').then(d => {
    setUser(d.name);
    sidebar.querySelector('.userName').title = `${d.name}(${d.role_label})`;
    adminEls.forEach(el => { el.hidden = !d.is_admin; });
    topbar.querySelectorAll('[data-roles]').forEach(el => { el.hidden = !el.dataset.roles.split(' ').includes(d.role); });
    return d;
  });

  // 格納
  const collapseBtn = document.getElementById('collapseBtn');
  const applyCollapsed = c => {
    document.body.classList.toggle('sbCollapsed', c);
    collapseBtn.querySelector('i').className = 'ti ' + (c ? 'ti-arrow-right' : 'ti-arrow-left');
    collapseBtn.setAttribute('aria-label', c ? 'サイドバーを展開' : 'サイドバーを格納');
  };
  applyCollapsed(lsGet(LS_KEY) === '1');
  collapseBtn.addEventListener('click', () => {
    const c = !document.body.classList.contains('sbCollapsed');
    applyCollapsed(c); lsSet(LS_KEY, c ? '1' : '0');
  });

  // 管理者見出しの開閉
  document.getElementById('adminHeading').addEventListener('click', e => {
    e.currentTarget.classList.toggle('closed');
    document.getElementById('adminSection').classList.toggle('closed');
  });

  // ハンバーガー(640px以下)
  document.getElementById('hamburger').addEventListener('click', () => document.body.classList.toggle('drawerOpen'));
  backdrop.addEventListener('click', () => document.body.classList.remove('drawerOpen'));

  // パスワード変更
  topbar.querySelector('a[href="#password"]').addEventListener('click', e => {
    e.preventDefault();
    const m = AMT.modal({
      title: 'パスワード変更',
      body: `<form class="form">
        <label>現在のパスワード<input type="password" name="current" required autocomplete="current-password"></label>
        <label>新しいパスワード(4文字以上)<input type="password" name="new" required minlength="4" autocomplete="new-password"></label>
        <label>新しいパスワード(確認)<input type="password" name="confirm" required minlength="4" autocomplete="new-password"></label>
      </form>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '変更する', primary: true, onClick: async () => {
          const f = m.querySelector('form');
          if (!f.reportValidity()) return false;
          if (f.new.value !== f.confirm.value) { AMT.toast('確認用パスワードが一致しません', true); return false; }
          await AMT.api('/api/me/password', { method: 'POST', body: { current: f.current.value, new: f.new.value } });
          AMT.toast('パスワードを変更しました');
        }
      }]
    });
  });

  // CSVアップロード(宿泊者リスト①予約・②部屋割りの2ファイルがそろったら取り込める)
  topbar.querySelector('a[href="#import"]').addEventListener('click', e => {
    e.preventDefault();
    let files = [];  // [{name, data(base64)}]
    let seq = 0;     // 最新の確認結果だけを反映する
    const readB64 = f => new Promise((ok, ng) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result).split(',')[1] || '');
      fr.onerror = () => ng(fr.error);
      fr.readAsDataURL(f);
    });
    const md = s => { const [, m, d] = s.split('-'); return `${+m}/${+d}`; };
    const m = AMT.modal({
      title: 'CSVアップロード(宿泊者リスト)',
      wide: true,
      body: `<div class="imp">
        <label class="impDrop"><i class="ti ti-file-upload"></i>
          <span>①予約・②部屋割りのCSVを選択(ドラッグ&ドロップ可・2つ同時に選べます)</span>
          <input type="file" accept=".csv,.CSV" multiple hidden></label>
        <ul class="impFiles"></ul>
        <div class="impResult"></div>
      </div>`,
      buttons: [{ label: 'キャンセル' }, {
        label: '取り込む', primary: true, onClick: async () => {
          const d = await AMT.api('/api/import/commit', { method: 'POST', body: { files } });
          const s = d.summary;
          AMT.toast(`取り込みました(夕食${s.dinner}件・朝食${s.breakfast}件・更新${s.update}件)`);
          window.dispatchEvent(new CustomEvent('amt:imported'));
        }
      }]
    });
    const runBtn = m.querySelector('.modalFoot .primary');
    const input = m.querySelector('input[type=file]');
    const list = m.querySelector('.impFiles');
    const result = m.querySelector('.impResult');
    runBtn.disabled = true;

    function renderFiles(info = []) {
      list.innerHTML = files.map((f, i) => {
        const k = info[i];
        return `<li><i class="ti ti-file-text"></i><span class="impName">${AMT.esc(f.name)}</span>
          ${k ? `<span class="impKind${k.kind ? '' : ' bad'}">${AMT.esc(k.kind_label)}${k.kind ? `(${k.rows}行)` : ''}</span>` : '<span class="muted">確認中…</span>'}
          <button type="button" class="iconBtn" data-rm="${i}" aria-label="外す"><i class="ti ti-x"></i></button></li>`;
      }).join('');
    }
    function renderResult(d) {
      if (!d) { result.innerHTML = ''; return; }
      if (!d.ready) {
        result.innerHTML = `<p class="impWarn"><i class="ti ti-alert-triangle"></i>${d.missing.map(AMT.esc).join('・')}のファイルも選んでください。2つそろわないと取り込めません。</p>`;
        return;
      }
      const s = d.summary;
      const slots = s.dinner_by_slot.map(x => `${x.slot || '未定'} ${x.count}件`).join('・');
      result.innerHTML = `<table class="impSum">
          <tr><th>夕食(新規)</th><td><b>${s.dinner}</b>件${slots ? `<span class="muted">(${slots})</span>` : ''}</td></tr>
          <tr><th>朝食(新規)</th><td><b>${s.breakfast}</b>件<span class="muted">(すべて時間未定)</span></td></tr>
          <tr><th>取込済み</th><td>部屋番号・名前の更新 <b>${s.update}</b>件 / 変更なし ${s.unchanged}件${s.skipped_deleted ? ` / 削除済みのため対象外 ${s.skipped_deleted}件` : ''}</td></tr>
          <tr><th>予約</th><td>${s.stays}件(取消 ${s.cancelled}件・夕食/朝食なし ${s.not_target}件${s.unassigned ? `・<span class="warnTxt">部屋未割当 ${s.unassigned}件</span>` : ''})</td></tr>
        </table>
        <p class="muted">人数は0で登録します。取込済みの予約は、時間・人数・アレルギー・備考を上書きしません。</p>
        ${d.alerts.length ? `<div class="impAlerts"><h3><i class="ti ti-alert-triangle"></i>要確認(${d.alerts.length}件) — 自動では削除しません。管理表で確認してください</h3>
          <ul>${d.alerts.map(a => `<li><a href="${a.link}" target="_blank" rel="noopener">${a.meal_label} ${a.dates.length > 1 ? `${md(a.dates[0])}〜${md(a.dates[a.dates.length - 1])}(${a.dates.length}日)` : md(a.dates[0])}
            ${AMT.esc(a.room)} ${AMT.esc(a.guest_name)}</a> <span class="impReason">${AMT.esc(a.reason)}</span>${a.manual ? ' <span class="impManual">手入力あり</span>' : ''}</li>`).join('')}</ul></div>` : ''}`;
    }
    async function check() {
      const my = ++seq;
      runBtn.disabled = true;
      renderFiles();
      if (!files.length) { renderResult(null); return; }
      try {
        const d = await AMT.api('/api/import/preview', { method: 'POST', body: { files } });
        if (my !== seq) return;
        // 同じ種別を複数選んだときは、サーバーと同じく後から選んだものだけ残す
        const lastOf = {};
        d.files.forEach((f, i) => { if (f.kind) lastOf[f.kind] = i; });
        const keep = d.files.map((f, i) => !f.kind || lastOf[f.kind] === i);
        files = files.filter((_, i) => keep[i] ?? true);
        renderFiles(d.files.filter((_, i) => keep[i]));
        renderResult(d);
        runBtn.disabled = !d.ready;
      } catch (err) {
        if (my === seq) { renderFiles(); result.innerHTML = `<p class="impWarn">${AMT.esc(err.message)}</p>`; }
      }
    }
    async function add(fileList) {
      const picked = [...fileList].filter(f => /\.csv$/i.test(f.name));
      if (!picked.length) { AMT.toast('CSVファイルを選んでください', true); return; }
      seq++;  // 読み込み中に返ってきた前の確認結果は使わない
      for (const f of picked) files.push({ name: f.name, data: await readB64(f) });
      files = files.slice(-10);
      check();
    }
    input.addEventListener('change', () => { add(input.files); input.value = ''; });
    list.addEventListener('click', ev => {
      const b = ev.target.closest('[data-rm]');
      if (b) { files.splice(+b.dataset.rm, 1); check(); }
    });
    const drop = m.querySelector('.impDrop');
    drop.addEventListener('dragover', ev => { ev.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', ev => { ev.preventDefault(); drop.classList.remove('over'); add(ev.dataTransfer.files); });
  });
})();
