'use strict';

/* ========================================================
   データモデル
   ======================================================== */

// 各ノードの画面上の座標(SVG座標系。index.html の viewBox と対応)
const NODE_POS = {
  'PC1':     { x: 75,  y: 255 },
  'A':       { x: 305, y: 137.5 },
  'B':       { x: 305, y: 387.5 },
  'C':       { x: 595, y: 257.5 },
  'Server1': { x: 755, y: 255 }
};

// つながっているノードの組(エッジID解決用)
const EDGE_PAIRS = [
  ['PC1', 'A'], ['A', 'B'], ['A', 'C'], ['B', 'C'], ['C', 'Server1']
];

// IPアドレス → 所有ノード情報 のマップ
// kind: 'lan'(LAN側インターフェース) / 'link'(ルータ間リンク) / 'host'(PC・サーバー自身)
const IP_OWNER = {
  '192.168.1.1':  { node: 'A', kind: 'lan',  net: '192.168.1.0/24' },
  '192.168.1.10': { node: 'PC1', kind: 'host' },

  '10.0.12.1': { node: 'A', kind: 'link' },
  '10.0.12.2': { node: 'B', kind: 'link' },
  '10.0.13.1': { node: 'A', kind: 'link' },
  '10.0.13.2': { node: 'C', kind: 'link' },
  '10.0.23.1': { node: 'B', kind: 'link' },
  '10.0.23.2': { node: 'C', kind: 'link' },

  '192.168.4.1':  { node: 'C', kind: 'lan',  net: '192.168.4.0/24' },
  '192.168.4.10': { node: 'Server1', kind: 'host' }
};

// ルーターのルーティングテーブル本体(ユーザーが編集する)
const ROUTERS = {
  A: { table: [] },
  B: { table: [] },
  C: { table: [] }
};

// モデル解答(最短経路: A → C 直結)
const MODEL_ANSWER = {
  A: [{ net: '192.168.4.0/24', hop: '10.0.13.2' }],
  B: [{ net: '192.168.4.0/24', hop: '10.0.23.2' }],
  C: [{ net: '192.168.4.0/24', hop: '192.168.4.1' }]
};

const DEST_IP = '192.168.4.10';

/* ========================================================
   ユーティリティ
   ======================================================== */

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function ipTo24Net(ip) {
  const parts = ip.trim().split('.');
  if (parts.length !== 4) return null;
  return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
}

function isValidCidr(str) {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.test(str.trim());
}
function isValidIp(str) {
  return /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(str.trim());
}

function edgeIdBetween(a, b) {
  const pair = EDGE_PAIRS.find(p => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
  if (!pair) return null;
  return `edge-${pair[0]}-${pair[1]}`;
}

/* ========================================================
   ネットワーク図の操作
   ======================================================== */

function resetDiagram() {
  document.querySelectorAll('.edge').forEach(el => el.classList.remove('done', 'bad'));
  document.querySelectorAll('.device').forEach(el => el.classList.remove('pulse-bad'));
  const packet = document.getElementById('packet');
  const start = NODE_POS['PC1'];
  packet.style.transition = 'none';
  packet.setAttribute('transform', `translate(${start.x},${start.y})`);
  // 次のフレームでtransitionを戻す
  requestAnimationFrame(() => { packet.style.transition = ''; });
}

function markEdgeDone(a, b) {
  const id = edgeIdBetween(a, b);
  if (id) document.getElementById(id).classList.add('done');
}
function markEdgeBad(a, b) {
  const id = edgeIdBetween(a, b);
  if (id) document.getElementById(id).classList.add('bad');
}
function pulseNodeBad(id) {
  const el = document.getElementById('node-' + id);
  if (el) el.classList.add('pulse-bad');
}

function animateMove(fromId, toId, duration = 650) {
  return new Promise(resolve => {
    const packet = document.getElementById('packet');
    const to = NODE_POS[toId];
    packet.style.transition = `transform ${duration}ms linear`;
    packet.setAttribute('transform', `translate(${to.x},${to.y})`);
    setTimeout(resolve, duration + 30);
  });
}

/* ========================================================
   ログ・バナー
   ======================================================== */

const logEl = document.getElementById('log');
function addLog(text) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = text;
  logEl.appendChild(div);
  logEl.scrollTop = logEl.scrollHeight;
}
function clearLog() {
  logEl.innerHTML = '';
}
function showBanner(type, title, hint) {
  const b = document.getElementById('resultBanner');
  b.className = 'banner show ' + type;
  b.innerHTML = title + (hint ? `<span class="hint">${hint}</span>` : '');
}
function clearBanner() {
  const b = document.getElementById('resultBanner');
  b.className = 'banner';
  b.innerHTML = '';
}

