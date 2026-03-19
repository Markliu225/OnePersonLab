const feedEl = document.getElementById("feed");
const paperEl = document.getElementById("paper");
const statusBadge = document.getElementById("statusBadge");

const ideaAgentsEl = document.getElementById("ideaAgents");
const codingAgentsEl = document.getElementById("codingAgents");
const paperAgentEl = document.getElementById("paperAgent");

const topicEl = document.getElementById("topic");
const iterationsEl = document.getElementById("iterations");
const discussionRoundsEl = document.getElementById("discussionRounds");
const executionTimeoutEl = document.getElementById("executionTimeout");

const startRunBtn = document.getElementById("startRun");
const clearFeedBtn = document.getElementById("clearFeed");
const addIdeaAgentBtn = document.getElementById("addIdeaAgent");
const addCodingAgentBtn = document.getElementById("addCodingAgent");
const resetIdeaAgentsBtn = document.getElementById("resetIdeaAgents");
const resetCodingAgentsBtn = document.getElementById("resetCodingAgents");

const messageNodes = new Map();
let ws = null;
let defaults = null;

function uid() {
  return Math.random().toString(36).slice(2, 8);
}

function escapeText(text) {
  return text == null ? "" : String(text);
}

function createEvent(meta, body = "", className = "") {
  const wrap = document.createElement("div");
  wrap.className = `event ${className}`.trim();

  const metaEl = document.createElement("div");
  metaEl.className = "meta";
  metaEl.textContent = meta;

  const pre = document.createElement("pre");
  pre.textContent = body;

  wrap.appendChild(metaEl);
  wrap.appendChild(pre);
  feedEl.appendChild(wrap);
  feedEl.scrollTop = feedEl.scrollHeight;
  return { wrap, pre };
}

function addAgentCard(container, agent, removable = true) {
  const card = document.createElement("div");
  card.className = "agent-card";
  card.dataset.agentCard = "1";

  const header = document.createElement("div");
  header.className = "agent-head";
  const title = document.createElement("strong");
  title.textContent = agent.name || `Agent ${uid()}`;
  header.appendChild(title);

  if (removable) {
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.textContent = "Remove";
    delBtn.addEventListener("click", () => card.remove());
    header.appendChild(delBtn);
  }

  card.appendChild(header);

  card.appendChild(inputField("Name", "name", agent.name || ""));

  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(inputField("Model", "model", agent.model || "gpt-5.3"));
  row.appendChild(inputField("Temperature", "temperature", agent.temperature ?? 0.7, "number", {
    min: "0",
    max: "2",
    step: "0.1",
  }));
  card.appendChild(row);

  const row2 = document.createElement("div");
  row2.className = "row";
  row2.appendChild(inputField("Max tokens", "max_tokens", agent.max_tokens ?? 900, "number", {
    min: "64",
    max: "4000",
    step: "1",
  }));
  row2.appendChild(document.createElement("div"));
  card.appendChild(row2);

  card.appendChild(textareaField("System prompt", "system_prompt", agent.system_prompt || ""));

  container.appendChild(card);
}

function inputField(label, key, value, type = "text", attrs = {}) {
  const wrap = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = label;
  const input = document.createElement("input");
  input.type = type;
  input.value = value;
  input.dataset.field = key;

  Object.entries(attrs).forEach(([k, v]) => {
    input.setAttribute(k, v);
  });

  wrap.appendChild(lab);
  wrap.appendChild(input);
  return wrap;
}

function textareaField(label, key, value) {
  const wrap = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = label;
  const t = document.createElement("textarea");
  t.value = value;
  t.dataset.field = key;
  wrap.appendChild(lab);
  wrap.appendChild(t);
  return wrap;
}

function cardToAgent(card) {
  const get = (k) => card.querySelector(`[data-field='${k}']`)?.value ?? "";
  return {
    name: get("name"),
    model: get("model"),
    temperature: Number(get("temperature")) || 0.7,
    max_tokens: Number(get("max_tokens")) || 900,
    system_prompt: get("system_prompt"),
  };
}

function gatherConfig() {
  const ideaAgents = [...ideaAgentsEl.querySelectorAll("[data-agent-card='1']")].map(cardToAgent);
  const codingAgents = [...codingAgentsEl.querySelectorAll("[data-agent-card='1']")].map(cardToAgent);
  const paperCard = paperAgentEl.querySelector("[data-agent-card='1']");

  if (!paperCard) {
    throw new Error("Paper agent is required");
  }

  if (ideaAgents.length < 1 || codingAgents.length < 1) {
    throw new Error("At least one idea agent and one coding agent are required");
  }

  return {
    topic: topicEl.value.trim(),
    iterations: Number(iterationsEl.value) || 2,
    discussion_rounds: Number(discussionRoundsEl.value) || 2,
    execution_timeout_sec: Number(executionTimeoutEl.value) || 60,
    idea_agents: ideaAgents,
    coding_agents: codingAgents,
    paper_agent: cardToAgent(paperCard),
  };
}

function renderFromDefaults(cfg) {
  topicEl.value = cfg.topic || "";
  iterationsEl.value = cfg.iterations || 2;
  discussionRoundsEl.value = cfg.discussion_rounds || 2;
  executionTimeoutEl.value = cfg.execution_timeout_sec || 60;

  ideaAgentsEl.innerHTML = "";
  codingAgentsEl.innerHTML = "";
  paperAgentEl.innerHTML = "";

  (cfg.idea_agents || []).forEach((agent) => addAgentCard(ideaAgentsEl, agent));
  (cfg.coding_agents || []).forEach((agent) => addAgentCard(codingAgentsEl, agent));
  addAgentCard(paperAgentEl, cfg.paper_agent || {}, false);
}

