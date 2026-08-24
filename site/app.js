import { renderCompilerComparison } from "./compiler-comparison.js"

const data = await fetch("./results.json?v=cpu2").then((response) => {
  if (!response.ok) throw new Error(`Unable to load results: ${response.status}`)
  return response.json()
})

const demoGrid = document.querySelector("#demo-grid")
const resultsBody = document.querySelector("#results-body")
const perfBody = document.querySelector("#perf-body")
const formatter = new Intl.NumberFormat("en-US")

function pct(value) {
  if (value == null || Number.isNaN(value)) return "—"
  const sign = value >= 0 ? "−" : "+"
  return `${sign}${Math.abs(value).toFixed(1)}%`
}

function ms(value) {
  if (value == null || Number.isNaN(value)) return "—"
  return `${value.toFixed(2)} ms`
}

function times(value) {
  if (value == null || Number.isNaN(value)) return "—"
  return `${value.toFixed(2)}×`
}

const brotli = data.metrics.brotli
const gzip = data.metrics.gzip
const raw = data.metrics.raw

const jfb = data.jsFrameworkBenchmark
const jfbBrotli = jfb
  ? (1 - jfb.sizes.solidlil.brotli / jfb.sizes.solid.brotli) * 100
  : brotli.weightedReduction
const jfbGzip = jfb
  ? (1 - jfb.sizes.solidlil.gzip / jfb.sizes.solid.gzip) * 100
  : gzip.weightedReduction
const jfbRaw = jfb
  ? (1 - jfb.sizes.solidlil.raw / jfb.sizes.solid.raw) * 100
  : raw.weightedReduction
document.querySelector("#score-jfb-main").textContent = pct(jfbBrotli)
document.querySelector("#score-jfb-bytes").textContent = jfb
  ? `${formatter.format(jfb.sizes.solid.brotli)} B → ${formatter.format(jfb.sizes.solidlil.brotli)} B vs Solid 2.0`
  : "official keyed table vs @itslil/solidjs"
document.querySelector("#score-jfb-gzip").textContent = pct(jfbGzip)
document.querySelector("#score-jfb-raw").textContent = pct(jfbRaw)
const select = jfb?.cpu?.find((row) => row.id === "04_select1k")
const selectSameApp = jfb?.selectSameApp
  ?? (select != null && select.ratio >= 0.7 && select.ratio <= 1.4)
document.querySelector("#score-jfb-select").textContent = select
  ? times(select.ratio)
  : "—"
const selectLabel = document.querySelector("#score-jfb-select")?.parentElement?.querySelector("span")
if (selectLabel) {
  selectLabel.textContent = selectSameApp ? "select · same app" : "select · not same app"
}

const createRatio = jfb?.geomean?.cpuSameApp
  ?? jfb?.geomean?.cpu
  ?? data.performance?.browserMs?.ratio?.create1k
document.querySelector("#score-jfb-cpu").textContent = createRatio == null
  ? (data.performance?.browserMs?.skipped ? "node only" : "—")
  : `${createRatio.toFixed(2)}×`

function renderDemos(filter = "all") {
  const examples = filter === "all"
    ? data.examples
    : data.examples.filter((example) => example.group === filter)

  demoGrid.innerHTML = examples.map((example, index) => `
    <article class="demo-card" style="--order:${index}">
      <header>
        <div>
          <span class="case-number">${String(data.examples.indexOf(example) + 1).padStart(2, "0")}</span>
          <h3>${example.title}</h3>
        </div>
        <strong class="saving">${pct(example.reduction.brotli)}</strong>
      </header>
      <div class="demo-frame-wrap">
        <iframe
          src="./apps/${encodeURIComponent(example.id)}/compare.html"
          title="${example.title} Solid 2.0 vs solidlil"
          loading="lazy"
        ></iframe>
      </div>
      <footer>
        <span>raw ${formatter.format(example.solidlil.raw)} · gzip ${formatter.format(example.solidlil.gzip)} · brotli ${formatter.format(example.solidlil.brotli)}</span>
        <div>
          <a href="./apps/${encodeURIComponent(example.id)}/solid.html">Solid</a>
          <a href="./apps/${encodeURIComponent(example.id)}/solidlil.html">solidlil</a>
          <button class="replay" type="button" aria-label="Replay ${example.title}">replay ↻</button>
        </div>
      </footer>
    </article>
  `).join("")
}

