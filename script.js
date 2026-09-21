/* ==========================================================================
   ルーティング体験シミュレーター
   高校情報Ⅰ向け：ルーティングテーブルとパケット転送の仕組みを体験的に学ぶ教材
   ========================================================================== */

(function () {
  "use strict";

  /* ------------------------------------------------------------------ *
   * 1. トポロジ（ネットワーク構成）のデータ定義
   *    IPアドレスの代わりに記号（R1〜R4, A〜D, if1〜if4, L1〜L5）を使う
   * ------------------------------------------------------------------ */

  const ROUTER_IDS = ["R1", "R2", "R3", "R4"];
  const NET_IDS = ["A", "B", "C", "D"];

  // どのネットワークがどのルーターに直結しているか
  const NET_OWNER = { A: "R1", B: "R2", C: "R3", D: "R4" };
  const ROUTER_LOCAL_NET = { R1: "A", R2: "B", R3: "C", R4: "D" };

  // ルーター同士をつなぐ回線（リンク）。対角線 L5（R1-R3）が迂回路になる
  const LINKS = {
    L1: { a: "R1", b: "R2" },
    L2: { a: "R2", b: "R3" },
    L3: { a: "R3", b: "R4" },
    L4: { a: "R4", b: "R1" },
    L5: { a: "R1", b: "R3" },
  };

  // 各ルーターのインターフェース（差込口）定義
  // neighborType: 'network' | 'router', link: null(ローカル直結) or リンクID
  const INTERFACES = {
    R1: [
      { id: "if1", neighborType: "network", neighborId: "A", link: null },
      { id: "if2", neighborType: "router", neighborId: "R2", link: "L1" },
      { id: "if3", neighborType: "router", neighborId: "R4", link: "L4" },
      { id: "if4", neighborType: "router", neighborId: "R3", link: "L5" },
    ],
    R2: [
      { id: "if1", neighborType: "network", neighborId: "B", link: null },
      { id: "if2", neighborType: "router", neighborId: "R1", link: "L1" },
      { id: "if3", neighborType: "router", neighborId: "R3", link: "L2" },
    ],
    R3: [
      { id: "if1", neighborType: "network", neighborId: "C", link: null },
      { id: "if2", neighborType: "router", neighborId: "R2", link: "L2" },
      { id: "if3", neighborType: "router", neighborId: "R4", link: "L3" },
      { id: "if4", neighborType: "router", neighborId: "R1", link: "L5" },
    ],
    R4: [
      { id: "if1", neighborType: "network", neighborId: "D", link: null },
      { id: "if2", neighborType: "router", neighborId: "R3", link: "L3" },
      { id: "if3", neighborType: "router", neighborId: "R1", link: "L4" },
    ],
  };

  // 図の座標 (viewBox 0 0 640 460)
  const ROUTER_POS = {
    R1: { x: 210, y: 150 },
    R2: { x: 430, y: 150 },
    R3: { x: 430, y: 330 },
    R4: { x: 210, y: 330 },
  };
  const NET_POS = {
    A: { x: 90, y: 70 },
    B: { x: 550, y: 70 },
    C: { x: 550, y: 410 },
    D: { x: 90, y: 410 },
  };
  const ROUTER_R = 30;
  const NET_W = 84;
  const NET_H = 44;

  function nodePos(node) {
    if (node.type === "router") return ROUTER_POS[node.id];
    return NET_POS[node.id];
  }

  function netLabel(id) {
    return "ネットワーク" + id;
  }

  /* ------------------------------------------------------------------ *
   * 2. アプリの状態
   * ------------------------------------------------------------------ */

  let rowSeq = 1;
  function makeLockedRow(routerId) {
    const localNet = ROUTER_LOCAL_NET[routerId];
    return {
      id: "row0",
      dest: localNet,
      iface: "if1",
      gateway: "-",
      metric: "0",
      locked: true,
    };
  }

  const state = {
    linkState: { L1: true, L2: true, L3: true, L4: true, L5: true },
    tables: {},
    currentRouter: "R1",
  };
  ROUTER_IDS.forEach((r) => {
    state.tables[r] = [makeLockedRow(r)];
  });

  /* ------------------------------------------------------------------ *
   * 3. 経路計算（BFS）：現在の回線状態をもとに最短経路を求める
   * ------------------------------------------------------------------ */

  function buildRouterGraph() {
    // routerId -> [{neighbor, iface, link}]
    const graph = {};
    ROUTER_IDS.forEach((r) => (graph[r] = []));
    Object.keys(LINKS).forEach((linkId) => {
      if (!state.linkState[linkId]) return;
      const { a, b } = LINKS[linkId];
      const ifaceA = INTERFACES[a].find((i) => i.link === linkId);
      const ifaceB = INTERFACES[b].find((i) => i.link === linkId);
      graph[a].push({ neighbor: b, iface: ifaceA.id, link: linkId });
      graph[b].push({ neighbor: a, iface: ifaceB.id, link: linkId });
    });
    return graph;
  }

  function bfsFrom(startRouter, graph) {
    const dist = {};
    ROUTER_IDS.forEach((r) => (dist[r] = Infinity));
    dist[startRouter] = 0;
    const queue = [startRouter];
    while (queue.length) {
      const cur = queue.shift();
      graph[cur].forEach((edge) => {
        if (dist[edge.neighbor] === Infinity) {
          dist[edge.neighbor] = dist[cur] + 1;
          queue.push(edge.neighbor);
        }
      });
    }
    return dist;
  }

  function allDistances() {
    const graph = buildRouterGraph();
    const all = {};
    ROUTER_IDS.forEach((r) => (all[r] = bfsFrom(r, graph)));
    return all;
  }

  /* ------------------------------------------------------------------ *
   * 4. SVG図の生成
   * ------------------------------------------------------------------ */

  const SVG_NS = "http://www.w3.org/2000/svg";
  function svgEl(tag, attrs) {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => el.setAttribute(k, attrs[k]));
    }
    return el;
  }

  let diagramSvg = null;
  let packetDot = null;

  function buildDiagram() {
    const svg = svgEl("svg", {
      viewBox: "0 0 640 460",
      role: "img",
      "aria-label": "ネットワーク構成図",
    });

    // --- stub links (network - router) ---
    NET_IDS.forEach((netId) => {
      const routerId = NET_OWNER[netId];
      const p1 = NET_POS[netId];
      const p2 = ROUTER_POS[routerId];
      const line = svgEl("line", {
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        class: "stub-line",
        id: "stub-" + netId,
      });
      svg.appendChild(line);
    });

    // --- router-router links ---
    Object.keys(LINKS).forEach((linkId) => {
      const { a, b } = LINKS[linkId];
      const p1 = ROUTER_POS[a];
      const p2 = ROUTER_POS[b];
      const line = svgEl("line", {
        x1: p1.x,
        y1: p1.y,
        x2: p2.x,
        y2: p2.y,
        class: "link-line",
        id: "link-" + linkId,
      });
      svg.appendChild(line);

      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      const label = svgEl("text", {
        x: mx,
        y: my - 8,
        class: "link-label",
      });
      label.textContent = linkId;
      svg.appendChild(label);
    });

    // --- interface labels (on router-router links only, for clarity) ---
    ROUTER_IDS.forEach((routerId) => {
      const center = ROUTER_POS[routerId];
      INTERFACES[routerId].forEach((iface) => {
        const target =
          iface.neighborType === "router"
            ? ROUTER_POS[iface.neighborId]
            : NET_POS[iface.neighborId];
        const frac = 0.3;
        const lx = center.x + (target.x - center.x) * frac;
        const ly = center.y + (target.y - center.y) * frac;
        const txt = svgEl("text", {
          x: lx,
          y: ly,
          class: "iface-label",
        });
        txt.textContent = iface.id;
        svg.appendChild(txt);
      });
    });

    // --- network nodes ---
    NET_IDS.forEach((netId) => {
      const p = NET_POS[netId];
      const g = svgEl("g", { class: "node-network", id: "network-" + netId });
      const rect = svgEl("rect", {
        x: p.x - NET_W / 2,
        y: p.y - NET_H / 2,
        width: NET_W,
        height: NET_H,
      });
      const text = svgEl("text", { x: p.x, y: p.y });
      const tspan1 = svgEl("tspan", { x: p.x, dy: "-0.35em", class: "net-label-small" });
      tspan1.textContent = "ネットワーク";
      const tspan2 = svgEl("tspan", { x: p.x, dy: "1.15em", class: "net-label-big" });
      tspan2.textContent = netId;
      text.appendChild(tspan1);
      text.appendChild(tspan2);
      g.appendChild(rect);
      g.appendChild(text);
      svg.appendChild(g);
    });

    // --- router nodes ---
    ROUTER_IDS.forEach((routerId) => {
      const p = ROUTER_POS[routerId];
      const g = svgEl("g", { class: "node-router", id: "router-" + routerId });
      const circle = svgEl("circle", { cx: p.x, cy: p.y, r: ROUTER_R });
      const text = svgEl("text", { x: p.x, y: p.y });
      text.textContent = routerId;
      g.appendChild(circle);
      g.appendChild(text);
      svg.appendChild(g);
    });

    // --- packet dot (hidden by default) ---
    packetDot = svgEl("circle", {
      r: 9,
      class: "packet-dot hidden",
      id: "packet-dot",
      cx: 0,
      cy: 0,
    });
    svg.appendChild(packetDot);

    diagramSvg = svg;
    updateLinkVisuals();
  }

  function mountDiagram(containerId) {
    const mount = document.getElementById(containerId);
    if (mount && diagramSvg && diagramSvg.parentNode !== mount) {
      mount.appendChild(diagramSvg);
    }
  }

  function updateLinkVisuals() {
    Object.keys(LINKS).forEach((linkId) => {
      const line = document.getElementById("link-" + linkId);
      if (!line) return;
      line.classList.toggle("cut", !state.linkState[linkId]);
    });
  }

  function clearPathHighlights() {
    document.querySelectorAll(".link-line, .stub-line").forEach((el) => {
      el.classList.remove("active-path");
    });
    document.querySelectorAll(".node-router").forEach((el) => {
      el.classList.remove("fail", "active");
    });
  }

  function highlightActiveRouter(routerId) {
    document.querySelectorAll(".node-router").forEach((el) => {
      el.classList.toggle("active", el.id === "router-" + routerId);
    });
  }

  function findConnectingEdgeId(nodeA, nodeB) {
    if (nodeA.type === "router" && nodeB.type === "router") {
      const id = Object.keys(LINKS).find((linkId) => {
        const { a, b } = LINKS[linkId];
        return (a === nodeA.id && b === nodeB.id) || (a === nodeB.id && b === nodeA.id);
      });
      return id ? "link-" + id : null;
    }
    const netNode = nodeA.type === "network" ? nodeA : nodeB;
    return "stub-" + netNode.id;
  }

  /* ------------------------------------------------------------------ *
   * 5. タブ切り替え
   * ------------------------------------------------------------------ */

  function initTabs() {
    const btns = document.querySelectorAll(".tab-btn");
    btns.forEach((btn) => {
      btn.addEventListener("click", () => {
        btns.forEach((b) => {
          b.classList.remove("active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");

        const tabId = btn.dataset.tab;
        document.querySelectorAll(".tab-panel").forEach((p) => {
          p.classList.toggle("active", p.id === tabId);
        });

        const mountMap = { tab1: "mount-1", tab2: "mount-2", tab3: "mount-3", tab4: "mount-4" };
        mountDiagram(mountMap[tabId]);
        clearPathHighlights();
        if (tabId !== "tab3" && packetDot) packetDot.classList.add("hidden");
        if (tabId === "tab2") highlightActiveRouter(state.currentRouter);
      });
    });
  }

  /* ------------------------------------------------------------------ *
   * 6. ステップ2：ルーティングテーブル作成
   * ------------------------------------------------------------------ */

  function initRouterChips() {
    const wrap = document.getElementById("router-select-2");
    ROUTER_IDS.forEach((r) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "router-chip" + (r === state.currentRouter ? " active" : "");
      chip.textContent = r;
      chip.addEventListener("click", () => {
        state.currentRouter = r;
        document.querySelectorAll(".router-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        document.getElementById("table-heading").textContent =
          r + " の経路表（ルーティングテーブル）をつくろう";
        document.getElementById("grade-feedback").classList.remove("show");
        renderTable(r);
        highlightActiveRouter(r);
      });
      wrap.appendChild(chip);
    });
  }

  function usedDestinations(routerId, excludeRowId) {
    return state.tables[routerId]
      .filter((row) => row.id !== excludeRowId)
      .map((row) => row.dest)
      .filter(Boolean);
  }

  function renderTable(routerId) {
    const tbody = document.getElementById("route-table-body");
    tbody.innerHTML = "";
    const rows = state.tables[routerId];
    const localNet = ROUTER_LOCAL_NET[routerId];

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.dataset.rowId = row.id;

      if (row.locked) {
        tr.classList.add("locked-row");
        tr.innerHTML =
          "<td>" + netLabel(localNet) + "（直結）</td>" +
          "<td>if1</td><td>―</td><td>0</td><td></td>";
        tbody.appendChild(tr);
        return;
      }

      // 宛先ネットワーク
      const tdDest = document.createElement("td");
      const selDest = document.createElement("select");
      selDest.appendChild(new Option("― 選択 ―", ""));
      const used = usedDestinations(routerId, row.id);
      NET_IDS.filter((n) => n !== localNet).forEach((n) => {
        if (used.includes(n) && n !== row.dest) return;
        selDest.appendChild(new Option(netLabel(n), n, false, n === row.dest));
      });
      selDest.value = row.dest || "";
      selDest.addEventListener("change", () => {
        row.dest = selDest.value;
        renderTable(routerId);
      });
      tdDest.appendChild(selDest);
      tr.appendChild(tdDest);

      // インターフェース
      const tdIf = document.createElement("td");
      const selIf = document.createElement("select");
      selIf.appendChild(new Option("― 選択 ―", ""));
      INTERFACES[routerId]
        .filter((i) => i.neighborType === "router")
        .forEach((i) => {
          const desc = i.id + "（→" + i.neighborId + "）";
          selIf.appendChild(new Option(desc, i.id, false, i.id === row.iface));
        });
      selIf.value = row.iface || "";
      selIf.addEventListener("change", () => {
        row.iface = selIf.value;
        renderTable(routerId);
      });
      tdIf.appendChild(selIf);
      tr.appendChild(tdIf);

      // ゲートウェイ
      const tdGw = document.createElement("td");
      const selGw = document.createElement("select");
      selGw.appendChild(new Option("― 選択 ―", ""));
      ROUTER_IDS.filter((r) => r !== routerId).forEach((r) => {
        selGw.appendChild(new Option(r, r, false, r === row.gateway));
      });
      selGw.value = row.gateway || "";
      selGw.addEventListener("change", () => {
        row.gateway = selGw.value;
      });
      tdGw.appendChild(selGw);
      tr.appendChild(tdGw);

      // メトリック
      const tdMet = document.createElement("td");
      const selMet = document.createElement("select");
      selMet.appendChild(new Option("―", ""));
      [1, 2, 3, 4].forEach((m) => {
        selMet.appendChild(new Option(String(m), String(m), false, String(m) === row.metric));
      });
      selMet.value = row.metric || "";
      selMet.addEventListener("change", () => {
        row.metric = selMet.value;
      });
      tdMet.appendChild(selMet);
      tr.appendChild(tdMet);

      // 削除ボタン
      const tdDel = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.className = "remove-row-btn";
      delBtn.title = "この行を削除";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", () => {
        state.tables[routerId] = state.tables[routerId].filter((r) => r.id !== row.id);
        renderTable(routerId);
      });
      tdDel.appendChild(delBtn);
      tr.appendChild(tdDel);

      tbody.appendChild(tr);
    });

    refreshLiveWarnings(routerId);
  }

  // 採点前でも、切断中の回線を使っている行に警告を出す
  function refreshLiveWarnings(routerId) {
    const tbody = document.getElementById("route-table-body");
    Array.from(tbody.children).forEach((tr) => {
      if (tr.classList.contains("locked-row")) return;
      const rowId = tr.dataset.rowId;
      const row = state.tables[routerId].find((r) => r.id === rowId);
      if (!row || !row.iface) return;
      const ifaceObj = INTERFACES[routerId].find((i) => i.id === row.iface);
      if (ifaceObj && ifaceObj.link && !state.linkState[ifaceObj.link]) {
        tr.classList.add("row-warn");
        if (!tr.querySelector(".row-hint")) {
          const hint = document.createElement("span");
          hint.className = "row-hint";
          hint.textContent = "⚠️ 回線 " + ifaceObj.link + " は切断中です";
          tr.lastElementChild.appendChild(hint);
        }
      }
    });
  }

  function addRow() {
    const routerId = state.currentRouter;
    state.tables[routerId].push({
      id: "row" + rowSeq++,
      dest: "",
      iface: "",
      gateway: "",
      metric: "",
      locked: false,
    });
    renderTable(routerId);
  }

  function resetTable() {
    const routerId = state.currentRouter;
    state.tables[routerId] = [makeLockedRow(routerId)];
    document.getElementById("grade-feedback").classList.remove("show");
    renderTable(routerId);
  }

  function gradeTable() {
    const routerId = state.currentRouter;
    const rows = state.tables[routerId];
    const dists = allDistances();
    const tbody = document.getElementById("route-table-body");
    let correctCount = 0;
    let totalNonLocal = 0;
    const problems = [];
    const seenDest = new Set();

    Array.from(tbody.children).forEach((tr) => {
      if (tr.classList.contains("locked-row")) return;
      const rowId = tr.dataset.rowId;
      const row = rows.find((r) => r.id === rowId);
      tr.classList.remove("row-correct", "row-wrong", "row-warn");
      totalNonLocal++;

      if (!row.dest || !row.iface || !row.gateway || row.metric === "") {
        tr.classList.add("row-wrong");
        problems.push("空欄がある行があります。すべてのプルダウンを選びましょう。");
        return;
      }
      if (seenDest.has(row.dest)) {
        tr.classList.add("row-wrong");
        problems.push(netLabel(row.dest) + " 宛の行が重複しています。");
        return;
      }
      seenDest.add(row.dest);

      const ifaceObj = INTERFACES[routerId].find((i) => i.id === row.iface);
      const linkUp = ifaceObj.link ? state.linkState[ifaceObj.link] : true;
      if (!linkUp) {
        tr.classList.add("row-warn");
        problems.push(
          netLabel(row.dest) + " 宛の行は、切断中の回線 " + ifaceObj.link + " を使っています。迂回路を探しましょう。"
        );
        return;
      }

      const destRouter = NET_OWNER[row.dest];
      const correctMetric = dists[routerId][destRouter];
      const neighbor = ifaceObj.neighborId;
      const isShortestHop =
        dists[neighbor] && dists[neighbor][destRouter] === correctMetric - 1;
      const gatewayOk = row.gateway === neighbor;
      const metricOk = Number(row.metric) === correctMetric;

      if (isShortestHop && gatewayOk && metricOk) {
        tr.classList.add("row-correct");
        correctCount++;
      } else {
        tr.classList.add("row-wrong");
        let msg = netLabel(row.dest) + " 宛の行が正しくありません。";
        if (correctMetric === Infinity) {
          msg = netLabel(row.dest) + " は現在どの回線を使っても到達できません（回線切断の影響）。";
        } else if (!metricOk) {
          msg += "最短のメトリックは " + correctMetric + " です。";
        } else if (!gatewayOk || !isShortestHop) {
          msg += "そのインターフェース／ゲートウェイの組み合わせでは最短経路になりません。";
        }
        problems.push(msg);
      }
    });

    // 未設定の宛先ネットワークをチェック
    const localNet = ROUTER_LOCAL_NET[routerId];
    const missing = NET_IDS.filter((n) => n !== localNet && !seenDest.has(n));
    missing.forEach((n) => {
      if (dists[routerId][NET_OWNER[n]] !== Infinity) {
        problems.push(netLabel(n) + " への行がまだありません。");
      }
    });

    const feedback = document.getElementById("grade-feedback");
    feedback.classList.add("show");
    if (problems.length === 0 && missing.length === 0 && totalNonLocal === correctCount) {
      feedback.classList.remove("bad");
      feedback.classList.add("ok");
      feedback.innerHTML = "🎉 完璧です！" + routerId + " の経路表はすべて正しく設定されています。";
    } else {
      feedback.classList.remove("ok");
      feedback.classList.add("bad");
      feedback.innerHTML =
        "正解：" + correctCount + " / " + (totalNonLocal + missing.length) + " 件<br>" +
        problems.map((p) => "・" + p).join("<br>");
    }
  }

  /* ------------------------------------------------------------------ *
   * 7. ステップ3：パケット送信シミュレーション
   * ------------------------------------------------------------------ */

  function initSimSelectors() {
    const src = document.getElementById("sim-source");
    const dst = document.getElementById("sim-dest");
    NET_IDS.forEach((n) => {
      src.appendChild(new Option(netLabel(n), n));
      dst.appendChild(new Option(netLabel(n), n));
    });
    src.value = "A";
    dst.value = "C";
  }

  function simulate(sourceNet, destNet) {
    const steps = [];
    const path = [{ type: "network", id: sourceNet }];

    if (sourceNet === destNet) {
      path.push({ type: "network", id: destNet });
      steps.push({
        text: "送信元と宛先が同じネットワークです。ルーターを経由せずに届きます。",
        status: "success",
        node: { type: "network", id: destNet },
      });
      return { success: true, path, steps };
    }

    const startRouter = NET_OWNER[sourceNet];
    const destRouter = NET_OWNER[destNet];
    path.push({ type: "router", id: startRouter });
    steps.push({
      text: "パソコンは " + netLabel(sourceNet) + " からルーター " + startRouter + " へパケットを送り出しました。",
      status: "ok",
      node: { type: "router", id: startRouter },
    });

    let current = startRouter;
    const visited = new Set([startRouter]);
    const maxHops = 8;

    for (let i = 0; i < maxHops; i++) {
      if (current === destRouter) {
        path.push({ type: "network", id: destNet });
        steps.push({
          text: "ルーター " + current + " は " + netLabel(destNet) + " に直結しています。パケットが宛先に届きました！",
          status: "success",
          node: { type: "network", id: destNet },
        });
        return { success: true, path, steps };
      }

      const table = state.tables[current];
      const row = table.find(
        (r) => r.dest === destNet && r.iface && r.gateway !== "" && r.metric !== ""
      );
      if (!row) {
        steps.push({
          text: "ルーター " + current + " の経路表に " + netLabel(destNet) + " への行がありません。パケットは破棄されました。",
          status: "fail",
          node: { type: "router", id: current },
        });
        return { success: false, path, steps };
      }

      const ifaceObj = INTERFACES[current].find((i) => i.id === row.iface);
      if (!ifaceObj || ifaceObj.neighborType !== "router") {
        steps.push({
          text: "ルーター " + current + " の設定が不正です。パケットは破棄されました。",
          status: "fail",
          node: { type: "router", id: current },
        });
        return { success: false, path, steps };
      }

      if (ifaceObj.link && !state.linkState[ifaceObj.link]) {
        steps.push({
          text:
            "ルーター " + current + " はインターフェース " + row.iface + " から送信しようとしましたが、回線 " +
            ifaceObj.link + " は切断されています。パケットは届きません。",
          status: "fail",
          node: { type: "router", id: current },
        });
        return { success: false, path, steps };
      }

      const next = ifaceObj.neighborId;
      steps.push({
        text:
          "ルーター " + current + "：宛先 " + netLabel(destNet) + " の行を確認 → インターフェース " +
          row.iface + "（→ルーター " + next + "）へ送出。",
        status: "ok",
        node: { type: "router", id: next },
      });
      path.push({ type: "router", id: next });

      if (visited.has(next)) {
        steps.push({
          text: "ルーター " + next + " に再び到着しました。経路がループしています！パケットは破棄されます。",
          status: "fail",
          node: { type: "router", id: next },
        });
        return { success: false, path, steps };
      }
      visited.add(next);
      current = next;
    }

    steps.push({ text: "ホップ数の上限に達しました。パケットは破棄されました。", status: "fail" });
    return { success: false, path, steps };
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function moveDotTo(pos, duration) {
    return new Promise((resolve) => {
      const startX = parseFloat(packetDot.getAttribute("cx")) || pos.x;
      const startY = parseFloat(packetDot.getAttribute("cy")) || pos.y;
      const startTime = performance.now();
      packetDot.classList.remove("hidden");

      function frame(now) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        const x = startX + (pos.x - startX) * ease;
        const y = startY + (pos.y - startY) * ease;
        packetDot.setAttribute("cx", x);
        packetDot.setAttribute("cy", y);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  function appendLogLine(text, status) {
    const log = document.getElementById("sim-log");
    const li = document.createElement("li");
    li.textContent = text;
    if (status === "fail") li.classList.add("log-fail");
    else if (status === "success") li.classList.add("log-success");
    else li.classList.add("log-ok");
    log.appendChild(li);
    log.scrollTop = log.scrollHeight;
  }

  let simRunning = false;

  async function runSimulation() {
    if (simRunning) return;
    simRunning = true;
    const sendBtn = document.getElementById("sim-send-btn");
    sendBtn.disabled = true;

    const sourceNet = document.getElementById("sim-source").value;
    const destNet = document.getElementById("sim-dest").value;

    document.getElementById("sim-log").innerHTML = "";
    clearPathHighlights();
    packetDot.classList.remove("hidden");
    const startPos = nodePos({ type: "network", id: sourceNet });
    packetDot.setAttribute("cx", startPos.x);
    packetDot.setAttribute("cy", startPos.y);

    const result = simulate(sourceNet, destNet);

    let lastNode = { type: "network", id: sourceNet };
    for (const step of result.steps) {
      if (step.node) {
        const edgeId = findConnectingEdgeId(lastNode, step.node);
        if (edgeId) {
          const el = document.getElementById(edgeId);
          if (el) el.classList.add("active-path");
        }
        await moveDotTo(nodePos(step.node), 650);
        lastNode = step.node;
      }
      appendLogLine(step.text, step.status);
      await delay(300);
    }

    if (result.success) {
      const netEl = document.getElementById("network-" + destNet);
      if (netEl) {
        netEl.querySelector("rect").style.filter = "drop-shadow(0 0 8px #10b981)";
        setTimeout(() => {
          if (netEl.querySelector("rect")) netEl.querySelector("rect").style.filter = "";
        }, 2000);
      }
    } else if (lastNode.type === "router") {
      const rEl = document.getElementById("router-" + lastNode.id);
      if (rEl) rEl.classList.add("fail");
    }

    sendBtn.disabled = false;
    simRunning = false;
  }

  /* ------------------------------------------------------------------ *
   * 8. ステップ4：回線障害シミュレーション
   * ------------------------------------------------------------------ */

  function initLinkToggles() {
    const wrap = document.getElementById("link-toggles");
    Object.keys(LINKS).forEach((linkId) => {
      const { a, b } = LINKS[linkId];
      const row = document.createElement("div");
      row.className = "link-toggle-row";

      const label = document.createElement("div");
      label.innerHTML =
        "<strong>" + linkId + "</strong>：ルーター " + a + " ⇔ ルーター " + b +
        '<span class="link-toggle-desc"><br>この回線が切れると ' + a + " と " + b + " の直接のやり取りができなくなります</span>";

      const switchLabel = document.createElement("label");
      switchLabel.className = "switch";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = state.linkState[linkId];
      input.addEventListener("change", () => {
        state.linkState[linkId] = input.checked;
        updateLinkVisuals();
        renderTable(state.currentRouter);
      });
      const slider = document.createElement("span");
      slider.className = "slider";
      switchLabel.appendChild(input);
      switchLabel.appendChild(slider);

      row.appendChild(label);
      row.appendChild(switchLabel);
      wrap.appendChild(row);
    });
  }

  /* ------------------------------------------------------------------ *
   * 9. 初期化
   * ------------------------------------------------------------------ */

  document.addEventListener("DOMContentLoaded", () => {
    buildDiagram();
    mountDiagram("mount-1");

    initTabs();
    initRouterChips();
    renderTable(state.currentRouter);

    document.getElementById("add-row-btn").addEventListener("click", addRow);
    document.getElementById("grade-btn").addEventListener("click", gradeTable);
    document.getElementById("reset-table-btn").addEventListener("click", resetTable);

    initSimSelectors();
    document.getElementById("sim-send-btn").addEventListener("click", runSimulation);

    initLinkToggles();
  });
})();
