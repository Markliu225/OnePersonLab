const state = {
  currentRunId: null,
  pollingTimer: null,
  availableProviders: ["mock"]
};

const elements = {
  providerBadge: document.querySelector("#provider-badge"),
  providerSelect: document.querySelector("#provider"),
  agents: document.querySelector("#agents"),
  runs: document.querySelector("#runs"),
  missionForm: document.querySelector("#mission-form"),
  submitButton: document.querySelector("#submit-button"),
  emptyState: document.querySelector("#empty-state"),
  runDetail: document.querySelector("#run-detail"),
  detailObjective: document.querySelector("#detail-objective"),
  detailStatus: document.querySelector("#detail-status"),
  detailNorthStar: document.querySelector("#detail-north-star"),
  detailCriteria: document.querySelector("#detail-criteria"),
  detailBrief: document.querySelector("#detail-brief"),
  detailEvidence: document.querySelector("#detail-evidence"),
  detailScoreboard: document.querySelector("#detail-scoreboard"),
  detailExperiments: document.querySelector("#detail-experiments"),
  detailTimeline: document.querySelector("#detail-timeline"),
  detailArtifacts: document.querySelector("#detail-artifacts"),
  detailReport: document.querySelector("#detail-report"),
  detailRecommendationName: document.querySelector("#detail-recommendation-name"),
  detailRecommendationRationale: document.querySelector(
    "#detail-recommendation-rationale"
  ),
  detailDecision: document.querySelector("#detail-decision"),
  reportLink: document.querySelector("#report-link")
};

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Request failed");
  }

  return data;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function prettyTime(value) {
  return new Date(value).toLocaleString();
}

function renderProviders(meta) {
  state.availableProviders = meta.availableProviders;
  elements.providerBadge.textContent = meta.defaultProvider;
  elements.providerSelect.innerHTML = "";

  meta.availableProviders.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider;
    option.textContent = provider;
    if (provider === meta.defaultProvider) {
      option.selected = true;
    }
    elements.providerSelect.appendChild(option);
  });
}

function renderAgents(agents) {
  elements.agents.innerHTML = "";

  agents.forEach((agent) => {
    const card = document.createElement("article");
    card.className = "agent-card";
    card.innerHTML = `
      <p class="agent-role">${escapeHtml(agent.role)}</p>
      <h3>${escapeHtml(agent.name)}</h3>
      <p class="agent-specialty">${escapeHtml(agent.specialty)}</p>
      <ul>${agent.responsibilities
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join("")}</ul>
    `;
    elements.agents.appendChild(card);
  });
}

function renderRuns(runs) {
  elements.runs.innerHTML = "";

  if (runs.length === 0) {
    elements.runs.innerHTML = `<p class="placeholder">还没有运行记录。</p>`;
    return;
  }

  runs.forEach((run) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "run-item";
    const recommendation = run.finalRecommendation?.recommendedIdeaName
      ? `<span class="run-recommendation">${escapeHtml(
          run.finalRecommendation.recommendedIdeaName
        )}</span>`
      : `<span class="run-recommendation muted">No recommendation yet</span>`;

    button.innerHTML = `
      <span class="run-item-top">
        <strong>${escapeHtml(run.objective)}</strong>
        <span class="run-status ${escapeHtml(run.status)}">${escapeHtml(run.status)}</span>
      </span>
      ${recommendation}
      <span class="run-meta">${escapeHtml(prettyTime(run.createdAt))}</span>
    `;
    button.addEventListener("click", () => {
      loadRun(run.id);
    });
    elements.runs.appendChild(button);
  });
}

function findArtifact(run, kind) {
  return run.artifacts.find((artifact) => artifact.kind === kind);
}

function renderBrief(run) {
  const brief = run.brief;
  const items = [
    ["Problem", brief.problem],
    ["Target user", brief.targetUser],
    ["Market context", brief.marketContext],
    ["Strengths", brief.strengths],
    ["Assets", brief.assets],
    ["Constraints", brief.constraints],
    ["Business goal", brief.businessGoal],
    ["Validation goal", brief.validationGoal]
  ];

  elements.detailBrief.innerHTML = items
    .map(
      ([label, value]) => `
        <div class="brief-item">
          <strong>${escapeHtml(label)}</strong>
          <p>${escapeHtml(value || "Not specified")}</p>
        </div>
      `
    )
    .join("");
}