function renderResults() {
  const lead = []
  if (jfb?.sizes) {
    const jfbReduction = (1 - jfb.sizes.solidlil.brotli / jfb.sizes.solid.brotli) * 100
    lead.push(`
    <tr>
      <th scope="row">JFB keyed table</th>
      <td>${formatter.format(jfb.sizes.solid.raw)}</td>
      <td>${formatter.format(jfb.sizes.solidlil.raw)}</td>
      <td>${formatter.format(jfb.sizes.solid.gzip)}</td>
      <td>${formatter.format(jfb.sizes.solidlil.gzip)}</td>
      <td>${formatter.format(jfb.sizes.solid.brotli)}</td>
      <td>${formatter.format(jfb.sizes.solidlil.brotli)}</td>
      <td><strong>${pct(jfbReduction)}</strong></td>
    </tr>
  `)
  }
  const rows = lead.concat(data.examples.map((example) => `
    <tr>
      <th scope="row">${example.title}</th>
      <td>${formatter.format(example.solid.raw)}</td>
      <td>${formatter.format(example.solidlil.raw)}</td>
      <td>${formatter.format(example.solid.gzip)}</td>
      <td>${formatter.format(example.solidlil.gzip)}</td>
      <td>${formatter.format(example.solid.brotli)}</td>
      <td>${formatter.format(example.solidlil.brotli)}</td>
      <td><strong>${pct(example.reduction.brotli)}</strong></td>
    </tr>
  `))
  rows.push(`
    <tr>
      <th scope="row">Total</th>
      <td>${formatter.format(raw.solid)}</td>
      <td>${formatter.format(raw.solidlil)}</td>
      <td>${formatter.format(gzip.solid)}</td>
      <td>${formatter.format(gzip.solidlil)}</td>
      <td>${formatter.format(brotli.solid)}</td>
      <td>${formatter.format(brotli.solidlil)}</td>
      <td><strong>${pct(brotli.weightedReduction)}</strong></td>
    </tr>
  `)
  resultsBody.innerHTML = rows.join("")
  const sizes = jfb?.sizes
  const solidBrotli = sizes ? sizes.solid.brotli : brotli.solid
  const lilBrotli = sizes ? sizes.solidlil.brotli : brotli.solidlil
  const solidGzip = sizes ? sizes.solid.gzip : gzip.solid
  const lilGzip = sizes ? sizes.solidlil.gzip : gzip.solidlil
  const solidRaw = sizes ? sizes.solid.raw : raw.solid
  const lilRaw = sizes ? sizes.solidlil.raw : raw.solidlil
  document.querySelector("#total-bar").innerHTML = `
    <div class="bar-solid"><span>Solid 2.0 JFB Brotli</span><strong>${formatter.format(solidBrotli)} B</strong></div>
    <div class="bar-lil" style="width:${Math.max(18, Math.min(100, (lilBrotli / solidBrotli) * 100))}%"><span>@itslil/solidjs JFB Brotli</span><strong>${formatter.format(lilBrotli)} B</strong></div>
    <div class="bar-solid"><span>Solid 2.0 JFB gzip-9</span><strong>${formatter.format(solidGzip)} B</strong></div>
    <div class="bar-lil" style="width:${Math.max(18, Math.min(100, (lilGzip / solidGzip) * 100))}%"><span>@itslil/solidjs JFB gzip-9</span><strong>${formatter.format(lilGzip)} B</strong></div>
    <div class="bar-solid"><span>Solid 2.0 JFB raw</span><strong>${formatter.format(solidRaw)} B</strong></div>
    <div class="bar-lil" style="width:${Math.max(18, Math.min(100, (lilRaw / solidRaw) * 100))}%"><span>@itslil/solidjs JFB raw</span><strong>${formatter.format(lilRaw)} B</strong></div>
  `
}

function row(name, solid, lil, ratioValue) {
  return `
    <tr>
      <th scope="row">${name}</th>
      <td>${solid}</td>
      <td>${lil}</td>
      <td><strong>${ratioValue}</strong></td>
    </tr>
  `
}

