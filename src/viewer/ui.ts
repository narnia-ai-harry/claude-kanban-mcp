function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderViewerHtml(root: string): string {
  const safeRoot = escapeHtml(root);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Kanban Board Viewer</title>
  <style>
    :root {
      --bg: #f5f3ef;
      --panel: #fffaf2;
      --panel-alt: #f1ebdf;
      --text: #22221f;
      --muted: #646058;
      --accent: #1f6f5f;
      --danger: #8f1f2d;
      --border: #d9d1c1;
      --card: #ffffff;
      --shadow: 0 2px 8px rgba(34, 34, 31, 0.08);
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", "Noto Sans KR", sans-serif;
      color: var(--text);
      background:
        radial-gradient(circle at 10% 10%, #fef8ee 0, #f5f3ef 42%),
        radial-gradient(circle at 90% 20%, #eef8f1 0, #f5f3ef 48%);
    }

    .app {
      max-width: 1600px;
      margin: 0 auto;
      padding: 16px;
      display: grid;
      gap: 12px;
    }

    .topbar {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 14px;
      box-shadow: var(--shadow);
    }

    .topbar h1 {
      margin: 0 0 8px;
      font-size: 20px;
      letter-spacing: 0.3px;
    }

    .meta {
      color: var(--muted);
      font-size: 13px;
      margin-bottom: 12px;
      word-break: break-all;
    }

    .filters {
      display: grid;
      grid-template-columns: repeat(3, minmax(120px, 220px));
      gap: 10px;
      align-items: center;
    }

    label {
      display: grid;
      gap: 4px;
      font-size: 12px;
      color: var(--muted);
    }

    select {
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 7px 9px;
      font-size: 14px;
      background: white;
      color: var(--text);
    }

    .connection {
      font-size: 13px;
      margin-top: 10px;
      color: var(--muted);
    }

    .connection.error {
      color: var(--danger);
      font-weight: 600;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 2.2fr) minmax(280px, 1fr);
      gap: 12px;
    }

    .board-wrap {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 10px;
      overflow: auto;
    }

    .board {
      display: grid;
      grid-template-columns: repeat(6, minmax(220px, 1fr));
      gap: 10px;
      min-width: 1320px;
    }

    .column {
      background: var(--panel-alt);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 8px;
      display: grid;
      gap: 8px;
      align-content: start;
      min-height: 240px;
    }

    .column h2 {
      margin: 0;
      font-size: 13px;
      letter-spacing: 0.2px;
      color: #3d3a35;
    }

    .ticket {
      border: 1px solid var(--border);
      background: var(--card);
      border-radius: 8px;
      padding: 8px;
      cursor: pointer;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      font-size: 13px;
    }

    .ticket:hover {
      border-color: var(--accent);
    }

    .ticket.selected {
      border-color: var(--accent);
      box-shadow: 0 0 0 2px rgba(31, 111, 95, 0.12);
    }

    .ticket-id {
      font-weight: 700;
      margin-bottom: 4px;
    }

    .ticket-title {
      margin-bottom: 6px;
      color: #2b2a27;
      line-height: 1.3;
    }

    .ticket-meta {
      color: var(--muted);
      font-size: 12px;
    }

    .detail {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 12px;
      box-shadow: var(--shadow);
      padding: 12px;
    }

    .detail h3 {
      margin: 0 0 10px;
      font-size: 15px;
    }

    .detail pre {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      font-family: "Consolas", "Menlo", monospace;
      font-size: 12px;
      line-height: 1.45;
      color: #2c2b29;
    }

    .errors {
      background: #fff5f6;
      border: 1px solid #f0c7cd;
      border-radius: 12px;
      padding: 12px;
    }

    .errors h3 {
      margin: 0 0 8px;
      color: var(--danger);
      font-size: 14px;
    }

    .errors ul {
      margin: 0;
      padding-left: 18px;
      color: #5e2a31;
      font-size: 13px;
      line-height: 1.4;
    }

    .errors li { margin-bottom: 6px; }

    @media (max-width: 1100px) {
      .layout { grid-template-columns: 1fr; }
      .board { min-width: 100%; grid-template-columns: repeat(2, minmax(200px, 1fr)); }
    }

    @media (max-width: 700px) {
      .filters { grid-template-columns: 1fr; }
      .board { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="app">
    <section class="topbar">
      <h1>Kanban Board Viewer</h1>
      <div class="meta">root: ${safeRoot}</div>
      <div class="filters">
        <label>Status
          <select id="statusFilter"></select>
        </label>
        <label>Assignee
          <select id="assigneeFilter"></select>
        </label>
        <label>Priority
          <select id="priorityFilter"></select>
        </label>
      </div>
      <div id="connection" class="connection">Polling /api/board every 1 second...</div>
    </section>

    <section class="layout">
      <div class="board-wrap">
        <div id="board" class="board"></div>
      </div>
      <aside class="detail">
        <h3>Ticket Detail</h3>
        <pre id="detailText">Select a ticket card to inspect details.</pre>
      </aside>
    </section>

    <section class="errors">
      <h3>Invalid Tickets</h3>
      <ul id="errorList">
        <li>No invalid ticket files.</li>
      </ul>
    </section>
  </div>

  <script>
    const state = {
      snapshot: null,
      selectedTicketId: null,
      filters: {
        status: "ALL",
        assignee: "ALL",
        priority: "ALL"
      }
    };

    const statusFilter = document.getElementById("statusFilter");
    const assigneeFilter = document.getElementById("assigneeFilter");
    const priorityFilter = document.getElementById("priorityFilter");
    const boardEl = document.getElementById("board");
    const detailText = document.getElementById("detailText");
    const errorList = document.getElementById("errorList");
    const connection = document.getElementById("connection");

    function setOptions(selectEl, options, selectedValue) {
      selectEl.innerHTML = "";
      for (const option of options) {
        const el = document.createElement("option");
        el.value = option.value;
        el.textContent = option.label;
        if (option.value === selectedValue) el.selected = true;
        selectEl.appendChild(el);
      }
    }

    function setupFilters(snapshot) {
      setOptions(
        statusFilter,
        [{ value: "ALL", label: "ALL" }].concat(snapshot.statusOrder.map((s) => ({ value: s, label: s }))),
        state.filters.status
      );
      setOptions(
        assigneeFilter,
        [{ value: "ALL", label: "ALL" }].concat(snapshot.assignees.map((a) => ({ value: a, label: a }))),
        state.filters.assignee
      );
      setOptions(
        priorityFilter,
        [{ value: "ALL", label: "ALL" }].concat(snapshot.priorities.map((p) => ({ value: p, label: p }))),
        state.filters.priority
      );
    }

    function filterTickets(tickets) {
      return tickets.filter((ticket) => {
        if (state.filters.status !== "ALL" && ticket.status !== state.filters.status) return false;
        if (state.filters.priority !== "ALL" && ticket.priority !== state.filters.priority) return false;
        if (state.filters.assignee !== "ALL" && !ticket.assignees.includes(state.filters.assignee)) return false;
        return true;
      });
    }

    function renderBoard() {
      if (!state.snapshot) return;
      const snapshot = state.snapshot;
      const filtered = filterTickets(snapshot.tickets);
      const grouped = {};
      for (const status of snapshot.statusOrder) grouped[status] = [];
      for (const ticket of filtered) grouped[ticket.status].push(ticket);

      boardEl.innerHTML = "";
      for (const status of snapshot.statusOrder) {
        const column = document.createElement("section");
        column.className = "column";
        const title = document.createElement("h2");
        title.textContent = status + " (" + grouped[status].length + ")";
        column.appendChild(title);

        const items = grouped[status];
        if (items.length === 0) {
          const empty = document.createElement("div");
          empty.className = "ticket-meta";
          empty.textContent = "(empty)";
          column.appendChild(empty);
        } else {
          for (const ticket of items) {
            const card = document.createElement("article");
            card.className = "ticket" + (state.selectedTicketId === ticket.id ? " selected" : "");
            card.addEventListener("click", () => {
              state.selectedTicketId = ticket.id;
              renderBoard();
              renderDetail();
            });

            const id = document.createElement("div");
            id.className = "ticket-id";
            id.textContent = ticket.id + " [" + ticket.priority + "]";
            card.appendChild(id);

            const titleText = document.createElement("div");
            titleText.className = "ticket-title";
            titleText.textContent = ticket.title;
            card.appendChild(titleText);

            const meta = document.createElement("div");
            meta.className = "ticket-meta";
            const assignees = ticket.assignees.length > 0 ? ticket.assignees.join(", ") : "unassigned";
            meta.textContent = "assignees: " + assignees;
            card.appendChild(meta);

            column.appendChild(card);
          }
        }
        boardEl.appendChild(column);
      }
    }

    function renderDetail() {
      if (!state.snapshot) {
        detailText.textContent = "No data loaded.";
        return;
      }
      if (!state.selectedTicketId) {
        detailText.textContent = "Select a ticket card to inspect details.";
        return;
      }
      const ticket = state.snapshot.tickets.find((t) => t.id === state.selectedTicketId);
      if (!ticket) {
        detailText.textContent = "Selected ticket is no longer available.";
        return;
      }
      detailText.textContent = JSON.stringify(ticket, null, 2);
    }

    function renderErrors() {
      if (!state.snapshot) return;
      const invalid = state.snapshot.invalidTickets;
      errorList.innerHTML = "";
      if (invalid.length === 0) {
        const li = document.createElement("li");
        li.textContent = "No invalid ticket files.";
        errorList.appendChild(li);
        return;
      }
      for (const entry of invalid) {
        const li = document.createElement("li");
        li.textContent = entry.file + ": " + entry.errors.join(" | ");
        errorList.appendChild(li);
      }
    }

    async function refreshBoard() {
      try {
        const response = await fetch("/api/board", { cache: "no-store" });
        if (!response.ok) throw new Error("HTTP " + response.status);
        state.snapshot = await response.json();
        connection.textContent = "Last update: " + state.snapshot.generatedAt;
        connection.classList.remove("error");
        setupFilters(state.snapshot);
        renderBoard();
        renderDetail();
        renderErrors();
      } catch (error) {
        connection.textContent = "Failed to refresh board: " + error.message;
        connection.classList.add("error");
      }
    }

    statusFilter.addEventListener("change", (event) => {
      state.filters.status = event.target.value;
      renderBoard();
      renderDetail();
    });
    assigneeFilter.addEventListener("change", (event) => {
      state.filters.assignee = event.target.value;
      renderBoard();
      renderDetail();
    });
    priorityFilter.addEventListener("change", (event) => {
      state.filters.priority = event.target.value;
      renderBoard();
      renderDetail();
    });

    refreshBoard();
    setInterval(refreshBoard, 1000);
  </script>
</body>
</html>`;
}