function renderEvidence(run) {
  if (!run.evidence.length) {
    elements.detailEvidence.innerHTML =
      `<p class="placeholder">这次运行没有提供外部证据 URL。</p>`;
    return;
  }

  elements.detailEvidence.innerHTML = run.evidence
    .map(
      (item) => `
        <article class="evidence-item">
          <div class="run-item-top">
            <strong>${escapeHtml(item.title || item.url)}</strong>
            <span class="run-status ${escapeHtml(item.status)}">${escapeHtml(item.status)}</span>
          </div>
          <p>${escapeHtml(item.summary || item.error || "No summary available")}</p>
          <a href="${escapeHtml(item.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.url)}</a>
        </article>
      `
    )
    .join("");
}

function renderRecommendation(run) {
  const recommendation = run.finalRecommendation;

  if (!recommendation) {
    elements.detailRecommendationName.textContent = "等待最终 recommendation";
    elements.detailRecommendationRationale.textContent =
      "reporter 还没有完成，结果出来后这里会直接给出推荐方向。";
    elements.detailDecision.textContent = "pending";
    elements.detailDecision.className = "decision-pill pending";
    elements.reportLink.classList.add("hidden");
    elements.reportLink.removeAttribute("href");
    return;
  }

  elements.detailRecommendationName.textContent =
    recommendation.recommendedIdeaName || "No clear winner";
  elements.detailRecommendationRationale.textContent = recommendation.rationale;
  elements.detailDecision.textContent = recommendation.decision;
  elements.detailDecision.className = `decision-pill ${recommendation.decision}`;
  elements.reportLink.href = `/api/runs/${run.id}/report.md`;
  elements.reportLink.classList.remove("hidden");
}

function renderScoreboard(run) {
  const ideasArtifact = findArtifact(run, "ideas");
  const validationArtifact = findArtifact(run, "validation");
  const ideas = ideasArtifact?.data?.ideas || [];
  const validations = [...(validationArtifact?.data?.validations || [])].sort(
    (left, right) => right.totalScore - left.totalScore
  );

  if (!validations.length) {
    elements.detailScoreboard.innerHTML =
      `<p class="placeholder">validator 还没有产出评分结果。</p>`;
    return;
  }

  elements.detailScoreboard.innerHTML = validations
    .map((item) => {
      const idea = ideas.find((candidate) => candidate.id === item.ideaId);
      return `
        <article class="score-card">
          <div class="run-item-top">
            <strong>${escapeHtml(item.ideaName)}</strong>
            <span class="score-total">${escapeHtml(item.totalScore)}/100</span>
          </div>
          <p class="score-summary">${escapeHtml(item.summary)}</p>
          <p class="muted">Verdict: ${escapeHtml(item.verdict)} · Confidence: ${escapeHtml(
            item.confidence
          )}/100 · Evidence: ${escapeHtml(item.evidenceStrength)}</p>
          <p class="idea-one-liner">${escapeHtml(idea?.oneLiner || "")}</p>
          <div class="breakdown-list">
            ${item.breakdown
              .map(
                (score) => `
                  <div class="breakdown-item">
                    <span>${escapeHtml(score.criterion)}</span>
                    <strong>${escapeHtml(score.score)}/10</strong>
                  </div>
                `
              )
              .join("")}
          </div>
        </article>
      `;
    })
    .join("");
}

function renderExperiments(run) {
  const experiments = findArtifact(run, "experiments")?.data?.experiments || [];

  if (!experiments.length) {
    elements.detailExperiments.innerHTML =
      `<p class="placeholder">experimenter 还没有给出验证动作。</p>`;
    return;
  }

  elements.detailExperiments.innerHTML = experiments
    .map(
      (item) => `
        <article class="experiment-item">
          <div class="run-item-top">
            <strong>${escapeHtml(item.ideaName)}</strong>
            <span class="run-status ${escapeHtml(item.priority)}">${escapeHtml(item.priority)}</span>
          </div>
          <h4>${escapeHtml(item.experiment)}</h4>
          <p><strong>Hypothesis:</strong> ${escapeHtml(item.hypothesis)}</p>
          <p><strong>Action:</strong> ${escapeHtml(item.action)}</p>
          <p><strong>Success:</strong> ${escapeHtml(item.successSignal)}</p>
          <p><strong>Kill:</strong> ${escapeHtml(item.killSignal)}</p>
          <p class="muted">Cost: ${escapeHtml(item.cost)} · Time: ${escapeHtml(item.time)}</p>
        </article>
      `
    )
    .join("");
}

