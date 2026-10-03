import {renderComparison} from './objective-comparison.js';
const comparison=await fetch('./comparison.json').then(r=>{if(!r.ok)throw Error('Comparison failed to load');return r.json()});
renderComparison(comparison);
const data=await fetch('./results.json').then(r=>r.json());
const demoGrid=document.querySelector('#demo-grid');
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
        <strong class="saving">prototype</strong>
      </header>
      <div class="demo-frame-wrap">
        <iframe
          src="./apps/${encodeURIComponent(example.id)}/compare.html"
          title="${example.title} Solid 2.0 vs solidlil"
          loading="lazy"
        ></iframe>
      </div>
      <footer>
        <span>behavior demo only · not exact parity evidence</span>
        <div>
          <a href="./apps/${encodeURIComponent(example.id)}/solid.html">Solid</a>
          <a href="./apps/${encodeURIComponent(example.id)}/solidlil.html">solidlil</a>
          <button class="replay" type="button" aria-label="Replay ${example.title}">replay ↻</button>
        </div>
      </footer>
    </article>
  `).join("")
}
renderDemos();
document.querySelector('.filters').addEventListener('click',event=>{const button=event.target.closest('[data-filter]');if(!button)return;for(const item of document.querySelectorAll('[data-filter]'))item.classList.toggle('active',item===button);renderDemos(button.dataset.filter)});
demoGrid.addEventListener('click',event=>{const button=event.target.closest('.replay');if(button){const frame=button.closest('.demo-card').querySelector('iframe');frame.src=frame.src}});