function setStatus(text) {
  statusBadge.textContent = text;
}

function handleEvent(payload) {
  const t = payload.type;

  if (t === "run_started") {
    setStatus(`Running · ${payload.run_id}`);
    createEvent("[run_started]", `Topic: ${payload.topic}\nIterations: ${payload.iterations}`);
    return;
  }

  if (t === "stage_started") {
    createEvent(
      `[stage_started] iter=${payload.iteration} stage=${payload.stage}`,
      escapeText(payload.message || "")
    );
    return;
  }

  if (t === "message_start") {
    const node = createEvent(
      `[${payload.stage}] ${payload.agent_name} (${payload.model})`,
      ""
    );
    messageNodes.set(payload.message_id, node.pre);
    return;
  }

  if (t === "token") {
    const pre = messageNodes.get(payload.message_id);
    if (pre) {
      pre.textContent += payload.delta;
      feedEl.scrollTop = feedEl.scrollHeight;
    }
    return;
  }

  if (t === "message_done") {
    const pre = messageNodes.get(payload.message_id);
    if (pre && !pre.textContent.trim()) {
      pre.textContent = payload.content || "";
    }
    return;
  }

  if (t === "execution_result") {
    const body = [
      `Command: ${payload.command}`,
      `Exit: ${payload.exit_code}  Timed out: ${payload.timed_out}`,
      `Script: ${payload.script_path}`,
      "--- STDOUT ---",
      payload.stdout || "",
      "--- STDERR ---",
      payload.stderr || "",
    ].join("\n");

    createEvent(
      `[execution] iter=${payload.iteration} ${payload.agent_name}`,
      body,
      "execution"
    );
    return;
  }

  if (t === "consensus_update") {
    createEvent(
      `[consensus] iter=${payload.iteration} round=${payload.round} reached=${payload.consensus_reached}`,
      payload.assessment || ""
    );
    return;
  }

  if (t === "iteration_conclusion") {
    createEvent(
      `[iteration_conclusion] iter=${payload.iteration} consensus=${payload.consensus}`,
      payload.conclusion || ""
    );
    return;
  }

  if (t === "coding_summary_done") {
    createEvent(`[coding_summary] iter=${payload.iteration}`, payload.summary || "");
    return;
  }

  if (t === "run_finished") {
    setStatus("Completed");
    paperEl.textContent = payload.paper || "";
    createEvent("[run_finished]", "Lab run completed.");
    return;
  }

  if (t === "error") {
    setStatus("Error");
    createEvent("[error]", payload.message || "Unknown error", "error");
    return;
  }

  createEvent(`[${t}]`, JSON.stringify(payload, null, 2));
}

async function startRun() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.close();
  }

  let config;
  try {
    config = gatherConfig();
    if (!config.topic) {
      throw new Error("Topic cannot be empty");
    }
  } catch (err) {
    createEvent("[validation_error]", err.message || String(err), "error");
    return;
  }

  setStatus("Connecting...");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  ws = new WebSocket(`${protocol}//${location.host}/ws/lab`);

  ws.addEventListener("open", () => {
    setStatus("Running");
    ws.send(JSON.stringify({ type: "start", config }));
  });

  ws.addEventListener("message", (event) => {
    try {
      const payload = JSON.parse(event.data);
      handleEvent(payload);
    } catch (err) {
      createEvent("[parse_error]", String(err), "error");
    }
  });

  ws.addEventListener("close", () => {
    if (statusBadge.textContent.startsWith("Running")) {
      setStatus("Disconnected");
    }
  });

  ws.addEventListener("error", () => {
    setStatus("Socket Error");
    createEvent("[socket_error]", "WebSocket error occurred.", "error");
  });
}

async function boot() {
  try {
    const res = await fetch("/api/default-config");
    defaults = await res.json();
    renderFromDefaults(defaults);
    setStatus("Idle");
  } catch (err) {
    createEvent("[boot_error]", `Failed to load defaults: ${String(err)}`, "error");
  }
}

startRunBtn.addEventListener("click", () => startRun());
clearFeedBtn.addEventListener("click", () => {
  feedEl.innerHTML = "";
  paperEl.textContent = "";
  messageNodes.clear();
});

addIdeaAgentBtn.addEventListener("click", () => {
  addAgentCard(ideaAgentsEl, {
    name: `Idea Agent ${uid()}`,
    model: "gpt-5.3",
    temperature: 0.7,
    max_tokens: 900,
    system_prompt: "You are a research debater. Contribute rigorously and concretely.",
  });
});

addCodingAgentBtn.addEventListener("click", () => {
  addAgentCard(codingAgentsEl, {
    name: `Coding Agent ${uid()}`,
    model: "gpt-5.3",
    temperature: 0.4,
    max_tokens: 900,
    system_prompt: "You validate hypotheses with executable Python experiments.",
  });
});

resetIdeaAgentsBtn.addEventListener("click", () => {
  if (!defaults) return;
  ideaAgentsEl.innerHTML = "";
  defaults.idea_agents.forEach((a) => addAgentCard(ideaAgentsEl, a));
});

resetCodingAgentsBtn.addEventListener("click", () => {
  if (!defaults) return;
  codingAgentsEl.innerHTML = "";
  defaults.coding_agents.forEach((a) => addAgentCard(codingAgentsEl, a));
});

boot();