function renderPerf() {
  const perf = data.performance
  const jfb = data.jsFrameworkBenchmark
  const cards = document.querySelector("#perf-cards")
  if (!perf && !jfb) {
    if (cards) cards.innerHTML = ""
    perfBody.innerHTML = row("Benchmarks not generated", "—", "—", "—")
    document.querySelector("#perf-note").textContent = "Run npm run bench:perf after build:apps."
    return
  }
  const rows = []
  if (jfb?.cpu) {
    if (cards) {
      const items = jfb.cpu.map((item) => `
        <article class="perf-card${item.ratio < 1 ? " win" : ""}">
          <span>${item.name}</span>
          <strong>${times(item.ratio)}</strong>
          <span>${ms(item.solidlil)} / ${ms(item.solid)}</span>
        </article>
      `)
      const headline = jfb.geomean?.cpuSameApp ?? jfb.geomean?.cpu
      if (headline != null) {
        items.push(`
          <article class="perf-card geo">
            <span>CPU geomean · same app</span>
            <strong>${times(headline)}</strong>
            <span>${selectSameApp ? "9 workloads" : "8 workloads, select excluded"}</span>
          </article>
        `)
      }
      cards.innerHTML = items.join("")
    }
    for (const item of jfb.cpu) {
      rows.push(row(item.name, ms(item.solid), ms(item.solidlil), times(item.ratio)))
    }
    if (jfb.geomean?.cpuSameApp != null) {
      rows.push(row("JFB CPU geomean · same app", "1.00×", times(jfb.geomean.cpuSameApp), times(jfb.geomean.cpuSameApp)))
    }
    if (jfb.geomean?.cpu != null) {
      rows.push(row("JFB CPU geomean · all nine", "1.00×", times(jfb.geomean.cpu), times(jfb.geomean.cpu)))
    }
    if (jfb.memory) {
      for (const item of jfb.memory) {
        rows.push(row(item.name, `${item.solid.toFixed(2)} MB`, `${item.solidlil.toFixed(2)} MB`, times(item.ratio)))
      }
    }
  } else if (cards) {
    cards.innerHTML = ""
  }
  if (jfb?.cpu) {
    document.querySelector("#perf-note").textContent =
      jfb.notes?.cpuSameApp
      ?? `Official js-framework-benchmark, Chrome with CPU throttling, ${jfb.blocks ?? 15} blocks. Ratio is @itslil/solidjs / Solid 2.0 (lower is faster). Same-app geomean excludes select.`
  } else {
    const browser = perf?.browserMs
    if (browser && !browser.skipped) {
      rows.push(
        row("Browser keyed create 1,000", ms(browser.solid.create1k), ms(browser.solidlil.create1k), times(browser.ratio.create1k)),
        row("Browser keyed update every 10th", ms(browser.solid.updateEvery10th), ms(browser.solidlil.updateEvery10th), times(browser.ratio.updateEvery10th)),
        row("Browser keyed swap rows", ms(browser.solid.swap), ms(browser.solidlil.swap), times(browser.ratio.swap)),
        row("Browser keyed clear", ms(browser.solid.clear), ms(browser.solidlil.clear), times(browser.ratio.clear)),
      )
      document.querySelector("#perf-note").textContent =
        `Node ${perf.node}, vs @solidjs/signals@2.0.0-rc.0. Browser medians of 9 Playwright samples on the keyed table versus solid-js + @solidjs/web. Ratio is solidlil / Solid 2.0 (lower is faster).`
    } else {
      document.querySelector("#perf-note").textContent =
        `Node ${perf?.node ?? ""}. Browser benches were skipped${browser?.error ? `: ${browser.error}` : "."}`
    }
  }
  perfBody.innerHTML = rows.join("")
}

renderDemos()
renderResults()
renderPerf()
renderCompilerComparison(data)

document.querySelector(".filters").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-filter]")
  if (!button) return
  document.querySelectorAll(".filters button").forEach((item) => {
    item.classList.toggle("active", item === button)
  })
  renderDemos(button.dataset.filter)
})

demoGrid.addEventListener("click", (event) => {
  const button = event.target.closest(".replay")
  if (!button) return
  const iframe = button.closest(".demo-card").querySelector("iframe")
  iframe.src = iframe.src
})

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy]")
  if (!button) return
  await navigator.clipboard.writeText(button.dataset.copy)
  const previous = button.textContent
  button.textContent = "copied!"
  window.setTimeout(() => { button.textContent = previous }, 1400)
})

const progress = document.querySelector(".progress")
function updateProgress() {
  const scrollable = document.documentElement.scrollHeight - window.innerHeight
  progress.style.transform = `scaleX(${scrollable > 0 ? window.scrollY / scrollable : 0})`
}
window.addEventListener("scroll", updateProgress, { passive: true })
updateProgress()