/* ========================================================
   ルーティングテーブル編集UI
   ======================================================== */

let currentRouter = 'A';

const tabButtons = document.querySelectorAll('.tab-btn');
tabButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    tabButtons.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');
    currentRouter = btn.dataset.router;
    document.getElementById('formError').textContent = '';
    renderTable();
  });
});

function renderTable() {
  const body = document.getElementById('rtBody');
  body.innerHTML = '';
  ROUTERS[currentRouter].table.forEach((row, idx) => {
    const tr = document.createElement('tr');

    const tdNet = document.createElement('td');
    tdNet.contentEditable = 'true';
    tdNet.textContent = row.net;
    tdNet.addEventListener('blur', () => {
      const val = tdNet.textContent.trim();
      if (!isValidCidr(val)) {
        tdNet.classList.add('invalid');
        return;
      }
      tdNet.classList.remove('invalid');
      row.net = val;
    });

    const tdHop = document.createElement('td');
    tdHop.contentEditable = 'true';
    tdHop.textContent = row.hop;
    tdHop.addEventListener('blur', () => {
      const val = tdHop.textContent.trim();
      if (!isValidIp(val)) {
        tdHop.classList.add('invalid');
        return;
      }
      tdHop.classList.remove('invalid');
      row.hop = val;
    });

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.type = 'button';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => {
      ROUTERS[currentRouter].table.splice(idx, 1);
      renderTable();
    });
    tdDel.appendChild(delBtn);

    tr.appendChild(tdNet);
    tr.appendChild(tdHop);
    tr.appendChild(tdDel);
    body.appendChild(tr);
  });
}
renderTable();

document.getElementById('addRowForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const netInput = document.getElementById('newNet');
  const hopInput = document.getElementById('newHop');
  const errEl = document.getElementById('formError');

  const net = netInput.value.trim();
  const hop = hopInput.value.trim();

  if (!isValidCidr(net) && net !== '0.0.0.0/0') {
    errEl.textContent = '宛先ネットワークアドレスの形式が正しくありません(例: 192.168.4.0/24)。';
    return;
  }
  if (!isValidIp(hop)) {
    errEl.textContent = 'ネクストホップのIPアドレスの形式が正しくありません(例: 10.0.13.2)。';
    return;
  }
  errEl.textContent = '';
  ROUTERS[currentRouter].table.push({ net, hop });
  netInput.value = '';
  hopInput.value = '';
  netInput.focus();
  renderTable();
});

document.getElementById('clearTableBtn').addEventListener('click', () => {
  ROUTERS[currentRouter].table = [];
  renderTable();
});

document.getElementById('loadModelBtn').addEventListener('click', () => {
  if (!confirm('ルーターA・B・Cすべてのテーブルをモデル解答で上書きします。よろしいですか?')) return;
  Object.keys(MODEL_ANSWER).forEach(id => {
    ROUTERS[id].table = MODEL_ANSWER[id].map(r => ({ ...r }));
  });
  renderTable();
});

/* ========================================================
   シミュレーション本体
   ======================================================== */

const sendBtn = document.getElementById('sendBtn');
const resetBtn = document.getElementById('resetBtn');

function setControlsDisabled(disabled) {
  sendBtn.disabled = disabled;
  resetBtn.disabled = disabled;
  tabButtons.forEach(b => b.disabled = disabled);
}