function renderTimeline(run) {
  elements.detailTimeline.innerHTML = [...run.timeline]
    .reverse()
    .map(
      (event) => `
        <div class="timeline-item">
          <strong>${escapeHtml(event.type)}</strong>
          <p>${escapeHtml(event.message)}</p>
          <small>${escapeHtml(prettyTime(event.timestamp))}</small>
        </div>
      `
    )
    .join("");
}

function renderArtifacts(run) {
  elements.detailArtifacts.innerHTML = run.artifacts
    .map(
      (artifact) => `
        <article class="artifact-item">
          <div class="artifact-top">
            <strong>${escapeHtml(artifact.title)}</strong>
            <span>${escapeHtml(artifact.kind)}</span>
          </div>
          <p>${escapeHtml(artifact.summary)}</p>
          <details>
            <summary>查看全文</summary>
            <pre>${escapeHtml(artifact.content)}</pre>
          </details>
        </article>
      `
    )
    .join("");
}

function renderRun(run) {
  state.currentRunId = run.id;
  elements.emptyState.classList.add("hidden");
  elements.runDetail.classList.remove("hidden");
  elements.detailObjective.textContent = run.objective;
  elements.detailStatus.textContent = run.status;
  elements.detailStatus.className = `status-pill ${run.status}`;
  elements.detailNorthStar.textContent = run.northStar || "planner 还在生成决策标准...";

  elements.detailCriteria.innerHTML = "";
  run.successCriteria.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = item;
    elements.detailCriteria.appendChild(li);
  });

  renderRecommendation(run);
  renderBrief(run);
  renderEvidence(run);
  renderScoreboard(run);
  renderExperiments(run);
  renderTimeline(run);
  renderArtifacts(run);
  elements.detailReport.textContent = findArtifact(run, "report")?.content || "reporter 还没有生成最终报告。";

  if (run.status === "queued" || run.status === "running") {
    startPolling(run.id);
  } else {
    stopPolling();
  }
}

async function refreshRuns() {
  const data = await requestJson("/api/runs");
  renderRuns(data.runs);
}

async function loadRun(runId) {
  const data = await requestJson(`/api/runs/${runId}`);
  renderRun(data.run);
  await refreshRuns();
}

function stopPolling() {
  if (state.pollingTimer) {
    clearInterval(state.pollingTimer);
    state.pollingTimer = null;
  }
}

function startPolling(runId) {
  stopPolling();
  state.pollingTimer = setInterval(() => {
    loadRun(runId).catch((error) => {
      console.error(error);
      stopPolling();
    });
  }, 2000);
}

elements.missionForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const payload = {
    title: document.querySelector("#title").value.trim(),
    problem: document.querySelector("#problem").value.trim(),
    targetUser: document.querySelector("#targetUser").value.trim(),
    marketContext: document.querySelector("#marketContext").value.trim(),
    strengths: document.querySelector("#strengths").value.trim(),
    assets: document.querySelector("#assets").value.trim(),
    constraints: document.querySelector("#constraints").value.trim(),
    businessGoal: document.querySelector("#businessGoal").value.trim(),
    validationGoal: document.querySelector("#validationGoal").value.trim(),
    notes: document.querySelector("#notes").value.trim(),
    sourceUrls: document
      .querySelector("#sourceUrls")
      .value.split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean),
    providerMode: elements.providerSelect.value
  };

  if (!payload.problem || !payload.targetUser) {
    return;
  }

  elements.submitButton.disabled = true;
  elements.submitButton.textContent = "Running...";

  try {
    const data = await requestJson("/api/runs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
    await refreshRuns();
    await loadRun(data.runId);
  } catch (error) {
    alert(error.message);
  } finally {
    elements.submitButton.disabled = false;
    elements.submitButton.textContent = "Run Idea Lab";
  }
});

async function bootstrap() {
  const [meta, agents] = await Promise.all([
    requestJson("/api/meta"),
    requestJson("/api/agents")
  ]);

  renderProviders(meta);
  renderAgents(agents.agents);
  await refreshRuns();
}

bootstrap().catch((error) => {
  console.error(error);
});