async function runSimulation() {
  setControlsDisabled(true);
  resetDiagram();
  clearLog();
  clearBanner();

  addLog(`PC1 (192.168.1.10) が既定ゲートウェイのルーターA (192.168.1.1) へパケットを送信しました。`);
  await animateMove('PC1', 'A');
  markEdgeDone('PC1', 'A');

  let current = 'A';
  let ttl = 6;
  const destNet = ipTo24Net(DEST_IP);

  while (true) {
    addLog(`ルーター${current}: ルーティングテーブルと照合中…`);
    await sleep(450);

    const table = ROUTERS[current].table;
    const entry = table.find(e => e.net === destNet) || table.find(e => e.net === '0.0.0.0/0');

    if (!entry) {
      addLog(`ルーター${current}: 宛先 ${destNet} に一致する経路が見つかりません。`);
      pulseNodeBad(current);
      showBanner('bad', '❌ 宛先が見つかりません。パケットは破棄されました。',
        `ヒント: ルーター${current}のテーブルに、宛先ネットワーク ${destNet} への経路を追加してみましょう。`);
      break;
    }

    const hop = entry.hop;
    const owner = IP_OWNER[hop];

    if (!owner) {
      addLog(`ルーター${current}: ネクストホップ ${hop} に該当する機器が見つかりません。`);
      pulseNodeBad(current);
      showBanner('bad', '❌ 無効なネクストホップです。パケットは破棄されました。',
        `ヒント: ルーター${current}のネクストホップ欄のIPアドレスが、図中のどのインターフェースとも一致していません。`);
      break;
    }

    if (owner.node === current) {
      if (owner.kind === 'lan') {
        if (owner.net === destNet) {
          addLog(`ルーター${current}: ${hop} は自身のLAN側インターフェースです。宛先ネットワークへ直接配送します。`);
          await animateMove(current, 'Server1');
          markEdgeDone(current, 'Server1');
          addLog('サーバー1 (192.168.4.10) にパケットが届きました。');
          showBanner('ok', '🎉 通信成功!パケットは無事サーバー1に届きました。');
        } else {
          addLog(`ルーター${current}: ${hop} 経由で配送しましたが、宛先ネットワークと一致しません。`);
          pulseNodeBad(current);
          showBanner('warn', '⚠️ 誤配送:違うネットワークに配送されてしまいました。',
            `ヒント: ルーター${current}のネクストホップの値を見直しましょう。`);
        }
      } else {
        addLog(`ルーター${current}: ネクストホップに自分自身のインターフェース(${hop})が指定されています。`);
        pulseNodeBad(current);
        showBanner('bad', '❌ 設定エラー:ネクストホップに自分自身のIPアドレスが指定されています。',
          `ヒント: ネクストホップには、隣接するルーター側のIPアドレスを指定しましょう。`);
      }
      break;
    }

    if (owner.kind === 'host') {
      if (owner.node === 'Server1') {
        await animateMove(current, 'Server1');
        markEdgeDone(current, 'Server1');
        addLog('サーバー1 (192.168.4.10) にパケットが届きました。');
        showBanner('ok', '🎉 通信成功!パケットは無事サーバー1に届きました。');
      } else {
        pulseNodeBad(current);
        showBanner('warn', '⚠️ 誤配送が発生しました。',
          'ヒント: ネクストホップには、ネットワークの入り口となるルーターのIPアドレスを指定しましょう。');
      }
      break;
    }

    // 別のルーターへ転送
    if (ttl <= 0) {
      addLog(`ルーター${current}: TTLが0になりました。パケットは破棄されます。`);
      pulseNodeBad(current);
      showBanner('loop', '🔁 ルーティングループが発生しました。TTL切れによりパケットは破棄されました。',
        '2台のルーターが互いに相手を指すよう設定されていないか、テーブルを見直しましょう。');
      break;
    }
    ttl--;
    addLog(`ルーター${current}: ネクストホップ ${hop} (ルーター${owner.node}方向) へ転送します。(残りTTL: ${ttl})`);
    await animateMove(current, owner.node);
    markEdgeDone(current, owner.node);
    current = owner.node;
  }

  setControlsDisabled(false);
}

sendBtn.addEventListener('click', runSimulation);

resetBtn.addEventListener('click', () => {
  resetDiagram();
  clearLog();
  clearBanner();
  addLog('送信元:PC1、宛先:サーバー1 で「パケット送信」を押してください。');
});
